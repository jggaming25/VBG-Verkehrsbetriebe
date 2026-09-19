import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { store } from '../store.js';
import { parseHexColor, fmtDate } from '../util.js';
import { requireMod, openCase, sendModLog, dmUser, applyWarnLimit } from './moderation.js';

async function defer(i) {
  if (!i.deferred && !i.replied) await i.deferReply({ ephemeral: true });
}

async function reply(i, payload, ephemeral = true) {
  const opts = { ...payload };
  if (ephemeral) opts.ephemeral = true;
  if (!i.deferred && !i.replied) await i.reply(opts);
  else await i.editReply(opts);
}

function ctx(i) {
  return { guild: i.guild, cfg: store.ensureConfig(i.guild.id), mod: i.member };
}

async function targetOf(i, optName = 'user') {
  const u = i.options.getUser(optName);
  if (!u) return null;
  return i.guild.members.fetch(u.id).catch(() => null);
}

function modEmbed(c) {
  const color = { warn: 0xf5c542, mute: 0xf0b232, kick: 0xed4245, ban: 0xed4245, unban: 0x23a55a, unmute: 0x23a55a, unwarn: 0x23a55a, clear: 0x5865f2, report: 0xeb4034 }[c.type] || 0x5865f2;
  const label = { warn: '⚠️ Verwarnung', unwarn: '✅ Warnung entfernt', mute: '🔇 Mute', unmute: '🔊 Unmute', kick: '👢 Kick', ban: '🔨 Ban', unban: '🟢 Unban', clear: '🧹 Nachrichten gelöscht', report: '🚩 Report' }[c.type] || c.type;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(label)
    .addFields(
      { name: 'Case', value: c.id, inline: true },
      { name: 'Benutzer', value: c.userTag ? `<@${c.userId}> (${c.userTag})` : '–', inline: true },
      { name: 'Moderator', value: c.moderatorTag ? `<@${c.moderatorId}>` : '–', inline: true },
      ...(c.reason ? [{ name: 'Grund', value: String(c.reason).slice(0, 200) }] : [])
    )
    .setTimestamp(c.at);
}

export const moderation = [
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Verwarne einen Benutzer')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund').setRequired(true)),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      const reason = i.options.getString('reason');
      const c = openCase(guild, 'warn', target, mod, reason);
      await sendModLog(guild, cfg, c);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `⚠️ Du wurdest auf **${guild.name}** verwarnt.\n**Grund:** ${reason}\n**Case:** ${c.id}`);
      }
      await applyWarnLimit(guild, cfg, target, mod);
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unwarn')
      .setDescription('Entferne eine Verwarnung')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addIntegerOption((o) => o.setName('case').setDescription('Case-Nummer (leer = letzte aktive Warnung)'))
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      const caseNum = i.options.getInteger('case');
      let c = null;
      if (caseNum) {
        c = store.getCases(guild.id, target.id).find((x) => x.type === 'warn' && x.status === 'active' && x.id.toLowerCase() === `case-${String(caseNum).padStart(3, '0')}`.toLowerCase());
      } else {
        c = store.getCases(guild.id, target.id).find((x) => x.type === 'warn' && x.status === 'active');
      }
      if (!c) return reply(i, { content: '❌ Keine aktive Warnung gefunden.' });
      const reason = i.options.getString('reason') || 'Kein Grund angegeben';
      store.updateCase(guild.id, c.id, { status: 'removed', removedAt: Date.now(), removedReason: reason });
      const uc = openCase(guild, 'unwarn', target, mod, `Warnung ${c.id}: ${reason}`);
      await sendModLog(guild, cfg, uc, [{ name: 'Betrifft', value: c.id }]);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `✅ Eine Verwarnung wurde auf **${guild.name}** entfernt.`);
      }
      return reply(i, { embeds: [modEmbed(uc)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Mute einen Benutzer (Timeout)')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('Dauer, z.B. 30m, 2h, 7d').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      if (!target.manageable) return reply(i, { content: '❌ Ich kann diesen Benutzer nicht muten.' });
      const ms = parseDuration(i.options.getString('duration'));
      if (!ms) return reply(i, { content: '❌ Ungültige Dauer. Nutze z.B. 30m, 2h, 7d.' });
      const reason = i.options.getString('reason') || '';
      await target.timeout(ms, reason || `Mute durch ${mod.user.tag}`);
      const c = openCase(guild, 'mute', target, mod, `${fmtDuration(ms)}${reason ? ` – ${reason}` : ''}`);
      await sendModLog(guild, cfg, c);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `🔇 Du wurdest auf **${guild.name}** für **${fmtDuration(ms)}** gemutet.${reason ? `\n**Grund:** ${reason}` : ''}`);
      }
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Hebt den Mute eines Benutzers auf')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true)),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      if (!target.manageable) return reply(i, { content: '❌ Ich kann diesen Benutzer nicht ändern.' });
      await target.timeout(null);
      const c = openCase(guild, 'unmute', target, mod);
      await sendModLog(guild, cfg, c);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `🔊 Dein Mute auf **${guild.name}** wurde aufgehoben.`);
      }
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kicke einen Benutzer')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      if (!target.kickable) return reply(i, { content: '❌ Ich kann diesen Benutzer nicht kicken.' });
      const reason = i.options.getString('reason') || '';
      await target.kick(reason || `Kick durch ${mod.user.tag}`);
      const c = openCase(guild, 'kick', target, mod, reason);
      await sendModLog(guild, cfg, c);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `👢 Du wurdest von **${guild.name}** gekickt.${reason ? `\n**Grund:** ${reason}` : ''}`);
      }
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Banne einen Benutzer')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund'))
      .addIntegerOption((o) => o.setName('days').setDescription('Nachrichten löschen (Tage, 0–7)').setMinValue(0).setMaxValue(7)),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      if (!target.bannable) return reply(i, { content: '❌ Ich kann diesen Benutzer nicht bannen.' });
      const reason = i.options.getString('reason') || '';
      const days = i.options.getInteger('days') || 0;
      await target.ban({ reason: reason || `Ban durch ${mod.user.tag}`, deleteMessageSeconds: days * 86400 });
      const c = openCase(guild, 'ban', target, mod, reason);
      await sendModLog(guild, cfg, c);
      if (cfg.moderation.dmOnAction && !isOptedOut(guild, target.id)) {
        await dmUser(target, `🔨 Du wurdest von **${guild.name}** gebannt.${reason ? `\n**Grund:** ${reason}` : ''}`);
      }
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Entbanne einen Benutzer')
      .addStringOption((o) => o.setName('user_id').setDescription('Benutzer-ID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const raw = i.options.getString('user_id');
      const id = (raw.match(/(\d{15,20})/) || [])[1];
      if (!id) return reply(i, { content: '❌ Ungültige Benutzer-ID.' });
      await guild.bans.remove(id, i.options.getString('reason') || undefined).catch(() => null);
      let user = null;
      try { user = await guild.client.users.fetch(id); } catch { /* ignore */ }
      const c = openCase(guild, 'unban', { id, user }, mod, i.options.getString('reason') || '');
      if (user) c.userTag = user.tag;
      await sendModLog(guild, cfg, c);
      return reply(i, { embeds: [modEmbed(c)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('Zeige Moderationsfälle eines Benutzers')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true)),
    async execute(i) {
      const { guild, cfg } = ctx(i);
      await defer(i);
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      const cases = store.getCases(guild.id, target.id);
      if (!cases.length) return reply(i, { content: `✅ Keine Moderationsfälle für <@${target.id}>.` });
      const lines = cases.slice(0, 25).map((c) => {
        const mark = c.status === 'active' ? '🟡' : c.status === 'removed' ? '🟢' : '⚫';
        return `${mark} **${c.id}** \`${c.type}\` ${fmtDate(c.at)}${c.reason ? ` – ${String(c.reason).slice(0, 80)}` : ''}`;
      });
      const embed = new EmbedBuilder()
        .setColor(parseHexColor(cfg.embed.color))
        .setTitle(`📋 Moderationsprotokoll: ${target.user.tag}`)
        .setDescription(lines.join('\n').slice(0, 3900))
        .setFooter({ text: `${cases.length} Fall/Fälle` })
        .setTimestamp();
      return reply(i, { embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Lösche Nachrichten (max. 100)')
      .addIntegerOption((o) => o.setName('amount').setDescription('Anzahl (1–100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Nur Nachrichten dieses Benutzers'))
      .addChannelOption((o) => o.setName('channel').setDescription('Anderer Kanal'))
      .addBooleanOption((o) => o.setName('images').setDescription('Nur Bilder'))
      .addBooleanOption((o) => o.setName('mentions').setDescription('Nur mit Erwähnungen'))
      .addBooleanOption((o) => o.setName('embeds').setDescription('Nur mit Embeds'))
      .addBooleanOption((o) => o.setName('pinned').setDescription('Nur angepinnte')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      if (!requireMod(mod, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const channel = i.options.getChannel('channel') || i.channel;
      if (!channel || !channel.isTextBased() || !channel.viewable) return reply(i, { content: '❌ Kanal nicht verfügbar.' });
      const limit = Math.min(100, i.options.getInteger('amount') || 100);
      const filterUser = i.options.getUser('user');
      const onlyImages = i.options.getBoolean('images');
      const onlyMentions = i.options.getBoolean('mentions');
      const onlyEmbeds = i.options.getBoolean('embeds');
      const onlyPinned = i.options.getBoolean('pinned');
      await defer(i);
      let total = 0;
      let last = null;
      while (total < limit) {
        const batchWant = Math.min(100, limit - total);
        const batch = await channel.messages.fetch({
          limit: batchWant,
          cache: false,
          ...(last ? { before: last } : {}),
        });
        if (!batch.size) break;
        last = batch.last().id;
        let toDelete = [...batch.values()].filter((m) => {
          if (m.pinned && onlyPinned !== true) return false;
          if (filterUser && m.author.id !== filterUser.id) return false;
          if (onlyImages && !(m.attachments.size > 0 || (m.embeds.length && (m.embeds.some((e) => e.image || e.video?.url))))) return false;
          if (onlyMentions && m.mentions.users.size === 0) return false;
          if (onlyEmbeds && m.embeds.length === 0) return false;
          if (onlyPinned && !m.pinned) return false;
          if (m.author.bot) return true;
          return true;
        });
        const chunk = toDelete.filter((m) => Date.now() - m.createdTimestamp < 14 * 864e5);
        if (chunk.length > 0) {
          try {
            await channel.bulkDelete(chunk, true);
            total += chunk.length;
          } catch {
            for (const m of chunk) {
              try { await m.delete(); total++; } catch { /* ignore */ }
            }
          }
        }
        if (batch.size < batchWant) break;
      }
      const c = openCase(guild, 'clear', { id: null, user: null }, mod, `In <#${channel.id}> – ${total} Nachrichten`);
      c.userTag = null;
      await sendModLog(guild, cfg, c);
      return reply(i, { content: `🧹 **${total}** Nachrichten in <#${channel.id}> gelöscht.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('report')
      .setDescription('Melde einen Benutzer')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Grund').setRequired(true))
      .addAttachmentOption((o) => o.setName('proof').setDescription('Beweisbild (optional)')),
    async execute(i) {
      const { guild, cfg, mod } = ctx(i);
      const target = await targetOf(i);
      if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
      const reason = i.options.getString('reason');
      const proof = i.options.getAttachment('proof');
      const c = openCase(guild, 'report', target, mod, reason);
      if (proof) c.meta.proofUrl = proof.url;
      await sendModLog(guild, cfg, c, proof && proof.url ? [{ name: 'Beweis', value: proof.url }] : []);
      return reply(i, { content: `🚩 Report für <@${target.id}> wurde an das Moderations-Team übermittelt (${c.id}).` });
    },
  },
];

function parseDuration(raw) {
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(String(raw).trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60000, h: 3.6e6, d: 8.64e7, w: 6.048e8 };
  return n * mult[m[2].toLowerCase()];
}

function fmtDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3.6e6) return `${Math.round(ms / 60000)}m`;
  if (ms < 8.64e7) return `${Math.round(ms / 3.6e6)}h`;
  if (ms < 6.048e8) return `${Math.round(ms / 8.64e7)}d`;
  return `${Math.round(ms / 6.048e8)}w`;
}

function isOptedOut(guild, userId) {
  const cfg = store.getConfig(guild.id);
  return (cfg && cfg.optOuts || []).includes(userId);
}
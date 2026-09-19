import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, ActivityType } from 'discord.js';
import Jimp from 'jimp';
import { store } from '../store.js';
import { config } from '../config.js';
import { parseHexColor } from '../util.js';
import { isAdmin, isStaff } from '../auth.js';
import { dmUser } from './moderation.js';
import { verifyCode } from './modules.js';
import { forwardTicket } from './core.js';

async function defer(i) {
  if (!i.deferred && !i.replied) await i.deferReply({ ephemeral: true });
}

async function reply(i, payload, ephemeral = true) {
  const opts = { ...payload };
  if (ephemeral) opts.ephemeral = true;
  if (!i.deferred && !i.replied) await i.reply(opts);
  else await i.editReply(opts);
}

const HELP_CATS = [
  { id: 'general', emoji: '🌐', title: '🌐 Allgemein', desc: 'Bot-Info, IDs, Server-/Userinfo, Vorschläge, News, Opt-out, Bildbearbeitung, Maker', cmds: '/help · /id · /serverinfo · /userinfo · /suggest · /news · /optout · /removebg · /avatarmaker · /bannermaker' },
  { id: 'ticket', emoji: '🎫', title: '🎫 Ticket-System', desc: 'Komplette Ticket-Verwaltung inkl. Claim, Checkbox-Anfrage, Weiterleitung, Notizen', cmds: '/panel · /new · /ticket add · /ticket remove · /ticket claim · /ticket unclaim · /ticket close · /ticket closerequest · /ticket forward · /ticket onbehalf · /ticket alert · /ticket rename · /ticket notes · /ticket disableautoactions' },
  { id: 'support', emoji: '🎧', title: '🎧 Support / Voice', desc: 'Temporäre Support-Voice-Kanäle, Öffnungszeiten, Duty', cmds: '/support invite · /support times' },
  { id: 'mod', emoji: '🛡️', title: '🛡️ Moderation', desc: 'Verwarnungen, Mute, Kick, Ban, Clean & Reports mit Cases', cmds: '/warn · /unwarn · /mute · /unmute · /kick · /ban · /unban · /modlogs · /clear · /report' },
  { id: 'config', emoji: '⚙️', title: '⚙️ Konfiguration', desc: 'Rollen, Kanäle, Panels, Sprache, Verhalten', cmds: '/config · /panel · /welcome set · /farewell set · /verify' },
];

export function helpEmbed(cfg, focus) {
  const cat = HELP_CATS.find((c) => c.id === focus);
  const e = new EmbedBuilder()
    .setColor(parseHexColor(cfg.embed.color))
    .setAuthor({ name: 'VBG Ticket Bot', iconURL: cfg.embed.thumbnail || undefined })
    .setTitle(focus === 'all' ? '📚 Alle Commands' : `${cat.emoji} ${cat.title}`)
    .setDescription(focus === 'all' ? 'Wähle unten eine Kategorie für Details.' : cat.desc + '\n\n```' + cat.cmds.slice(0, 55) + '```\n' + '```' + cat.cmds.slice(55) + '```')
    .setFooter({ text: `Version 2.0 · ${HELP_CATS.length} Kategorien · Entwickelt für VBG Verkehrsbetriebe` })
    .setTimestamp();
  return e;
}

export function helpRow() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help:cat')
        .setPlaceholder('Kategorie wählen…')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(HELP_CATS.map((c) => new StringSelectMenuOptionBuilder().setLabel(c.title.replace(/^\S+\s/, '')).setValue(c.id).setEmoji(c.emoji)))
    ),
  ];
}

export const general = [
  // ---------------------------------------------------------------- help
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Bot-Informationen und Command-Übersicht'),
    async execute(i) {
      const cfg = store.ensureConfig(i.guild.id);
      return reply(i, { embeds: [helpEmbed(cfg, 'all')], components: helpRow() }, false);
    },
  },

  // ---------------------------------------------------------------- id
  {
    data: new SlashCommandBuilder().setName('id').setDescription('Zeige die Server-ID'),
    async execute(i) {
      const g = i.guild;
      const e = new EmbedBuilder()
        .setColor(parseHexColor(store.ensureConfig(g.id).embed.color))
        .setTitle(`🆔 ${g.name}`)
        .setDescription(`**Server-ID:** \`${g.id}\``)
        .setFooter({ text: `Erstellt am ${g.createdAt.toLocaleDateString('de-DE')}` });
      return reply(i, { embeds: [e] }, false);
    },
  },

  // ---------------------------------------------------------------- serverinfo
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Zeige Informationen über den Server'),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const channels = g.channels.cache;
      let cats = 0, text = 0, voice = 0, forum = 0, news = 0, stage = 0;
      for (const ch of channels.values()) {
        if (ch.type === ChannelType.GuildCategory) cats++;
        else if (ch.type === ChannelType.GuildText) text++;
        else if (ch.type === ChannelType.GuildVoice) voice++;
        else if (ch.type === ChannelType.GuildForum) forum++;
        else if (ch.type === ChannelType.GuildAnnouncement) news++;
        else if (ch.type === ChannelType.GuildStageVoice) stage++;
      }
      const owner = await g.fetchOwner().catch(() => null);
      const e = new EmbedBuilder()
        .setColor(parseHexColor(cfg.embed.color))
        .setTitle(`ℹ️ ${g.name}`)
        .setThumbnail(g.iconURL({ size: 128 }))
        .addFields(
          { name: 'Serverbesitzer', value: owner ? `<@${owner.id}>` : '–', inline: true },
          { name: 'Boost-Level', value: `${g.premiumTier}/3 (${g.premiumSubscriptionCount || 0} Boosts)`, inline: true },
          { name: 'Sprache', value: g.preferredLocale || 'de', inline: true },
          { name: 'Mitglieder', value: String(g.memberCount), inline: true },
          { name: 'Rollen', value: String(g.roles.cache.size), inline: true },
          { name: 'Kanäle', value: `${text} 📝`, inline: true },
          { name: 'Kategorien', value: String(cats), inline: true },
          { name: 'Sprachkanäle', value: String(voice), inline: true },
          { name: 'Forum', value: String(forum), inline: true },
          { name: 'News', value: String(news), inline: true },
          { name: 'Stage', value: String(stage), inline: true },
          { name: 'Erstellt', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true }
        );
      if (g.bannerURL()) e.setImage(g.bannerURL({ size: 512 }));
      e.setFooter({ text: `ID: ${g.id}` });
      return reply(i, { embeds: [e] }, false);
    },
  },

  // ---------------------------------------------------------------- userinfo
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Zeige Benutzerinformationen')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer (leer = du)')),
    async execute(i) {
      const g = i.guild;
      const target = i.options.getMember('user') || i.member;
      const cfg = store.ensureConfig(g.id);
      const flags = target.user.flags ? target.user.flags.toArray() : [];
      const hype = flags.filter((f) => /HypeSquad/i.test(f)).join(', ') || '–';
      let banner = '–';
      try {
        const full = await g.client.users.fetch(target.user.id, { force: true });
        if (full.bannerURL()) banner = full.bannerURL({ size: 256 });
      } catch { /* ignore */ }
      const e = new EmbedBuilder()
        .setColor(parseHexColor(cfg.embed.color))
        .setTitle(`👤 ${target.user.tag}`)
        .setThumbnail(target.user.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: 'Nickname', value: target.nickname || '–', inline: true },
          { name: 'HypeSquad', value: hype, inline: true },
          { name: 'Banner', value: '✔', inline: true },
          { name: 'Account erstellt', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: 'Server beigetreten', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`, inline: true },
          { name: 'Rollen', value: String(target.roles.cache.size), inline: true }
        )
        .setFooter({ text: `ID: ${target.id}` });
      if (banner !== '–') e.setImage(banner);
      return reply(i, { embeds: [e] }, false);
    },
  },

  // ---------------------------------------------------------------- news
  {
    data: new SlashCommandBuilder()
      .setName('news')
      .setDescription('News-/Themen-Benachrichtigungen abonnieren oder abbestellen')
      .addSubcommand((s) => s.setName('subscribe').setDescription('Benachrichtigungen abonnieren'))
      .addSubcommand((s) => s.setName('unsubscribe').setDescription('Benachrichtigungen abbestellen')),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const sub = i.options.getSubcommand(true);
      const role = cfg.news.roleId ? g.roles.cache.get(cfg.news.roleId) : null;
      if (!role) return reply(i, { content: '❌ Es ist keine News-Rolle konfiguriert (Dashboard → News).' });
      const has = i.member.roles.cache.has(role.id);
      if (sub === 'subscribe' && has) return reply(i, { content: '✅ Du bist bereits abonniert.' });
      if (sub === 'unsubscribe' && !has) return reply(i, { content: 'ℹ️ Du bist nicht abonniert.' });
      await i.member.roles.add(role.id, `News ${sub}`).catch(() => {});
      if (sub === 'unsubscribe') await i.member.roles.remove(role.id, `News ${sub}`).catch(() => {});
      return reply(i, { content: sub === 'subscribe' ? `📰 Du abonnierst jetzt die **News** in <#${cfg.news.channelId || role.id ? '' : ''}>. Rolle: <@&${role.id}>` : `📰 Du hast die News-Benachrichtigungen abbestellt.` });
    },
  },

  // ---------------------------------------------------------------- optout
  {
    data: new SlashCommandBuilder().setName('optout').setDescription('Opt-out von Datenerfassung'),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const optOuts = cfg.optOuts || [];
      if (optOuts.includes(i.user.id)) {
        store.updateConfig(g.id, { optOuts: optOuts.filter((x) => x !== i.user.id) });
        return reply(i, { content: '✅ Opt-out aufgehoben – deine Aktivität wird wieder erfasst.' });
      }
      store.updateConfig(g.id, { optOuts: [...optOuts, i.user.id] });
      return reply(i, { content: '🛡️ Du hast dich vom Datenerfassen abgemeldet. Der Bot speichert keine weiteren Aktivitäten von dir.' });
    },
  },

  // ---------------------------------------------------------------- removebg
  {
    data: new SlashCommandBuilder()
      .setName('removebg')
      .setDescription('Entferne den Hintergrund eines Bildes')
      .addAttachmentOption((o) => o.setName('image').setDescription('Bild (PNG/JPG)').setRequired(true)),
    async execute(i) {
      if (!config.removeBgApiKey) {
        return reply(i, { content: '⚠️ Dieses Modul ist deaktiviert. Setze `REMOVEBG_API_KEY` (kostenlos unter remove.bg/api).' });
      }
      const att = i.options.getAttachment('image');
      if (!att || !/^image\/(png|jpe?g|webp)/.test(att.contentType)) {
        return reply(i, { content: '❌ Bitte ein PNG/JPG-Bild anhängen.' });
      }
      await defer(i);
      try {
        const res = await fetch(att.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const form = new FormData();
        form.append('image_file', new Blob([buf], { type: att.contentType }), 'image.png');
        form.append('size', 'auto');
        const r = await fetch('https://api.remove.bg/v1.0/removebg', {
          method: 'POST',
          headers: { 'X-Api-Key': config.removeBgApiKey },
          body: form,
        });
        const json = await r.json().catch(() => ({}));
        if (!json.data || !json.data.result_b64) {
          return reply(i, { content: `❌ Entfernen fehlgeschlagen: ${json.errors?.[0]?.title || 'Unbekannter Fehler (API-Limit?)'}` });
        }
        const out = Buffer.from(json.data.result_b64, 'base64');
        const path = `data/removebg-${Date.now()}.png`;
        const fs = await import('node:fs');
        fs.writeFileSync(path, out);
        return i.editReply({ content: '✨ Hintergrund entfernt:', files: [path], ephemeral: true }).catch(() =>
          reply(i, { content: '✨ Hintergrund entfernt:', files: [path], ephemeral: true })
        );
      } catch (e) {
        return reply(i, { content: `❌ Fehler: ${e.message}` });
      }
    },
  },

  // ---------------------------------------------------------------- avatarmaker
  {
    data: new SlashCommandBuilder()
      .setName('avatarmaker')
      .setDescription('Erstelle ein Profilbild')
      .addStringOption((o) => o.setName('letter').setDescription('Buchstabe/Zeichen (1)').setRequired(true).setMaxLength(3))
      .addStringOption((o) => o.setName('firstcolor').setDescription('Farbe 1 (HEX)'))
      .addStringOption((o) => o.setName('secondcolor').setDescription('Farbe 2 (HEX)')),
    async execute(i) {
      await defer(i);
      try {
        const letter = (i.options.getString('letter') || '?' ).slice(0, 1);
        const c1 = i.options.getString('firstcolor') || '#5865F2';
        const c2 = i.options.getString('secondcolor') || '#7317fe';
        const img = await avatarImage(letter, c1, c2);
        const path = `data/avatar-${Date.now()}.png`;
        await img.writeAsync(path);
        const fs = await import('node:fs');
        if (!fs.existsSync(path)) return reply(i, { content: '❌ Generierung fehlgeschlagen.' });
        return i.editReply({ content: `🎨 Avatar mit **${letter}** erstellt:`, files: [path], ephemeral: true }).catch(() =>
          reply(i, { content: `🎨 Avatar mit **${letter}** erstellt:`, files: [path], ephemeral: true })
        );
      } catch (e) {
        return reply(i, { content: `❌ Fehler: ${e.message}` });
      }
    },
  },

  // ---------------------------------------------------------------- bannermaker
  {
    data: new SlashCommandBuilder()
      .setName('bannermaker')
      .setDescription('Erstelle ein Banner')
      .addStringOption((o) => o.setName('name').setDescription('Name/Text').setRequired(true).setMaxLength(40))
      .addStringOption((o) => o.setName('color').setDescription('Farbe (HEX)')),
    async execute(i) {
      await defer(i);
      try {
        const name = i.options.getString('name');
        const color = i.options.getString('color') || '#5865F2';
        const img = await bannerImage(name, color);
        const path = `data/banner-${Date.now()}.png`;
        await img.writeAsync(path);
        return i.editReply({ content: `🎨 Banner **${name}** erstellt:`, files: [path], ephemeral: true }).catch(() =>
          reply(i, { content: `🎨 Banner **${name}** erstellt:`, files: [path], ephemeral: true })
        );
      } catch (e) {
        return reply(i, { content: `❌ Fehler: ${e.message}` });
      }
    },
  },

  // ---------------------------------------------------------------- suggest
  {
    data: new SlashCommandBuilder()
      .setName('suggest')
      .setDescription('Vorschläge verwalten')
      .addSubcommand((s) => s.setName('submit').setDescription('Reiche einen Vorschlag ein'))
      .addSubcommand((s) => s.setName('list').setDescription('Zeige offene Vorschläge'))
      .addSubcommand((s) =>
        s
          .setName('accept')
          .setDescription('Vorschlag annehmen (VIP)')
          .addIntegerOption((o) => o.setName('id').setDescription('Vorschlags-Nr. aus /suggest list').setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('decline')
          .setDescription('Vorschlag ablehnen (VIP)')
          .addIntegerOption((o) => o.setName('id').setDescription('Vorschlags-Nr. aus /suggest list').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Ablehnungsgrund'))
      )
      .addSubcommand((s) => s.setName('resetvotes').setDescription('Stimmen zurücksetzen (VIP)').addIntegerOption((o) => o.setName('id').setDescription('Vorschlags-Nr.').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('set').setDescription('Vorschlagskonfiguration (VIP)')
          .addChannelOption((o) => o.setName('channel').setDescription('Vorschlagskanal'))
          .addStringOption((o) => o.setName('category').setDescription('Kategorie hinzufügen: Name|Emoji'))
          .addStringOption((o) => o.setName('remove_category').setDescription('Kategorie entfernen (Name)'))
      ),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const sup = cfg.suggestions;
      const sub = i.options.getSubcommand(true);

      if (sub === 'submit') {
        if (!sup.channelId) return reply(i, { content: '❌ Vorschläge sind auf diesem Server nicht eingerichtet (Dashboard → Vorschläge oder `/suggest set`).' });
        const modal = new (await import('discord.js')).ModalBuilder()
          .setCustomId('sug:new')
          .setTitle('💡 Neuer Vorschlag');
        const cats = (sup.categories || []).filter((c) => c.active).map((c) => c.name).join(' | ');
        modal.addComponents(
          new (await import('discord.js')).ActionRowBuilder().addComponents(
            new (await import('discord.js')).TextInputBuilder()
              .setCustomId('category')
              .setLabel(`Kategorie (${cats || 'Allgemein'})`)
              .setStyle((await import('discord.js')).TextInputStyle.Short)
              .setRequired(true)
              .setValue(sup.categories?.[0]?.name || 'Allgemein')
              .setMaxLength(40)
          ),
          new (await import('discord.js')).ActionRowBuilder().addComponents(
            new (await import('discord.js')).TextInputBuilder()
              .setCustomId('idea')
              .setLabel('Dein Vorschlag')
              .setStyle((await import('discord.js')).TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
          )
        );
        return i.showModal(modal);
      }

      await defer(i);
      if (sub === 'list') {
        const open = store.getSuggestions(g.id).filter((s) => s.status === 'pending');
        if (!open.length) return reply(i, { content: '📭 Keine offenen Vorschläge.' });
        const lines = open.map((s) => `**#${s.id}** [${s.category}] ${s.idea.slice(0, 90)} (${s.up}👍/${s.down}👎)`);
        return reply(i, { content: `**Offene Vorschläge (${open.length}):**\n${lines.join('\n').slice(0, 1900)}` });
      }

      if (['accept', 'decline', 'resetvotes'].includes(sub)) {
        const canDecide = isAdmin(i.member, cfg) || (sup.teamRoles || []).some((r) => i.member.roles.cache.has(r));
        if (!canDecide) return reply(i, { content: '❌ Keine Berechtigung (Team-Rolle in Dashboard hinterlegt).' });
        const id = i.options.getInteger('id');
        const s = store.getSuggestion(g.id, `S-${String(id)}`) || store.getSuggestions(g.id).find((x) => x.seq === id);
        if (!s) return reply(i, { content: '❌ Vorschlag nicht gefunden.' });
        const { decideSuggestion } = await import('./suggestions.js');
        await decideSuggestion({ guild: g, suggestion: s, decision: sub === 'accept' ? 'accepted' : sub === 'decline' ? 'declined' : 'reset', moderator: i.user, reason: sub === 'decline' ? i.options.getString('reason') : null });
        return reply(i, { content: `✅ Vorschlag ${s.id} → **${sub === 'accept' ? 'angenommen' : sub === 'decline' ? 'abgelehnt' : 'Stimmen zurückgesetzt'}**.` });
      }

      if (sub === 'set') {
        if (!isAdmin(i.member, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
        const ch = i.options.getChannel('channel');
        const addCat = i.options.getString('category');
        const remCat = i.options.getString('remove_category');
        const patch = { ...sup };
        if (ch && ch.isTextBased()) patch.channelId = ch.id;
        if (addCat) {
          const [name, emoji] = addCat.split('|').map((x) => x.trim());
          patch.categories = [...(sup.categories || []), { name: name || 'Neu', emoji: emoji || '💡', description: '', active: true }];
        }
        if (remCat) patch.categories = (sup.categories || []).filter((c) => !c.name.toLowerCase().includes(remCat.toLowerCase()));
        store.updateConfig(g.id, { suggestions: patch });
        return reply(i, { content: `✅ Vorschläge-Konfiguration aktualisiert. Kanal: ${patch.channelId ? `<#${patch.channelId}>` : '–'}, Kategorien: ${patch.categories.length}` });
      }
    },
  },

  // ---------------------------------------------------------------- support
  {
    data: new SlashCommandBuilder()
      .setName('support')
      .setDescription('Support / Voice-Support')
      .addSubcommand((s) => s.setName('invite').setDescription('Erstelle einen temporären Support-Voice-Kanal'))
      .addSubcommand((s) => s.setName('times').setDescription('Zeige die Support-Öffnungszeiten'))
      .addSubcommand((s) =>
        s.setName('add_time').setDescription('Support-Zeitfenster hinzufügen (VIP)')
          .addStringOption((o) => o.setName('day').setDescription('Wochentag').setRequired(true).addChoices(
            ...['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((d) => ({ name: d, value: d }))))
          .addStringOption((o) => o.setName('start').setDescription('Start, z.B. 18:00').setRequired(true))
          .addStringOption((o) => o.setName('end').setDescription('Ende, z.B. 22:00').setRequired(true))
      )
      .addSubcommand((s) => s.setName('clear_times').setDescription('Alle Support-Zeiten löschen (VIP)')),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const sup = cfg.support;
      const sub = i.options.getSubcommand(true);

      if (sub === 'invite') {
        const cat = sup.voiceCategoryId ? g.channels.cache.get(sup.voiceCategoryId) : null;
        const name = (sup.tempChannelName || '🎧 Support-{n}').replace('{n}', String(Date.now() % 1000));
        const ch = await g.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: cat ? cat.id : undefined,
          reason: `Support-Anfrage von ${i.user.tag}`,
          permissionOverwrites: [
            { id: g.roles.everyone.id, deny: ['ViewChannel'] },
            { id: i.user.id, allow: ['ViewChannel', 'Connect', 'Speak', 'Stream'] },
          ],
        });
        await ch.send({ content: `🎧 Support-Kanal für <@${i.user.id}>` });
        return reply(i, { content: `🎧 Support-Kanal erstellt: <#${ch.id}> – Verbinde dich mit dem Voice-Kanal.` });
      }

      if (sub === 'times') {
        const times = sup.times || [];
        if (!times.length) return reply(i, { content: '📅 Es sind noch keine Support-Öffnungszeiten hinterlegt (Dashboard → Support).' });
        const lines = times.map((x) => `**${x.day}:** ${x.start}–${x.end}`);
        const e = new EmbedBuilder()
          .setColor(parseHexColor(cfg.embed.color))
          .setTitle('🎧 Support-Öffnungszeiten')
          .setDescription(lines.join('\n'));
        return reply(i, { embeds: [e] }, false);
      }

      if (!isAdmin(i.member, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      if (sub === 'add_time') {
        const t = { day: i.options.getString('day'), start: i.options.getString('start'), end: i.options.getString('end') };
        store.updateConfig(g.id, { support: { ...sup, times: [...(sup.times || []), t] } });
        return reply(i, { content: `✅ Zeitfenster **${t.day} ${t.start}–${t.end}** hinzugefügt.` });
      }
      if (sub === 'clear_times') {
        store.updateConfig(g.id, { support: { ...sup, times: [] } });
        return reply(i, { content: '✅ Alle Support-Zeiten gelöscht.' });
      }
    },
  },

  // ---------------------------------------------------------------- welcome / farewell
  {
    data: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Willkommensnachricht konfigurieren (VIP)')
      .addSubcommand((s) =>
        s.setName('set').setDescription('Willkommenskanal und Nachricht setzen')
          .addChannelOption((o) => o.setName('channel').setDescription('Willkommenskanal'))
          .addStringOption((o) => o.setName('message').setDescription('Nachricht mit {user}'))
          .addRoleOption((o) => o.setName('role').setDescription('Auto-Rolle für Neue'))
      )
      .addSubcommand((s) => s.setName('enable').setDescription('Willkommensnachrichten aktivieren').addBooleanOption((o) => o.setName('value').setDescription('true/false').setRequired(true))),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      if (!isAdmin(i.member, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const sub = i.options.getSubcommand(true);
      if (sub === 'enable') {
        const v = i.options.getBoolean('value');
        store.updateConfig(g.id, { welcome: { ...cfg.welcome, enabled: v } });
        return reply(i, { content: `✅ Willkommensnachrichten ${v ? 'aktiviert' : 'deaktiviert'}.` });
      }
      const ch = i.options.getChannel('channel');
      const msg = i.options.getString('message');
      const role = i.options.getRole('role');
      const patch = { ...cfg.welcome };
      if (ch) patch.channelId = ch.id;
      if (msg) patch.message = msg;
      if (role) patch.autoRoles = [...(cfg.welcome.autoRoles || []), role.id];
      store.updateConfig(g.id, { welcome: patch });
      return reply(i, { content: `✅ Willkommen konfiguriert. Kanal: ${patch.channelId ? `<#${patch.channelId}>` : '–'}, Auto-Rollen: ${(patch.autoRoles || []).length}` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('farewell')
      .setDescription('Abschiedsnachricht konfigurieren (VIP)')
      .addSubcommand((s) =>
        s.setName('set').setDescription('Abschiedskanal und Nachricht setzen')
          .addChannelOption((o) => o.setName('channel').setDescription('Abschiedskanal'))
          .addStringOption((o) => o.setName('message').setDescription('Nachricht mit {user}'))
      )
      .addSubcommand((s) => s.setName('enable').setDescription('Abschiedsnachrichten aktivieren').addBooleanOption((o) => o.setName('value').setDescription('true/false').setRequired(true))),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      if (!isAdmin(i.member, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
      const sub = i.options.getSubcommand(true);
      if (sub === 'enable') {
        store.updateConfig(g.id, { farewell: { ...cfg.farewell, enabled: i.options.getBoolean('value') } });
        return reply(i, { content: `✅ Abschiedsnachrichten ${i.options.getBoolean('value') ? 'aktiviert' : 'deaktiviert'}.` });
      }
      const ch = i.options.getChannel('channel');
      const msg = i.options.getString('message');
      const patch = { ...cfg.farewell };
      if (ch) patch.channelId = ch.id;
      if (msg) patch.message = msg;
      store.updateConfig(g.id, { farewell: patch });
      return reply(i, { content: `✅ Abschied konfiguriert. Kanal: ${patch.channelId ? `<#${patch.channelId}>` : '–'}` });
    },
  },

  // ---------------------------------------------------------------- verify
  {
    data: new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Verifiziere dich (bei aktivem Voice-Gate)')
      .addIntegerOption((o) => o.setName('code').setDescription('Captcha-Code aus deiner DM').setRequired(true)),
    async execute(i) {
      const g = i.guild;
      const cfg = store.ensureConfig(g.id);
      const code = i.options.getInteger('code');
      const r = verifyCode(g.id, i.user.id, String(code));
      if (!r.ok) return reply(i, { content: '❌ Code ungültig oder abgelaufen. Schau in deine Direktnachrichten (oder neu beitreten).' });
      if (!cfg.protection.verifiedRoleId) return reply(i, { content: '✅ Verifiziert! Aber es ist keine Verifizierungs-Rolle gesetzt.' });
      await i.member.roles.add(cfg.protection.verifiedRoleId, 'Verifiziert').catch(() => {});
      return reply(i, { content: `✅ Du bist verifiziert und hast die Rolle <@&${cfg.protection.verifiedRoleId}> erhalten!` });
    },
  },
];

// ---------------------------------------------------------------- image makers

async function loadFont(size) {
  const map = { 32: Jimp.FONT_SANS_32_WHITE, 64: Jimp.FONT_SANS_64_WHITE, 128: Jimp.FONT_SANS_128_WHITE };
  return Jimp.loadFont(map[size] || Jimp.FONT_SANS_64_WHITE);
}

function jColor(hex) {
  const v = parseInt(String(hex).replace('#', '0x') || '0x5865F2', 16);
  return Number.isNaN(v) || v < 0 ? 0x5865F2 : v;
}

function jC(hex) {
  const v = jColor(hex);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

async function avatarImage(letter, c1, c2) {
  const size = 512;
  const img = new Jimp(size, size, jColor(c1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x + y > size) img.setPixelColor(jColor(c2), x, y);
    }
  }
  img.scan(0, 0, size, size, function (x, y, idx) {
    if (x + y > size) {
      this.bitmap.data[idx] = (jColor(c2) >> 16) & 0xff;
      this.bitmap.data[idx + 1] = (jColor(c2) >> 8) & 0xff;
      this.bitmap.data[idx + 2] = jColor(c2) & 0xff;
    }
  });
  const font = await loadFont(128);
  const w = Jimp.measureText(font, letter);
  const h = Jimp.measureTextHeight(font, letter, size);
  img.print(font, Math.floor((size - w) / 2), Math.floor((size - h) / 2), letter);
  return img;
}

async function bannerImage(name, color) {
  const w = 1600, h = 500;
  const img = new Jimp(w, h, jColor(color));
  const a = jC(color);
  const b2 = jC('7317fe');
  img.scan(0, 0, w, h, function (x, y) {
    const t = y / h;
    this.bitmap.data[this.bitmap.offset + 0] = Math.round(a.r + (b2.r - a.r) * t);
    this.bitmap.data[this.bitmap.offset + 1] = Math.round(a.g + (b2.g - a.g) * t);
    this.bitmap.data[this.bitmap.offset + 2] = Math.round(a.b + (b2.b - a.b) * t);
  });
  const font = await loadFont(64);
  const words = String(name).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const wrd of words) {
    if (cur && (cur + ' ' + wrd).length > 22) { lines.push(cur); cur = wrd; } else cur = cur ? cur + ' ' + wrd : wrd;
  }
  if (cur) lines.push(cur);
  const lh = 96;
  const startY = Math.floor((h - lines.length * lh) / 2);
  lines.forEach((ln, idx) => {
    const mw = Jimp.measureText(font, ln);
    img.print(font, Math.floor((w - mw) / 2), startY + idx * lh, ln);
  });
  return img;
}
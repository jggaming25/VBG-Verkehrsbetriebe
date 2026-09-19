import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../store.js';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { isAdmin, isStaff } from '../auth.js';
import { extractionId, fmtDate, parseHexColor } from '../util.js';
import { buildTranscript, readTranscript } from '../transcript.js';
import { addParticipant, removeParticipant, renameTicket, ticketInfoEmbed, sendLog, logAction } from './core.js';

async function defer(i) {
  if (!i.deferred && !i.replied) await i.deferReply({ ephemeral: true });
}

async function reply(i, payload, ephemeral = true) {
  const opts = { ...payload };
  if (ephemeral) opts.ephemeral = true;
  if (!i.deferred && !i.replied) await i.reply(opts);
  else await i.editReply(opts);
}

function getTicketOf(i) {
  if (!i.channel) return null;
  const t = store.getTicket(i.guild.id, i.channel.id);
  return t && t.status !== 'deleted' ? t : null;
}

function ticketChannel(guild, ticket) {
  return guild.channels.cache.get(ticket.channelId) || null;
}

function parseIds(input) {
  return [...String(input || '').matchAll(/(\d{15,20})/g)].map((m) => m[1]);
}

function parseBool(v) {
  return /^(true|1|ja|yes|on|aktiv)$/i.test(String(v));
}

export const more = [
  {
    data: new SlashCommandBuilder()
      .setName('add')
      .setDescription('Füge einen Benutzer zum Ticket hinzu')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true)),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      const targetUser = i.options.getUser('user');
      const target = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return reply(i, { content: t(cfg, 'errors_user_not_found') });
      const res = await addParticipant({ guild, ticket, actor: i.user, target, channel: ticketChannel(guild, ticket) });
      if (!res.ok) return reply(i, { content: res.error });
      return reply(i, { content: `➕ <@${target.id}> wurde zum Ticket hinzugefügt.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Entferne einen Benutzer aus dem Ticket')
      .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true)),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      const targetUser = i.options.getUser('user');
      const target = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return reply(i, { content: t(cfg, 'errors_user_not_found') });
      const res = await removeParticipant({ guild, ticket, actor: i.user, target, channel: ticketChannel(guild, ticket) });
      if (!res.ok) return reply(i, { content: res.error });
      return reply(i, { content: `➖ <@${target.id}> wurde entfernt.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('rename')
      .setDescription('Benenne das Ticket um')
      .addStringOption((o) => o.setName('name').setDescription('Neuer Name').setRequired(true)),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg) && ticket.creatorId !== i.user.id) return reply(i, { content: t(cfg, 'errors_no_perm') });
      const name = i.options.getString('name');
      const res = await renameTicket({ guild, ticket, actor: i.user, name, channel: ticketChannel(guild, ticket) });
      if (!res.ok) return reply(i, { content: res.error });
      return reply(i, { content: `✏️ Ticket in **${name}** umbenannt.` });
    },
  },

  {
    data: new SlashCommandBuilder().setName('transcript').setDescription('Exportiere das Transkript dieses Tickets'),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      await defer(i);
      const channel = ticketChannel(guild, ticket);
      if (channel && channel.viewable) {
        try {
          const res = await buildTranscript(channel, cfg, ticket);
          ticket.transcriptPath = res.relPath;
          store.updateTicket(ticket.id, { transcriptPath: res.relPath });
        } catch (e) {
          return reply(i, { content: 'Transkript konnte nicht erstellt werden.' });
        }
      }
      const abs = ticket.transcriptPath ? path.join(config.dataDir, ticket.transcriptPath) : null;
      const target = cfg.transcriptChannelId ? guild.channels.cache.get(cfg.transcriptChannelId) : null;
      if (target && abs && fs.existsSync(abs)) {
        await target.send({ files: [abs], content: `📄 **Transkript ${ticket.id}**` });
      }
      await sendLog(guild, 'transcript', cfg, { ticket, actor: i.user });
      logAction(guild, 'transcript', { ticket, actor: i.user });
      const link = config.webUrl ? `\n📎 Web-Transkript: ${config.webUrl}/transcript/${ticket.id}` : '';
      return reply(i, {
        content: `📄 Transkript von **${ticket.id}** gespeichert. ${target ? `(auch in <#${target.id}> gepostet)` : ''}${link}`,
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('tickets')
      .setDescription('Liste alle Tickets')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter')
          .addChoices(
            { name: 'Alle', value: 'all' },
            { name: 'Offen', value: 'open' },
            { name: 'Übernommen', value: 'claimed' },
            { name: 'Geschlossen', value: 'closed' },
            { name: 'Gelöscht', value: 'deleted' }
          )
      )
      .addIntegerOption((o) => o.setName('page').setDescription('Seite').setMinValue(1)),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      await defer(i);
      const status = i.options.getString('status') || 'all';
      const page = Math.max(1, i.options.getInteger('page') || 1);
      let list = store.getTickets(guild.id);
      if (status !== 'all') list = list.filter((x) => x.status === status);
      list = list.sort((a, b) => b.createdAt - a.createdAt);
      const per = 10;
      const pages = Math.max(1, Math.ceil(list.length / per));
      const items = list.slice((page - 1) * per, page * per);
      if (!items.length) return reply(i, { content: t(cfg, 'empty_tickets') });
      const lines = items.map((x) => `**${x.id}** \`${x.status}\` <#${x.channelId}> – <@${x.creatorId}> ${x.topic ? `(${x.topic})` : ''}`);
      return reply(i, { content: `📋 **Tickets** (${list.length} gesamt, Filter: ${status})\n\`\`\`\n${lines.join('\n').slice(0, 1700)}\`\`\`\nSeite **${page}/${pages}**` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ticketinfo')
      .setDescription('Details zu einem Ticket anzeigen')
      .addStringOption((o) => o.setName('id').setDescription('Ticket-ID, z.B. T-0001 (leer = aktueller Kanal)')),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      await defer(i);
      const id = i.options.getString('id');
      const ticket = id ? store.getTicket(guild.id, id.toUpperCase()) : getTicketOf(i);
      if (!ticket) return reply(i, { content: 'Ticket nicht gefunden.' });
      const embed = ticketInfoEmbed(cfg, ticket);
      return reply(i, { embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder().setName('stats').setDescription('Ticket-Statistiken des Servers'),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      await defer(i);
      const all = store.getTickets(guild.id);
      const open = all.filter((x) => x.status === 'open').length;
      const claimed = all.filter((x) => x.status === 'claimed').length;
      const closed = all.filter((x) => x.status === 'closed').length;
      const deleted = all.filter((x) => x.status === 'deleted').length;
      const week = all.filter((x) => Date.now() - x.createdAt < 7 * 864e5).length;
      const responded = all.filter((x) => x.firstResponseAt && x.createdAt);
      const avgResp = responded.length
        ? Math.round(responded.reduce((s, x) => s + (x.firstResponseAt - x.createdAt), 0) / responded.length / 1000)
        : 0;
      const fb = all.filter((x) => x.feedback);
      const avgStars = fb.length ? (fb.reduce((s, x) => s + x.feedback.stars, 0) / fb.length).toFixed(1) : '–';
      const embed = new EmbedBuilder()
        .setColor(parseHexColor(cfg.embed.color))
        .setTitle(t(cfg, 'command_stats_title'))
        .addFields(
          { name: '🟢 Offen', value: String(open), inline: true },
          { name: '🖐️ Geclaimt', value: String(claimed), inline: true },
          { name: '🔒 Geschlossen', value: String(closed), inline: true },
          { name: '🗑️ Gelöscht', value: String(deleted), inline: true },
          { name: '📦 Gesamt', value: String(all.length), inline: true },
          { name: '📅 Diese Woche', value: String(week), inline: true },
          { name: '⏱ Ø Antwortzeit', value: avgResp ? `${avgResp}s` : '–', inline: true },
          { name: '⭐ Ø Bewertung', value: String(avgStars), inline: true }
        )
        .setTimestamp();
      return reply(i, { embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('config')
      .setDescription('Bot-Konfiguration ansehen / ändern')
      .addSubcommand((s) => s.setName('view').setDescription('Zeige die aktuelle Konfiguration'))
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Setze einen Konfigurationswert')
          .addStringOption((o) => o.setName('key').setDescription('Config-Key').setRequired(true))
          .addStringOption((o) => o.setName('value').setDescription('Wert').setRequired(true))
      )
      .addSubcommand((s) => s.setName('help').setDescription('Zeige alle verfügbaren Config-Keys')),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const sub = i.options.getSubcommand(true);

      if (sub === 'view') {
        await defer(i);
        const embed = new EmbedBuilder()
          .setColor(parseHexColor(cfg.embed.color))
          .setTitle('⚙️ Konfiguration')
          .addFields(
            { name: 'Sprache', value: cfg.language, inline: true },
            { name: 'Support-Rollen', value: cfg.supportRoles?.map((r) => `<@&${r}>`).join(' ') || '–', inline: true },
            { name: 'Manager-Rollen', value: cfg.managerRoles?.map((r) => `<@&${r}>`).join(' ') || '–', inline: true },
            { name: 'Admin-Rollen', value: cfg.adminRoles?.map((r) => `<@&${r}>`).join(' ') || '–', inline: true },
            { name: 'Log-Kanal', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '–', inline: true },
            { name: 'Transkript-Kanal', value: cfg.transcriptChannelId ? `<#${cfg.transcriptChannelId}>` : '–', inline: true },
            { name: 'Ping-Rolle', value: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '–', inline: true },
            { name: 'Default-Kategorie', value: cfg.defaultCategoryId ? `<#${cfg.defaultCategoryId}>` : '–', inline: true },
            { name: 'Close-Kategorie', value: cfg.closedCategoryId ? `<#${cfg.closedCategoryId}>` : '–', inline: true },
            { name: 'Max Tickets/User', value: String(cfg.maxTicketsPerUser), inline: true },
            { name: 'Auto-Close (min)', value: String(cfg.autoCloseMinutes), inline: true },
            { name: 'Auto-Delete (h)', value: String(cfg.autoDeleteHours), inline: true },
            { name: 'Feedback', value: cfg.feedbackEnabled ? '🟢' : '🔴', inline: true },
            { name: 'Auto-Transkript', value: cfg.autoTranscripts ? '🟢' : '🔴', inline: true },
            { name: 'Message-Limit', value: String(cfg.messageLimit), inline: true },
            { name: 'Embed-Farbe', value: String(cfg.embed.color), inline: true }
          )
          .setFooter({ text: 'Nutze /config set <key> <wert> zum Ändern.' })
          .setTimestamp();
        return reply(i, { embeds: [embed] });
      }

      if (sub === 'set') {
        if (!isAdmin(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
        const key = i.options.getString('key').toLowerCase();
        const value = i.options.getString('value');

        if (key === 'language') {
          store.updateConfig(guild.id, { language: value === 'en' ? 'en' : 'de' });
          return reply(i, { content: `✅ Sprache auf **${value === 'en' ? 'en' : 'de'}** gesetzt.` });
        }
        if (key === 'embedcolor' || key === 'color') {
          store.updateConfig(guild.id, { embed: { ...cfg.embed, color: /^#/.test(value) ? value : `#${value}` } });
          return reply(i, { content: `✅ Embed-Farbe auf **${value}** gesetzt.` });
        }

        const intKeys = { maxticketsperuser: 'maxTicketsPerUser', autocloseminutes: 'autoCloseMinutes', autodeletehours: 'autoDeleteHours', messagelimit: 'messageLimit' };
        if (intKeys[key]) {
          const n = Math.max(0, parseInt(value, 10) || 0);
          store.updateConfig(guild.id, { [intKeys[key]]: n });
          return reply(i, { content: `✅ ${intKeys[key]} = **${n}**` });
        }

        const boolKeys = { feedbackenabled: 'feedbackEnabled', autotranscripts: 'autoTranscripts' };
        if (boolKeys[key]) {
          const b = parseBool(value);
          store.updateConfig(guild.id, { [boolKeys[key]]: b });
          return reply(i, { content: `✅ ${boolKeys[key]} = **${b}**` });
        }

        const idListKeys = { supportroles: 'supportRoles', managerroles: 'managerRoles', adminroles: 'adminRoles', accessroles: 'accessRoles' };
        if (idListKeys[key]) {
          const ids = parseIds(value).filter((x, idx, arr) => arr.indexOf(x) === idx);
          store.updateConfig(guild.id, { [idListKeys[key]]: ids });
          return reply(i, { content: `✅ ${idListKeys[key]} = **${ids.join(', ') || '–'}**` });
        }

        const idKeys = { pingrole: 'pingRoleId', openrole: 'openRoleId', closedrole: 'closedRoleId' };
        if (idKeys[key]) {
          const id = parseIds(value)[0] || null;
          store.updateConfig(guild.id, { [idKeys[key]]: id });
          return reply(i, { content: `✅ ${idKeys[key]} = **${id || '–'}**` });
        }

        const chKeys = { logchannel: 'logChannelId', transcriptchannel: 'transcriptChannelId', defaultcategory: 'defaultCategoryId', closedcategory: 'closedCategoryId' };
        if (chKeys[key]) {
          const id = parseIds(value)[0] || null;
          store.updateConfig(guild.id, { [chKeys[key]]: id });
          return reply(i, { content: `✅ ${chKeys[key]} = **${id || '–'}**` });
        }

        const strKeys = { embedauthor: 'author', embedfooter: 'footer', embedtitle: 'title', embeddescription: 'description', embedimage: 'image', embedthumbnail: 'thumbnail' };
        if (strKeys[key]) {
          const newEmbed = { ...cfg.embed, [strKeys[key]]: value === 'none' ? '' : value };
          store.updateConfig(guild.id, { embed: newEmbed });
          return reply(i, { content: `✅ embed.${strKeys[key]} gesetzt.` });
        }

        return reply(i, { content: 'Unbekannter Key. Nutze /config help.' });
      }

      if (sub === 'help') {
        const keys = [
          'language (de|en)',
          'supportroles, managerroles, adminroles, accessroles (@Rollen)',
          'pingrole, openrole, closedrole (@Rolle)',
          'logchannel, transcriptchannel, defaultcategory, closedcategory (#Kanal)',
          'maxticketsperuser (Zahl)',
          'autocloseminutes (0=aus)',
          'autodeletehours (0=aus)',
          'feedbackenabled, autotranscripts (true/false)',
          'messagelimit (Zahl)',
          'embedcolor, embedauthor, embedfooter, embedtitle, embeddescription, embedimage, embedthumbnail',
        ];
        return reply(i, { content: `**Config-Keys:**\n${keys.map((k) => `• ${k}`).join('\n')}` });
      }
    },
  },
];
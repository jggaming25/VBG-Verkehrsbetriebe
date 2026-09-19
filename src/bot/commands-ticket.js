import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { store } from '../store.js';
import { isStaff } from '../auth.js';
import { extractionId, fmtDate } from '../util.js';
import {
  addParticipant,
  removeParticipant,
  renameTicket,
  claimTicket,
  unclaimTicket,
  closeTicket,
  reopenTicket,
  requestTicketClose,
  forwardTicket,
  setTicketAlert,
  addTicketNote,
  clearTicketNotes,
  setAutoActions,
  createOnBehalf,
} from './core.js';

async function defer(i) {
  if (!i.deferred && !i.replied) await i.deferReply({ ephemeral: true });
}

async function reply(i, payload, ephemeral = true) {
  const opts = { ...payload };
  if (ephemeral) opts.ephemeral = true;
  if (!i.deferred && !i.replied) await i.reply(opts);
  else await i.editReply(opts);
}

function getTicketOf(guild, channel) {
  if (!channel) return null;
  const t = store.getTicket(guild.id, channel.id);
  return t && t.status !== 'deleted' ? t : null;
}

function parseIds(input) {
  return [...String(input || '').matchAll(/(\d{15,20})/g)].map((m) => m[1]);
}

export const ticketGroup = [
  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Ticket-Aktionen')
      .addSubcommand((s) =>
        s.setName('add').setDescription('Benutzer zum Ticket hinzufügen').addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName('alert').setDescription('Team auf das Ticket aufmerksam machen').addRoleOption((o) => o.setName('role').setDescription('Rolle die benachrichtigt wird'))
      )
      .addSubcommand((s) => s.setName('claim').setDescription('Ticket übernehmen'))
      .addSubcommand((s) =>
        s.setName('close').setDescription('Ticket schließen').addStringOption((o) => o.setName('reason').setDescription('Grund'))
      )
      .addSubcommand((s) =>
        s.setName('closerequest').setDescription('Schließanfrage stellen').addStringOption((o) => o.setName('reason').setDescription('Grund'))
      )
      .addSubcommand((s) =>
        s.setName('forward').setDescription('Ticket an andere Kategorie/Team weiterleiten')
          .addChannelOption((o) => o.setName('category').setDescription('Ziel-Kategorie (Kanal-Kategorie)').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Team-Rolle die zusätzlich informiert wird'))
      )
      .addSubcommand((s) =>
        s.setName('onbehalf').setDescription('Ticket im Namen eines Benutzers erstellen (VIP)')
          .addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
          .addStringOption((o) => o.setName('topic').setDescription('Thema'))
      )
      .addSubcommand((s) =>
        s.setName('remove').setDescription('Benutzer aus dem Ticket entfernen').addUserOption((o) => o.setName('user').setDescription('Benutzer').setRequired(true))
      )
      .addSubcommand((s) => s.setName('unclaim').setDescription('Ticket wieder freigeben'))
      .addSubcommand((s) =>
        s.setName('rename').setDescription('Ticket umbenennen').addStringOption((o) => o.setName('name').setDescription('Neuer Name').setRequired(true))
      )
      .addSubcommand((s) => s.setName('notes').setDescription('Private Team-Notizen').addStringOption((o) => o.setName('action').setDescription('add | list | clear').setRequired(true)).addStringOption((o) => o.setName('text').setDescription('Notiztext (bei add)').setMaxLength(1000))
      )
      .addSubcommand((s) => s.setName('disableautoactions').setDescription('Automatische Aktionen für dieses Ticket deaktivieren').addBooleanOption((o) => o.setName('value').setDescription('false = deaktivieren').setRequired(true))),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const sub = i.options.getSubcommand(true);
      const ticket = getTicketOf(guild, i.channel);

      if (sub === 'onbehalf') {
        if (!isStaff(i.member, cfg)) return reply(i, { content: '❌ Keine Berechtigung.' });
        const target = await resolveMember(guild, i.options.getUser('user').id);
        if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
        const cat = cfg.defaultCategoryId ? guild.channels.cache.get(cfg.defaultCategoryId) : null;
        await defer(i);
        const res = await createOnBehalf({ guild, actor: i.user, target, topic: i.options.getString('topic'), categoryChannel: cat });
        if (!res.ok) return reply(i, { content: res.error });
        return reply(i, { content: `📌 Ticket **${res.ticket.id}** im Namen von <@${target.id}> erstellt: <#${res.channel.id}>` });
      }

      if (!ticket) return reply(i, { content: '❌ Du musst dieses Command in einem Ticket-Kanal ausführen.' });
      const staff = isStaff(i.member, cfg);
      const creator = ticket.creatorId === i.user.id;
      const channel = guild.channels.cache.get(ticket.channelId);

      switch (sub) {
        case 'add': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const target = await resolveMember(guild, i.options.getUser('user').id);
          if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
          const res = await addParticipant({ guild, ticket, actor: i.user, target, channel });
          return reply(i, { content: res.ok ? `➕ <@${target.id}> hinzugefügt.` : res.error });
        }
        case 'remove': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const target = await resolveMember(guild, i.options.getUser('user').id);
          if (!target) return reply(i, { content: '❌ Benutzer nicht gefunden.' });
          const res = await removeParticipant({ guild, ticket, actor: i.user, target, channel });
          return reply(i, { content: res.ok ? `➖ <@${target.id}> entfernt.` : res.error });
        }
        case 'claim': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          if (ticket.claimedBy === i.user.id) {
            await unclaimTicket({ guild, ticket, actor: i.user });
          } else if (ticket.claimedBy) {
            return reply(i, { content: `Bereits von <@${ticket.claimedBy}> übernommen.` });
          } else {
            await claimTicket({ guild, ticket, actor: i.user });
          }
          await channel?.send({ content: `🖐️ <@${i.user.id}> ${ticket.claimedBy === i.user.id ? 'gibt das Ticket frei.' : 'übernimmt das Ticket.'}` });
          return reply(i, { content: 'Status aktualisiert.' });
        }
        case 'unclaim': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          await unclaimTicket({ guild, ticket, actor: i.user });
          await channel?.send({ content: `↩️ <@${i.user.id}> gibt das Ticket frei.` });
          return reply(i, { content: 'Unclaim erfolgreich.' });
        }
        case 'close': {
          if (!staff && !creator) return reply(i, { content: '❌ Keine Berechtigung.' });
          if (ticket.status === 'closed') return reply(i, { content: 'Ticket ist bereits geschlossen.' });
          await defer(i);
          const res = await closeTicket({ guild, ticket, actor: i.user, reason: i.options.getString('reason') });
          return reply(i, { content: `🔒 Ticket **${res.ticket.id}** geschlossen.` });
        }
        case 'closerequest': {
          if (!creator) return reply(i, { content: '❌ Nur der Ticket-Ersteller kann eine Schließanfrage stellen.' });
          if (ticket.status === 'closed') return reply(i, { content: 'Ticket ist bereits geschlossen.' });
          const res = await requestTicketClose({ guild, ticket, actor: i.user, reason: i.options.getString('reason') });
          return reply(i, { content: `🔔 Schließanfrage wurde an das Team übermittelt.` });
        }
        case 'forward': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const cat = i.options.getChannel('category');
          const role = i.options.getRole('role');
          const res = await forwardTicket({ guild, ticket, actor: i.user, category: cat.id, targetRole: role || null });
          if (!res.ok) return reply(i, { content: res.error });
          return reply(i, { content: `📨 Ticket weitergeleitet${cat.name ? ` an **${cat.name}**` : ''}.` });
        }
        case 'alert': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const role = i.options.getRole('role');
          const res = await setTicketAlert({ guild, ticket, actor: i.user, role, channel });
          return reply(i, { content: `🚨 Alert${role ? ` an <@&${role.id}>` : ''} gesetzt.` });
        }
        case 'rename': {
          if (!staff && !creator) return reply(i, { content: '❌ Keine Berechtigung.' });
          const res = await renameTicket({ guild, ticket, actor: i.user, name: i.options.getString('name'), channel });
          return reply(i, { content: res.ok ? `✏️ Ticket umbenannt in **${res.ticket.channelName}**.` : res.error });
        }
        case 'notes': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const action = i.options.getString('action');
          if (action === 'clear') {
            await clearTicketNotes({ guild, ticket, actor: i.user });
            return reply(i, { content: '🗒️ Notizen gelöscht.' });
          }
          if (action === 'list') {
            if (!ticket.notes || !ticket.notes.length) return reply(i, { content: '📝 Keine privaten Notizen vorhanden.' });
            const lines = ticket.notes.map((n) => `**${n.byName}** · ${fmtDate(n.at)}\n${n.text}`);
            return reply(i, { content: `**📝 Private Team-Notizen für ${ticket.id}**\n\n${lines.join('\n\n').slice(0, 1900)}` });
          }
          const text = i.options.getString('text');
          if (!text) return reply(i, { content: '❌ Nutze /ticket notes action:add text:…' });
          const res = await addTicketNote({ guild, ticket, actor: i.user, text });
          return reply(i, { content: `📝 Notiz gespeichert (${ticket.notes.length} gesamt).` });
        }
        case 'disableautoactions': {
          if (!staff) return reply(i, { content: '❌ Keine Berechtigung.' });
          const val = i.options.getBoolean('value');
          await setAutoActions({ guild, ticket, enabled: val });
          return reply(i, { content: `⏸️ Automatische Aktionen ${val ? 'aktiviert' : 'deaktiviert'}.` });
        }
      }
      return reply(i, { content: 'Unbekannte Aktion.' });
    },
  },
];

async function resolveMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}
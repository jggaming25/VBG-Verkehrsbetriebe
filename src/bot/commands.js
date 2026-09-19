import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { isAdmin, isStaff } from '../auth.js';
import { more } from './commands-more.js';
import { ticketGroup } from './commands-ticket.js';
import { moderation } from './commands-moderation.js';
import { general } from './commands-general.js';
import { levels } from './commands-level.js';
import {
  createTicket,
  closeTicket,
  reopenTicket,
  claimTicket,
  unclaimTicket,
  buildPanelEmbed,
  panelRow,
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

function getTicketOf(i) {
  if (!i.channel) return null;
  const t = store.getTicket(i.guild.id, i.channel.id);
  return t && t.status !== 'deleted' ? t : null;
}

function ticketChannel(guild, ticket) {
  return guild.channels.cache.get(ticket.channelId) || null;
}

const EMOJIS = ['🎫', '📩', '🛠️', '🌐', '📣'];
const PANEL_CAT_OPTS = ['category', 'category2', 'category3', 'category4', 'category5'];

const base = [
  {
    data: new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Ticket-Panels erstellen / verwalten')
      .addSubcommand((s) =>
        s
          .setName('create')
          .setDescription('Erstelle ein Ticket-Panel (1–5 Kategorien)')
          .addChannelOption((o) => o.setName('channel').setDescription('Kanal für das Panel').setRequired(true))
          .addChannelOption((o) => o.setName('category').setDescription('Ticket-Kategorie').setRequired(true))
          .addChannelOption((o) => o.setName('category2').setDescription('Ticket-Kategorie'))
          .addChannelOption((o) => o.setName('category3').setDescription('Ticket-Kategorie'))
          .addChannelOption((o) => o.setName('category4').setDescription('Ticket-Kategorie'))
          .addChannelOption((o) => o.setName('category5').setDescription('Ticket-Kategorie'))
          .addStringOption((o) => o.setName('title').setDescription('Panel-Titel'))
          .addStringOption((o) => o.setName('description').setDescription('Panel-Beschreibung'))
          .addStringOption((o) => o.setName('color').setDescription('Farbe HEX, z.B. #5865F2'))
      )
      .addSubcommand((s) =>
        s
          .setName('delete')
          .setDescription('Lösche ein Panel')
          .addChannelOption((o) => o.setName('channel').setDescription('Kanal mit dem Panel').setRequired(true))
      )
      .addSubcommand((s) => s.setName('list').setDescription('Liste alle Panels')),
    async execute(i) {
      const sub = i.options.getSubcommand(true);
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);

      if (sub === 'list') {
        await defer(i);
        const panels = store.getPanels(guild.id);
        if (!panels.length) return reply(i, { content: 'Keine Panels vorhanden.' });
        const lines = panels.map((p) => `**${p.name || p.title}** – <#${p.channelId}> – ${p.categories.length} Kategorie(n)`);
        return reply(i, { content: `📋 **Panels (${panels.length})**\n${lines.join('\n')}` });
      }

      if (!isAdmin(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });

      if (sub === 'create') {
        const target = i.options.getChannel('channel');
        if (!target || !target.isTextBased()) return reply(i, { content: t(cfg, 'panel_invalid_channel') });
        const cats = PANEL_CAT_OPTS.map((n) => i.options.getChannel(n)).filter(Boolean);
        const categories = cats.map((c, idx) => ({
          id: `cat_${c.id}`,
          label: c.name,
          name: c.name,
          prefix: c.name.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 20) || 'ticket',
          emoji: EMOJIS[idx] || '🎫',
          description: '',
          channelId: c.id,
          categoryId: c.id,
          active: true,
        }));
        const panel = {
          id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
          guildId: guild.id,
          channelId: target.id,
          name: i.options.getString('title') || t(cfg, 'panel_title_default'),
          title: i.options.getString('title') || t(cfg, 'panel_title_default'),
          description: i.options.getString('description') || t(cfg, 'panel_desc_default'),
          color: i.options.getString('color') || cfg.embed.color || '#5865F2',
          footer: null,
          thumbnail: null,
          ticketNameFormat: 'PREFIX-USERNAME',
          categories,
          createdAt: Date.now(),
        };
        store.addPanel(guild.id, panel);
        await target.send({ embeds: [buildPanelEmbed(panel, guild.name)], components: panelRow(panel) });
        return reply(i, { content: `✅ Panel **${panel.name}** in <#${target.id}> erstellt (${categories.length} Kategorie(n)).` });
      }

      if (sub === 'delete') {
        const target = i.options.getChannel('channel');
        const panel = store.getPanels(guild.id).find((p) => p.channelId === target.id);
        if (!panel) return reply(i, { content: 'Kein Panel in diesem Kanal gefunden.' });
        store.removePanel(guild.id, panel.id);
        return reply(i, { content: `🗑️ Panel **${panel.title}** gelöscht.` });
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('new')
      .setDescription('Erstelle manuell ein Ticket')
      .addStringOption((o) => o.setName('topic').setDescription('Thema des Tickets')),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const cat = cfg.defaultCategoryId ? guild.channels.cache.get(cfg.defaultCategoryId) : null;
      const res = await createTicket({ guild, creator: i.member, topic: i.options.getString('topic'), categoryChannel: cat });
      if (!res.ok) return reply(i, { content: res.error });
      return reply(i, { content: `🎫 Ticket erstellt: <#${res.channel.id}>` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('close')
      .setDescription('Schließe ein Ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (ticket.status === 'closed') return reply(i, { content: t(cfg, 'errors_ticket_closed') });
      if (!isStaff(i.member, cfg) && ticket.creatorId !== i.user.id) return reply(i, { content: t(cfg, 'errors_no_perm') });
      await defer(i);
      const res = await closeTicket({ guild, ticket, actor: i.user, reason: i.options.getString('reason') });
      return reply(i, { content: `🔒 Ticket **${res.ticket.id}** geschlossen.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('reopen')
      .setDescription('Öffne ein geschlossenes Ticket wieder')
      .addStringOption((o) => o.setName('reason').setDescription('Grund')),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      if (ticket.status !== 'closed') return reply(i, { content: t(cfg, 'errors_ticket_open') });
      await defer(i);
      const res = await reopenTicket({ guild, ticket, actor: i.user, reason: i.options.getString('reason') });
      return reply(i, { content: `🔓 Ticket **${res.ticket.id}** wiedereröffnet.` });
    },
  },

  {
    data: new SlashCommandBuilder().setName('claim').setDescription('Übernimm ein Ticket'),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      if (ticket.claimedBy && ticket.claimedBy !== i.user.id) {
        return reply(i, { content: `Bereits von <@${ticket.claimedBy}> übernommen.` });
      }
      if (ticket.claimedBy === i.user.id) {
        await unclaimTicket({ guild, ticket, actor: i.user });
      } else {
        await claimTicket({ guild, ticket, actor: i.user });
      }
      await ticketChannel(guild, ticket)?.send({ content: `🖐️ <@${i.user.id}> ${ticket.claimedBy === i.user.id ? 'gibt frei' : 'übernimmt'} das Ticket.` });
      return reply(i, { content: 'Status aktualisiert.' });
    },
  },

  {
    data: new SlashCommandBuilder().setName('unclaim').setDescription('Gib ein Ticket wieder frei'),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      await unclaimTicket({ guild, ticket, actor: i.user });
      await ticketChannel(guild, ticket)?.send({ content: `↩️ <@${i.user.id}> gibt das Ticket frei.` });
      return reply(i, { content: 'Unclaim erfolgreich.' });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('delete')
      .setDescription('Lösche ein Ticket (Kanal wird entfernt)'),
    async execute(i) {
      const guild = i.guild;
      const cfg = store.ensureConfig(guild.id);
      const ticket = getTicketOf(i);
      if (!ticket) return reply(i, { content: t(cfg, 'errors_no_ticket') });
      if (!isStaff(i.member, cfg)) return reply(i, { content: t(cfg, 'errors_no_perm') });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:delc:${ticket.id}`).setLabel('Ja, löschen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tk:delx:${ticket.id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
      );
      return reply(i, { content: `⚠️ Sicher? **${ticket.id}** wird unwiderruflich gelöscht.`, components: [row] });
    },
  },
];

export const commands = [...base, ...more, ...ticketGroup, ...moderation, ...general, ...levels];
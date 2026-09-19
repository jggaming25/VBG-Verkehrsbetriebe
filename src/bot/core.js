import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { uid, parseHexColor } from '../util.js';
import { buildTranscript } from '../transcript.js';

const VIEW = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
const TEXT = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];
const STAFF = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageMessages,
];

function embedColor(cfg) {
  return parseHexColor(cfg?.embed?.color);
}

// ---------------------------------------------------------------- helpers

async function ovw(channel, target, options) {
  const existing = channel.permissionOverwrites.resolve(target);
  if (existing) {
    await channel.permissionOverwrites.edit(target, options).then(
      () => {},
      () => channel.permissionOverwrites.create(target, options)
    );
  } else {
    await channel.permissionOverwrites.create(target, options);
  }
}

function staffRoles(cfg) {
  return new Set([...(cfg?.supportRoles || []), ...(cfg?.managerRoles || []), ...(cfg?.adminRoles || []), config.adminRoleId]);
}

export function rowTicketActions(ticketId, claimed = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tk:claim:${ticketId}`)
        .setLabel(claimed ? 'Unclaim' : 'Claim')
        .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('🖐️'),
      new ButtonBuilder().setCustomId(`tk:add:${ticketId}`).setLabel('Add User').setStyle(ButtonStyle.Primary).setEmoji('➕'),
      new ButtonBuilder().setCustomId(`tk:close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    ),
  ];
}

export function rowClosedActions(ticketId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tk:reopen:${ticketId}`).setLabel('Reopen').setStyle(ButtonStyle.Secondary).setEmoji('🔓'),
      new ButtonBuilder().setCustomId(`tk:delete:${ticketId}`).setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
    ),
  ];
}

export function feedbackRow(ticketId) {
  return [
    new ActionRowBuilder().addComponents(
      ...[1, 2, 3, 4, 5].map((s) =>
        new ButtonBuilder().setCustomId(`fb:${s}:${ticketId}`).setLabel('⭐'.repeat(s)).setStyle(ButtonStyle.Secondary)
      )
    ),
  ];
}

export function buildPanelEmbed(panel, guildName) {
  const e = new EmbedBuilder()
    .setColor(parseHexColor(panel.color || '#5865F2'))
    .setTitle(panel.title)
    .setDescription(panel.description || '');
  if (panel.thumbnail) e.setThumbnail(panel.thumbnail);
  if (panel.footer) e.setFooter({ text: panel.footer });
  if (guildName && !panel.footer) e.setFooter({ text: guildName });
  return e;
}

export function panelRow(panel) {
  if (panel.categories.length === 1) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`popen:${panel.id}`)
          .setLabel(panel.categories[0].label)
          .setStyle(ButtonStyle.Primary)
          .setEmoji(panel.categories[0].emoji || '🎫')
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pselect:${panel.id}`)
        .setPlaceholder('Wähle eine Kategorie…')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          panel.categories.map((c) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(String(c.label).slice(0, 90))
              .setValue(c.channelId)
              .setEmoji(c.emoji || '🎫')
          )
        )
    ),
  ];
}

// ---------------------------------------------------------------- create

export async function createTicket({ guild, creator, panel, topic, categoryChannel }) {
  const cfg = store.ensureConfig(guild.id);
  const open = store.getTickets(guild.id).filter((x) => x.status === 'open' && x.creatorId === creator.id).length;
  if (cfg.maxTicketsPerUser > 0 && open >= cfg.maxTicketsPerUser) {
    return { ok: false, error: t(cfg, 'ticket_created_limited') };
  }

  const seq = store.nextSeq(guild.id);
  const id = `T-${String(seq).padStart(4, '0')}`;
  const cat = categoryChannel || (cfg.defaultCategoryId ? guild.channels.cache.get(cfg.defaultCategoryId) : null);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: creator.id, allow: TEXT },
  ];
  for (const rid of staffRoles(cfg)) {
    if (rid) overwrites.push({ id: rid, allow: STAFF });
  }
  if (cfg.openRoleId) overwrites.push({ id: cfg.openRoleId, allow: VIEW });
  for (const rid of cfg.accessRoles || []) {
    if (rid) overwrites.push({ id: rid, allow: VIEW });
  }

  const channel = await guild.channels.create({
    name: `ticket-${seq}`,
    type: ChannelType.GuildText,
    parent: cat ? cat.id : undefined,
    reason: `Ticket ${id}`,
    permissionOverwrites: overwrites,
  });

  const ticket = {
    id,
    seq,
    guildId: guild.id,
    channelId: channel.id,
    channelName: channel.name,
    creatorId: creator.id,
    creatorName: creator.displayName,
    creatorTag: creator.user.tag,
    creatorAvatar: creator.user.displayAvatarURL({ size: 128 }),
    panelId: panel ? panel.id : null,
    topic: topic || (panel && panel.name) || null,
    categoryName: cat ? cat.name : null,
    status: 'open',
    claimedBy: null,
    claimAt: null,
    participants: [{ id: creator.id, name: creator.displayName }],
    messageCount: 0,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    firstResponseAt: null,
    closedAt: null,
    closeReason: null,
    closeBy: null,
    closeByTag: null,
    reopenCount: 0,
    transcriptPath: null,
    feedback: null,
  };
  store.addTicket(ticket);

  const embed = new EmbedBuilder()
    .setColor(embedColor(cfg))
    .setTitle(embedOf(cfg, 'title', t(cfg, 'ticket_welcome_title')))
    .setDescription(embedOf(cfg, 'description', t(cfg, 'ticket_welcome_desc')))
    .addFields(
      { name: t(cfg, 'ticket_welcome_topic'), value: ticket.topic || '–', inline: true },
      { name: t(cfg, 'ticket_welcome_owner'), value: `<@${creator.id}>`, inline: true },
      { name: 'ID', value: id, inline: true }
    )
    .setTimestamp();
  if (embedOf(cfg, 'author')) embed.setAuthor({ name: embedOf(cfg, 'author') });
  if (embedOf(cfg, 'thumbnail')) embed.setThumbnail(embedOf(cfg, 'thumbnail'));
  if (embedOf(cfg, 'footer')) embed.setFooter({ text: embedOf(cfg, 'footer') });

  const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;
  await channel.send({ content: ping || undefined, embeds: [embed], components: rowTicketActions(ticket.id) });

  logAction(guild, 'created', { ticket, actor: creator, detail: ticket.topic || '' });
  await sendLog(guild, 'created', cfg, { ticket, actor: creator });
  return { ok: true, ticket, channel };
}

function embedOf(cfg, key, fallback) {
  return (cfg && cfg.embed && cfg.embed[key]) || fallback || null;
}

// ---------------------------------------------------------------- close

export async function closeTicket({ guild, ticket, actor, reason, auto = false }) {
  const cfg = store.ensureConfig(guild.id);
  const channel = guild.channels.cache.get(ticket.channelId);
  try {
    if (channel) {
      await ovw(channel, guild.roles.everyone, { ViewChannel: false, SendMessages: false });
      const keep = new Set([ticket.creatorId, ...ticket.participants.map((p) => p.id)]);
      for (const rid of [...staffRoles(cfg), cfg.openRoleId, cfg.closedRoleId, ...(cfg.accessRoles || [])]) {
        if (rid) keep.add(rid);
      }
      for (const rid of keep) {
        if (!rid) continue;
        await ovw(channel, rid, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false });
      }
      if (cfg.closedCategoryId && channel.parentId !== cfg.closedCategoryId) {
        const cat = guild.channels.cache.get(cfg.closedCategoryId);
        if (cat) await channel.setParent(cat.id, { lockPermissions: false });
      }
    }
  } catch (e) {
    console.error('[CLOSE] Lockdown fehlgeschlagen:', e.message);
  }

  const patch = {
    status: 'closed',
    closedAt: Date.now(),
    closeReason: reason || null,
    closeBy: auto ? null : actor ? actor.id : null,
    closeByTag: auto ? null : actor ? actor.user.tag : null,
    lastActivityAt: Date.now(),
  };
  if (cfg.autoTranscripts && channel && channel.viewable) {
    try {
      const tr = await buildTranscript(channel, cfg, ticket);
      patch.transcriptPath = tr.relPath;
    } catch (e) {
      console.error('[CLOSE] Transkript fehlgeschlagen:', e.message);
    }
  }
  store.updateTicket(ticket.id, patch);
  Object.assign(ticket, patch);

  if (channel && channel.viewable) {
    const embed = new EmbedBuilder()
      .setColor(0xeb4034)
      .setTitle(t(cfg, 'ticket_closed_title'))
      .setDescription(t(cfg, 'ticket_closed_desc'))
      .setTimestamp();
    embed.addFields({ name: t(cfg, 'ticket_closed_by'), value: auto ? t(cfg, 'ticket_closed_by_system') : `<@${actor.id}>`, inline: true });
    if (reason) embed.addFields({ name: t(cfg, 'ticket_closed_reason'), value: reason.slice(0, 200), inline: true });
    await channel.send({ embeds: [embed], components: rowClosedActions(ticket.id) });
    if (cfg.feedbackEnabled && ticket.creatorId) {
      await channel.send({ content: t(cfg, 'feedback_prompt'), components: feedbackRow(ticket.id) });
    }
  }
  logAction(guild, 'closed', { ticket, actor: auto ? null : actor, detail: reason || '' });
  await sendLog(guild, 'closed', cfg, { ticket, actor: auto ? null : actor, detail: reason || '' });
  return { ok: true, ticket };
}

// ---------------------------------------------------------------- reopen

export async function reopenTicket({ guild, ticket, actor, reason }) {
  const cfg = store.ensureConfig(guild.id);
  const channel = guild.channels.cache.get(ticket.channelId);
  try {
    if (channel) {
      await ovw(channel, guild.roles.everyone, { ViewChannel: false, SendMessages: false });
      await ovw(channel, ticket.creatorId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
      for (const p of ticket.participants) {
        if (p.id !== ticket.creatorId) await ovw(channel, p.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
      }
      for (const rid of [...staffRoles(cfg)]) {
        if (rid) await ovw(channel, rid, STAFF);
      }
      if (cfg.openRoleId) await ovw(channel, cfg.openRoleId, VIEW);
      for (const rid of cfg.accessRoles || []) {
        if (rid) await ovw(channel, rid, VIEW);
      }
      if (cfg.defaultCategoryId && cfg.defaultCategoryId !== channel.parentId) {
        const cat = guild.channels.cache.get(cfg.defaultCategoryId);
        if (cat) await channel.setParent(cat.id, { lockPermissions: false });
      }
    }
  } catch (e) {
    console.error('[REOPEN]', e.message);
  }

  const patch = {
    status: 'open',
    claimedBy: null,
    claimAt: null,
    reopenCount: (ticket.reopenCount || 0) + 1,
    closedAt: null,
    lastActivityAt: Date.now(),
  };
  store.updateTicket(ticket.id, patch);
  Object.assign(ticket, patch);

  if (channel && channel.viewable) {
    const embed = new EmbedBuilder()
      .setColor(embedColor(cfg))
      .setTitle(t(cfg, 'ticket_reopened_title'))
      .setDescription(t(cfg, 'ticket_reopened_desc'))
      .setTimestamp();
    await channel.send({ embeds: [embed], components: rowTicketActions(ticket.id) });
  }
  logAction(guild, 'reopened', { ticket, actor, detail: reason || '' });
  await sendLog(guild, 'reopened', cfg, { ticket, actor, detail: reason || '' });
  return { ok: true, ticket };
}

// ---------------------------------------------------------------- delete

export async function deleteTicket({ guild, ticket, actor }) {
  const cfg = store.ensureConfig(guild.id);
  const channel = guild.channels.cache.get(ticket.channelId);
  const patch = { status: 'deleted', deletedAt: Date.now() };
  store.updateTicket(ticket.id, patch);
  Object.assign(ticket, patch);
  if (channel) {
    try {
      await channel.delete(`Ticket ${ticket.id} gelöscht`);
    } catch (e) {
      console.error('[DELETE]', e.message);
    }
  }
  logAction(guild, 'deleted', { ticket, actor });
  await sendLog(guild, 'deleted', cfg, { ticket, actor });
  return { ok: true, ticket };
}

// ---------------------------------------------------------------- claim

export async function claimTicket({ guild, ticket, actor }) {
  const cfg = store.ensureConfig(guild.id);
  const patch = { status: 'claimed', claimedBy: actor.id, claimAt: Date.now(), lastActivityAt: Date.now() };
  store.updateTicket(ticket.id, patch);
  Object.assign(ticket, patch);
  logAction(guild, 'claimed', { ticket, actor });
  await sendLog(guild, 'claimed', cfg, { ticket, actor });
  return { ok: true, ticket };
}

export async function unclaimTicket({ guild, ticket, actor }) {
  const cfg = store.ensureConfig(guild.id);
  const patch = { status: 'open', claimedBy: null, claimAt: null, lastActivityAt: Date.now() };
  store.updateTicket(ticket.id, patch);
  Object.assign(ticket, patch);
  logAction(guild, 'unclaimed', { ticket, actor });
  await sendLog(guild, 'unclaimed', cfg, { ticket, actor });
  return { ok: true, ticket };
}

// ---------------------------------------------------------------- participants

export async function addParticipant({ guild, ticket, actor, target, channel }) {
  const cfg = store.ensureConfig(guild.id);
  try {
    await ovw(channel, target.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!ticket.participants.find((p) => p.id === target.id)) {
    ticket.participants.push({ id: target.id, name: target.displayName });
  }
  store.updateTicket(ticket.id, { participants: ticket.participants });
  logAction(guild, 'added', { ticket, actor, detail: `<@${target.id}>` });
  await sendLog(guild, 'added', cfg, { ticket, actor, detail: `<@${target.id}>` });
  return { ok: true, ticket };
}

export async function removeParticipant({ guild, ticket, actor, target, channel }) {
  const cfg = store.ensureConfig(guild.id);
  if (target.id === ticket.creatorId) return { ok: false, error: t(cfg, 'errors_only_creator') };
  try {
    const existing = channel.permissionOverwrites.resolve(target.id);
    if (existing) await existing.delete(`Ticket ${ticket.id}`);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  ticket.participants = ticket.participants.filter((p) => p.id !== target.id);
  store.updateTicket(ticket.id, { participants: ticket.participants });
  logAction(guild, 'removed', { ticket, actor, detail: `<@${target.id}>` });
  await sendLog(guild, 'removed', cfg, { ticket, actor, detail: `<@${target.id}>` });
  return { ok: true, ticket };
}

export async function renameTicket({ guild, ticket, actor, name, channel }) {
  const cfg = store.ensureConfig(guild.id);
  const safeName = String(name).toLowerCase().replace(/[^a-z0-9-_ ]/g, '-').replace(/\s+/g, '-');
  try {
    await channel.setName(safeName, `Ticket ${ticket.id} umbenannt`);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  store.updateTicket(ticket.id, { channelName: safeName });
  ticket.channelName = safeName;
  logAction(guild, 'renamed', { ticket, actor, detail: name });
  await sendLog(guild, 'renamed', cfg, { ticket, actor, detail: name });
  return { ok: true, ticket };
}

// ---------------------------------------------------------------- feedback

export async function giveFeedback({ guild, ticket, stars, comment, actor }) {
  if (!ticket || ticket.feedback) return { ok: false, error: 'already' };
  const feed = { stars, comment: comment || null, byName: actor ? actor.user.tag : null, at: Date.now() };
  store.updateTicket(ticket.id, { feedback: feed });
  const cfg = store.ensureConfig(guild.id);
  logAction(guild, 'feedback', { ticket, actor, detail: `${'★'.repeat(stars)}` + (comment ? ` – ${comment}` : '') });
  await sendLog(guild, 'feedback', cfg, { ticket, actor, detail: `${'★'.repeat(stars)}` + (comment ? ` – ${comment}` : '') });
  return { ok: true, feedback: feed };
}

// ---------------------------------------------------------------- logs

const LOG_STYLES = {
  created: [0x00ffba, '📩 Ticket erstellt'],
  closed: [0xeb4034, '🔒 Ticket geschlossen'],
  deleted: [0xeb4034, '🗑️ Ticket gelöscht'],
  reopened: [0x00ffba, '🔓 Ticket wiedereröffnet'],
  claimed: [0x5865f2, '🖐️ Ticket geclaimt'],
  unclaimed: [0x5865f2, '↩️ Claim zurückgenommen'],
  renamed: [0xf5c542, '✏️ Ticket umbenannt'],
  added: [0x57f287, '➕ Benutzer hinzugefügt'],
  removed: [0xed4245, '➖ Benutzer entfernt'],
  feedback: [0x7b5cff, '⭐ Feedback erhalten'],
  transcript: [0x00ffba, '📄 Transkript exportiert'],
};

export function logAction(guild, type, { ticket, actor, detail } = {}) {
  store.addAction({
    id: uid(),
    guildId: guild.id,
    at: Date.now(),
    type,
    ticketId: ticket ? ticket.id : null,
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.user.tag : null,
    detail: detail || '',
  });
}

export async function sendLog(guild, type, cfg, { ticket, actor, detail } = {}) {
  const chId = cfg.logChannelId;
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (!ch || !ch.viewable) return;
  const [color, title] = LOG_STYLES[type] || [0x5865f2, type];
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields({ name: 'Ticket', value: ticket ? `${ticket.id} (<#${ticket.channelId}>)` : '–', inline: true })
    .setTimestamp();
  if (actor) e.addFields({ name: 'Von', value: `<@${actor.id}>`, inline: true });
  if (detail) e.addFields({ name: 'Details', value: String(detail).slice(0, 300), inline: false });
  await ch.send({ embeds: [e] }).catch(() => {});
}

// ---------------------------------------------------------------- misc

export function ticketInfoEmbed(cfg, ticket) {
  const e = new EmbedBuilder()
    .setColor(ticket.status === 'closed' ? 0xeb4034 : ticket.status === 'claimed' ? 0xf5c542 : embedColor(cfg))
    .setTitle(t(cfg, 'ticket_info_title') + ` – ${ticket.id}`)
    .addFields(
      { name: 'Status', value: ticket.status, inline: true },
      { name: 'Ersteller', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Kanal', value: `<#${ticket.channelId}>`, inline: true }
    )
    .setTimestamp();
  if (ticket.topic) e.addFields({ name: 'Thema', value: String(ticket.topic), inline: true });
  if (ticket.claimedBy) e.addFields({ name: t(cfg, 'ticket_claimed_by'), value: `<@${ticket.claimedBy}>`, inline: true });
  if (ticket.createdAt) e.addFields({ name: 'Erstellt', value: `<t:${Math.floor(ticket.createdAt / 1000)}:F>`, inline: true });
  if (ticket.closedAt) e.addFields({ name: 'Geschlossen', value: `<t:${Math.floor(ticket.closedAt / 1000)}:F>`, inline: true });
  if (ticket.closeReason) e.addFields({ name: t(cfg, 'ticket_closed_reason'), value: ticket.closeReason.slice(0, 200) });
  if (ticket.feedback) {
    e.addFields({ name: '⭐ Feedback', value: '★'.repeat(ticket.feedback.stars) + '☆'.repeat(5 - ticket.feedback.stars) + (ticket.feedback.comment ? `\n» ${ticket.feedback.comment}` : '') });
  }
  if (ticket.participants && ticket.participants.length) {
    e.addFields({ name: 'Teilnehmer', value: ticket.participants.map((p) => `<@${p.id}>`).join(' '), inline: true });
  }
  return e;
}
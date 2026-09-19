import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { store } from '../store.js';
import { parseHexColor } from '../util.js';
import { dmUser } from './moderation.js';

function matchCategory(cfg, raw) {
  const cats = cfg.suggestions?.categories || [];
  const needle = String(raw || '').toLowerCase();
  return cats.find((c) => c.name.toLowerCase() === needle) || cats.find((c) => c.name.toLowerCase().includes(needle)) || cats[0] || { name: 'Allgemein', emoji: '💡' };
}

export function suggestionEmbed(cfg, s) {
  const color = s.status === 'accepted' ? 0x23a55a : s.status === 'declined' ? 0xeb4034 : parseHexColor(cfg.embed.color);
  const title = s.status === 'accepted' ? '✅ Angenommen' : s.status === 'declined' ? '❌ Abgelehnt' : '💡 Vorschlag';
  const e = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${s.authorTag}`, iconURL: s.authorAvatar })
    .setTitle(`${s.categoryEmoji || '💡'} ${title} #${s.seq}`)
    .setDescription(s.idea)
    .setFooter({ text: `Vorschlag ${s.id}` })
    .setTimestamp(s.at);
  if (s.decidedAt) e.addFields({ name: s.status === 'accepted' ? 'Akzeptiert' : 'Abgelehnt', value: s.decisionReason || '–' });
  return e;
}

export function suggestionRow(s) {
  if (s.status !== 'pending') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sug:resetv:${s.id}`).setLabel('Stimmen zurücksetzen').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
        new ButtonBuilder().setCustomId(`sug:info:${s.id}`).setLabel(`${s.up} 👍 · ${s.down} 👎`).setStyle(ButtonStyle.Secondary).setDisabled(true)
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sug:up:${s.id}`).setLabel('Dafür').setStyle(ButtonStyle.Success).setEmoji('👍'),
      new ButtonBuilder().setCustomId(`sug:down:${s.id}`).setLabel('Dagegen').setStyle(ButtonStyle.Danger).setEmoji('👎'),
      new ButtonBuilder().setCustomId(`sug:info:${s.id}`).setLabel(`${s.up} 👍 · ${s.down} 👎`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`sug:accept:${s.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Primary).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`sug:decline:${s.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setEmoji('❌')
    ),
  ];
}

export async function submitSuggestion({ guild, author, category, idea }) {
  const cfg = store.ensureConfig(guild.id);
  const cat = matchCategory(cfg, category);
  const seq = store.nextSuggestionSeq(guild.id);
  const id = `S-${String(seq).padStart(3, '0')}`;
  const s = {
    id,
    seq,
    guildId: guild.id,
    category: cat.name,
    categoryEmoji: cat.emoji || '💡',
    idea,
    authorId: author.id,
    authorTag: author.user.tag,
    authorAvatar: author.user.displayAvatarURL({ size: 128 }),
    up: [],
    down: [],
    voters: [],
    status: 'pending',
    decidedBy: null,
    decisionReason: null,
    decidedAt: null,
    at: Date.now(),
  };
  store.addSuggestion(s);
  const channel = cfg.suggestions.channelId ? guild.channels.cache.get(cfg.suggestions.channelId) : null;
  if (!channel || !channel.viewable) {
    store.updateSuggestion(guild.id, id, { status: 'error' });
    return { ok: false, error: 'Vorschlagskanal nicht verfügbar.' };
  }
  const msg = await channel.send({ embeds: [suggestionEmbed(cfg, s)], components: suggestionRow(s) });
  store.updateSuggestion(guild.id, id, { messageId: msg.id });
  if (cfg.suggestions.requireApproval && cfg.suggestions.reviewChannelId) {
    const review = guild.channels.cache.get(cfg.suggestions.reviewChannelId);
    if (review && review.viewable) {
      await review.send({ embeds: [suggestionEmbed(cfg, { ...s, status: 'pending' })], content: `🔎 Zur Prüfung: <#${channel.id}>` }).catch(() => {});
    }
  }
  return { ok: true, suggestion: s };
}

export async function voteSuggestion({ guild, suggestion, voter, direction }) {
  const s = suggestion;
  const hasUp = s.up.includes(voter.id);
  const hasDown = s.down.includes(voter.id);
  if (direction === 'up') {
    if (hasUp) s.up = s.up.filter((x) => x !== voter.id);
    else {
      s.up.push(voter.id);
      s.down = s.down.filter((x) => x !== voter.id);
    }
  } else {
    if (hasDown) s.down = s.down.filter((x) => x !== voter.id);
    else {
      s.down.push(voter.id);
      s.up = s.up.filter((x) => x !== voter.id);
    }
  }
  store.updateSuggestion(guild.id, s.id, { up: s.up, down: s.down });
  return { ok: true, changed: direction === 'up' ? hasUp ? 'removed' : 'added' : hasDown ? 'removed' : 'added' };
}

export async function decideSuggestion({ guild, suggestion, decision, moderator, reason = null }) {
  const cfg = store.ensureConfig(guild.id);
  const s = suggestion;
  if (decision === 'reset') {
    const patch = { up: [], down: [], voters: [], decidedBy: null, decisionReason: null, decidedAt: null };
    if (s.status !== 'pending') patch.status = 'pending';
    store.updateSuggestion(guild.id, s.id, patch);
    Object.assign(s, patch);
    await refreshSuggestionMessage(guild, s, cfg);
    return { ok: true };
  }
  const patch = {
    status: decision,
    decidedBy: moderator ? moderator.id : null,
    decisionReason: reason || null,
    decidedAt: Date.now(),
  };
  store.updateSuggestion(guild.id, s.id, patch);
  Object.assign(s, patch);
  await refreshSuggestionMessage(guild, s, cfg);
  const author = await guild.members.fetch(s.authorId).catch(() => null);
  if (cfg.suggestions.dmOnDecide && author && !isOptedOut(guild, s.authorId)) {
    const txt = decision === 'accepted' ? `✅ Dein Vorschlag **${s.id}** wurde angenommen!` : `❌ Dein Vorschlag **${s.id}** wurde abgelehnt${reason ? `:\n${reason}` : '.'}`;
    await dmUser(author, txt);
  }
  return { ok: true };
}

async function refreshSuggestionMessage(guild, s, cfg) {
  if (!s.messageId) return;
  const channel = cfg.suggestions.channelId ? guild.channels.cache.get(cfg.suggestions.channelId) : null;
  if (!channel) return;
  const msg = await channel.messages.fetch(s.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [suggestionEmbed(cfg, s)], components: suggestionRow(s) }).catch(() => {});
}

function isOptedOut(guild, userId) {
  const cfg = store.getConfig(guild.id);
  return (cfg && cfg.optOuts || []).includes(userId);
}
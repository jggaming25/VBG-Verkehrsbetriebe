import { EmbedBuilder } from 'discord.js';
import { store } from '../store.js';
import { isAdmin } from '../auth.js';

export function requireMod(member, cfg) {
  if (!member || !cfg.moderation) return false;
  if (isAdmin(member, cfg)) return true;
  const modRoles = cfg.moderation.modRoles || [];
  return modRoles.length > 0 && member.roles.cache.some((r) => modRoles.includes(r.id));
}

export function modColor(type) {
  return { warn: 0xf5c542, mute: 0xf0b232, kick: 0xed4245, ban: 0xed4245, unban: 0x23a55a, unmute: 0x23a55a, unwarn: 0x23a55a, clear: 0x5865f2, report: 0xeb4034 }[type] || 0x5865f2;
}

function modLabel(type) {
  return { warn: '⚠️ Warnung', unwarn: '✅ Warnung entfernt', mute: '🔇 Mute', unmute: '🔊 Unmute', kick: '👢 Kick', ban: '🔨 Ban', unban: '🟢 Unban', clear: '🧹 Nachrichten gelöscht', report: '🚩 Report' }[type] || type;
}

export function userCaseId(c) {
  return `Case-${String(c.guildId === store ? c.id : c.id).toUpperCase()}`;
}

export function openCase(guild, type, target, moderator, reason = '') {
  const id = `Case-${String(store.nextCaseSeq(guild.id)).padStart(3, '0')}`;
  const c = store.addCase({
    id,
    guildId: guild.id,
    type,
    userId: target?.id || null,
    userTag: target?.user?.tag || null,
    moderatorId: moderator?.id || null,
    moderatorTag: moderator?.user?.tag || null,
    reason: reason || '',
    at: Date.now(),
    status: type.startsWith('un') || type === 'clear' || type === 'report' ? 'closed' : 'active',
    meta: {},
  });
  return c;
}

export async function sendModLog(guild, cfg, c, extraFields = []) {
  const chId = cfg.moderation?.modlogChannelId;
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (!ch || !ch.viewable) return;
  const e = new EmbedBuilder()
    .setColor(typeof c === 'object' && c.type ? modColor(c.type) : 0x5865f2)
    .setTitle(typeof c === 'object' && c.type ? modLabel(c.type) : String(c)?.toUpperCase?.() || 'Mod-Aktion')
    .addFields(
      { name: 'Case', value: typeof c === 'object' && c.id ? c.id : '–', inline: true },
      ...(c.userTag ? [{ name: 'Benutzer', value: `<@${c.userId}> (${c.userTag})`, inline: true }] : []),
      ...(c.moderatorTag ? [{ name: 'Moderator', value: `<@${c.moderatorId}>`, inline: true }] : [])
    )
    .setTimestamp();
  if (c.reason) e.addFields({ name: 'Grund', value: String(c.reason).slice(0, 200) });
  for (const f of extraFields) e.addFields(f);
  await ch.send({ embeds: [e] }).catch(() => {});
}

export async function dmUser(target, content) {
  if (!target) return;
  try {
    await target.send(content);
  } catch {
    /* DMs geschlossen */
  }
}

export async function applyWarnLimit(guild, cfg, target, moderator) {
  if (!cfg.moderation?.warnLimit || !target) return;
  const active = store.getCases(guild.id, target.id).filter((c) => c.type === 'warn' && c.status === 'active').length;
  if (active < cfg.moderation.warnLimit) return;
  if (!target.kickable) return;
  if (cfg.moderation.warnAction === 'ban') {
    await target.ban({ reason: `Warnlimit erreicht (${active} Warnungen)` });
  } else if (cfg.moderation.warnAction === 'kick') {
    await target.kick(`Warnlimit erreicht (${active} Warnungen)`);
  } else if (target.manageable) {
    await target.timeout(10 * 60_000, `Warnlimit erreicht (${active} Warnungen)`);
  }
  const autoCase = openCase(guild, cfg.moderation.warnAction, target, moderator, 'Aktion nach Warnlimit');
  await sendModLog(guild, cfg, autoCase, [{ name: 'Automatisch', value: 'Warnlimit' }]);
}
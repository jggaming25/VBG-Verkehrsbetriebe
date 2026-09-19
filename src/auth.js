import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { store } from './store.js';

export async function getMember(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch {
    return null;
  }
}

export function isAdmin(member, cfg) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roles = new Set([
    ...(cfg?.adminRoles || []),
    config.adminRoleId,
  ]);
  return [...roles].some((r) => member.roles.cache.has(r));
}

export function isStaff(member, cfg) {
  if (!member) return false;
  if (isAdmin(member, cfg)) return true;
  const roles = new Set([
    ...(cfg?.supportRoles || []),
    ...(cfg?.managerRoles || []),
  ]);
  return [...roles].some((r) => member.roles.cache.has(r));
}

export function isManager(member, cfg) {
  if (!member) return false;
  if (isAdmin(member, cfg)) return true;
  return (cfg?.managerRoles || []).some((r) => member.roles.cache.has(r));
}

export async function isDashboardAdmin(client, userId, guildId) {
  if (!guildId || !userId) return false;
  const member = await getMember(client, guildId, userId);
  if (!member) return false;
  const cfg = store.getConfig(guildId);
  return isAdmin(member, cfg);
}

export async function isDashboardAdminCached(client, userId, guildId, cache) {
  const key = `${guildId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  const ok = await isDashboardAdmin(client, userId, guildId);
  cache.set(key, { ok, at: Date.now() });
  return ok;
}
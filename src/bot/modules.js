import { Events, ActivityType, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { store } from '../store.js';

const verifyCodes = new Map(); // guildId:userId -> {code, at}
const statsTimerByGuild = new Map();

// ---------------------------------------------------------------- welcome / farewell

async function onMemberAdd(member, guild, client) {
  const cfg = store.ensureConfig(guild.id);
  if (cfg.protection?.enabled) {
    scheduleVerification(member, guild, cfg);
  }
  const w = cfg.welcome || {};
  if (w.enabled && w.channelId) {
    const ch = guild.channels.cache.get(w.channelId);
    if (ch && ch.viewable) {
      const text = fillTemplate(w.message, member);
      await ch.send({
        content: Array.isArray(text) ? text[0] : text,
        embeds: w.embedEnabled && w.embedTitle ? [new EmbedBuilder().setColor(0x23a55a).setTitle(fillTemplate(w.embedTitle, member)[0] || w.embedTitle).setDescription(w.embedDescription ? fillTemplate(w.embedDescription, member)[0] : '')] : undefined,
      }).catch(() => {});
    }
  }
  if (w.dmEnabled) {
    try {
      await member.send(fillTemplate(w.dmMessage, member));
    } catch { /* DMs geschlossen */ }
  }
  for (const rid of w.autoRoles || []) {
    try {
      if (!member.roles.cache.has(rid)) await member.roles.add(rid, 'Willkommensregel');
    } catch { /* ignore */ }
  }
}

async function onMemberRemove(member, guild) {
  const cfg = store.ensureConfig(guild.id);
  const fw = cfg.farewell || {};
  if (!fw.enabled || !fw.channelId) return;
  const ch = guild.channels.cache.get(fw.channelId);
  if (!ch || !ch.viewable) return;
  await ch.send(String(fw.message || '{user} hat den Server verlassen. 👋').replaceAll('{user}', `${member.user?.tag || member.id}`)).catch(() => {});
}

function fillTemplate(str, member) {
  if (typeof str !== 'string') return str;
  const tag = member.user?.tag || member.id;
  const name = member.displayName || member.user?.username || tag;
  return [str.replaceAll('{user}', `<@${member.id}>`).replaceAll('{tag}', tag).replaceAll('{name}', name).replaceAll('{server}', member.guild.name)];
}

// ---------------------------------------------------------------- verification

function code6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function scheduleVerification(member, guild, cfg) {
  const code = code6();
  verifyCodes.set(`${guild.id}:${member.id}`, { code, at: Date.now() });
  const ok = await sendVerifyDM(member, code);
  const ch = cfg.protection.verifyChannelId ? guild.channels.cache.get(cfg.protection.verifyChannelId) : null;
  if (!ok && ch && ch.viewable) {
    await ch.send({ content: `🔐 <@${member.id}> Die Captcha-DM konnte nicht zugestellt werden. Nutze **/verify code:\`${code}\`**.` }).catch(() => {});
  }
}

async function sendVerifyDM(member, code) {
  try {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`verify:${member.id}`).setLabel('Code eingeben').setStyle(ButtonStyle.Primary).setEmoji('🔐')
    );
    await member.send({ content: `🔐 **Verifizierung auf ${member.guild.name}**\nGib den Code **${code}** ein oder klicke auf den Button.`, components: [row] });
    return true;
  } catch {
    return false;
  }
}

export function verifyCode(guildId, userId, input) {
  const rec = verifyCodes.get(`${guildId}:${userId}`);
  if (!rec) return { ok: false };
  if (Date.now() - rec.at > 15 * 60_000) {
    verifyCodes.delete(`${guildId}:${userId}`);
    return { ok: false, expired: true };
  }
  if (rec.code !== String(input)) return { ok: false };
  verifyCodes.delete(`${guildId}:${userId}`);
  return { ok: true };
}

// ---------------------------------------------------------------- server stats

export async function refreshServerStats(guild) {
  const cfg = store.getConfig(guild.id);
  if (!cfg || !cfg.stats?.enabled) return;
  const memberCount = guild.memberCount || 0;
  const boosts = guild.premiumSubscriptionCount || 0;
  const online = guild.members.cache.filter((m) => m.presence?.status === 'online' || m.presence?.status === 'dnd').size;
  const vc = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice && c.members?.size).reduce((s, c) => s + c.members.size, 0);
  const values = { '👥': memberCount, '🟢': online, '⚡': boosts, '🎧': vc };
  const kinds = { '👥': 'Mitglieder', '🟢': 'Online', '⚡': 'Boosts', '🎧': 'Im Voice' };
  for (const sc of cfg.stats.channels || []) {
    const ch = guild.channels.cache.get(sc.id);
    if (!ch || ch.type !== ChannelType.GuildVoice) continue;
    const prefix = (cfg.stats.prefix || '📊').trim();
    const val = values[sc.kind] ?? 0;
    const label = kinds[sc.kind] || sc.kind;
    const name = `${prefix} ${label}: ${val}`.slice(0, 100);
    if (ch.name !== name) {
      try { await ch.setName(name, 'Auto-Stats'); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------- social (YouTube RSS + Twitch)

let socialTimer = null;
let lastRuns = {};

async function checkSocial(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = store.getConfig(guild.id);
    if (!cfg || !cfg.social) continue;
    const social = cfg.social;
    for (const yt of social.youtube || []) {
      const key = `yt:${yt.channelId}`;
      if (Date.now() - (lastRuns[key] || 0) < 10 * 60_000) continue;
      lastRuns[key] = Date.now();
      try {
        const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${yt.channelId}`);
        if (!rss.ok) continue;
        const xml = await rss.text();
        const matches = [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<published>([^<]+)<\/published>[\s\S]*?<\/entry>/g)].slice(0, 3);
        if (!matches.length) continue;
        const latest = matches[0];
        const vid = latest[1];
        if (vid === yt.lastVideoId) continue;
        const ch = yt.notifyChannelId ? guild.channels.cache.get(yt.notifyChannelId) : social.notifyChannelId ? guild.channels.cache.get(social.notifyChannelId) : null;
        if (ch && ch.viewable) {
          const pid = yt.roleId ? `<@&${yt.roleId}> ` : '';
          await ch.send({ content: `${pid}📹 **NEUES VIDEO** von **${yt.name || yt.channelId}**!\nhttps://youtu.be/${vid}\n*„${latest[2].replaceAll('&amp;', '&')}“*` }).catch(() => {});
        }
        yt.lastVideoId = vid;
        store.updateConfig(guild.id, { social });
      } catch { /* Netzwerkfehler ignorieren */ }
    }
    for (const tw of social.twitch || []) {
      const key = `tw:${tw.userId}`;
      if (Date.now() - (lastRuns[key] || 0) < 2 * 60_000) continue;
      lastRuns[key] = Date.now();
      try {
        const live = await fetchTwitchStream(tw);
        const cur = tw.lastLive ? tw.lastLive === live.id : false;
        if (live && !cur) {
          const ch = tw.notifyChannelId ? guild.channels.cache.get(tw.notifyChannelId) : social.notifyChannelId ? guild.channels.cache.get(social.notifyChannelId) : null;
          if (ch && ch.viewable) {
            const pid = tw.roleId ? `<@&${tw.roleId}> ` : '';
            await ch.send({ content: `${pid}🎥 **${tw.name}** ist JETZT live!\nhttps://twitch.tv/${tw.name}\n*${String(live.title || '').slice(0, 150)}*` }).catch(() => {});
          }
          tw.lastLive = live.id;
          store.updateConfig(guild.id, { social });
        } else if (!live && tw.lastLive) {
          tw.lastLive = null;
          store.updateConfig(guild.id, { social });
        }
      } catch { /* ignore */ }
    }
  }
}

let twitchToken = { access_token: null, expires: 0 };

async function twitchTokenSafe() {
  if (twitchToken.access_token && Date.now() < twitchToken.expires) return twitchToken.access_token;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${encodeURIComponent(process.env.TWITCH_CLIENT_ID || '')}&client_secret=${encodeURIComponent(process.env.TWITCH_CLIENT_SECRET || '')}&grant_type=client_credentials`,
  });
  const j = await r.json();
  twitchToken = { access_token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function fetchTwitchStream(tw) {
  const cid = process.env.TWITCH_CLIENT_ID || '';
  const sec = process.env.TWITCH_CLIENT_SECRET || '';
  if (!cid || !sec) return null;
  const token = await twitchTokenSafe();
  const r = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(tw.name)}`, { headers: { 'Client-Id': cid, Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return (j.data && j.data[0]) || null;
}

// ---------------------------------------------------------------- activity rewards

const msgCounts = new Map(); // guild:user -> count

async function onMessage(msg) {
  if (!msg.guild || msg.author.bot) return;
  const cfg = store.getConfig(msg.guild.id);
  if (!cfg || !cfg.activity?.enabled) return;
  if ((cfg.optOuts || []).includes(msg.author.id)) return;
  const key = `${msg.guild.id}:${msg.author.id}`;
  const count = (msgCounts.get(key) || 0) + 1;
  msgCounts.set(key, count);
  if (count % 25 !== 0) return;
  const member = msg.member;
  if (!member) return;
  for (const rw of cfg.activity.rewards || []) {
    if (count >= rw.messages && !member.roles.cache.has(rw.roleId)) {
      try {
        await member.roles.add(rw.roleId, `Aktivitätsbelohnung (${rw.messages} Nachrichten)`);
        if (rw.mention) await msg.channel.send({ content: `🏅 <@${member.id}> hat **${rw.messages} Nachrichten** erreicht und **<@&${rw.roleId}>** erhalten!`, allowedMentions: { roles: [], users: [] } }).catch(() => {});
      } catch { /* ignore */ }
    }
  }
}

function flushCounts() {
  if (!msgCounts.size) return;
  const snapshot = {};
  for (const [k, v] of msgCounts) snapshot[k] = v;
  msgCounts.clear();
  for (const [key, count] of Object.entries(snapshot)) {
    const [gid, uid] = key.split(':');
    const cfg = store.getConfig(gid);
    if (!cfg) continue;
    const stats = cfg.activityCounts || {};
    const total = (stats[uid] || 0) + count;
    stats[uid] = total;
    store.updateConfig(gid, { activityCounts: stats });
  }
}

// ---------------------------------------------------------------- Private Voice (temporäre Kanäle)

const privateChannels = new Map(); // channelId -> { ownerId, at }
const lobbyWaiters = new Map();    // userId -> { at }

function pvFormatRaw(mode, custom) {
  if (mode === 'custom') return String(custom || '%USERNAME%');
  if (mode === 'USER_GLOBAL_NAME') return '%USER_GLOBAL_NAME%';
  if (mode === 'JOIN_USER_GLOBAL_NAME') return '⏳ Join %USER_GLOBAL_NAME%';
  if (mode === 'JOIN_USERNAME') return '⏳ Join %USERNAME%';
  return '%USERNAME%';
}

function fillPvName(tpl, member) {
  let out = String(tpl);
  const realname = member.displayName || member.user?.globalName || member.user?.username || member.id;
  out = out.replaceAll('%USER_GLOBAL_NAME%', realname).replaceAll('%USERNAME%', member.user?.username || realname).replaceAll('%USER_ID%', member.id).replaceAll('@', '');
  return out.slice(0, 100).trim();
}

async function onVoiceStateUpdate(oldS, newS) {
  const member = newS.member || oldS.member;
  if (!member || member.user?.bot) return;
  const guild = newS.guild || oldS.guild;
  if (!guild) return;
  const cfg = store.getConfig(guild.id);
  if (!cfg) return;

  const pv = cfg.privatevoice;
  const joinedLobby = newS.channelId && newS.channelId === pv?.lobbyChannelId;
  const leftLobby = oldS.channelId && oldS.channelId === pv?.lobbyChannelId;
  const st = cfg.support;

  // ---- Wartemusik-lose Support-Benachrichtigung: Neuer User im Warteraum ----
  if (st?.enabled && newS.channelId) {
    const room = (st.rooms || []).find((r) => r.enabled && r.waitingChannelId === newS.channelId);
    if (room && oldS.channelId !== newS.channelId) {
      await notifyWaitRoom(guild, cfg, room, member, st).catch(() => {});
    }
  }
  if (joinedLobby) {
    await createPrivateChannel(guild, pv, member).catch((e) => console.error('[PV] Create:', e.message));
  }
  if (leftLobby) {
    // kurze Wartezeit gegen Doppel-Wechsel
  }
  // ---- Private Kanäle aufräumen: Kanal verlassen -> löschen, wenn leer ----
  if (oldS.channelId && privateChannels.has(oldS.channelId) && newS.channelId !== oldS.channelId) {
    const rec = privateChannels.get(oldS.channelId);
    const ch = guild.channels.cache.get(oldS.channelId);
    if (ch && (!ch.members || ch.members.size === 0) && rec) {
      privateChannels.delete(oldS.channelId);
      setTimeout(async () => {
        try {
          const fresh = guild.channels.cache.get(ch.id);
          if (fresh && fresh.members.size === 0) await fresh.delete('Privater Kanal wird gelöscht.');
        } catch { /* ignore */ }
      }, 8000);
    }
  }
}

async function createPrivateChannel(guild, pv, member) {
  if (!pv?.enabled || !pv?.lobbyChannelId) return;
  const lobby = guild.channels.cache.get(pv.lobbyChannelId);
  if (!lobby) return;
  // Wait-Sperre gegen Legen-Spam (max. 1 Kanal / 3 Sek. pro User)
  const last = lobbyWaiters.get(member.id);
  if (last && Date.now() - last.at < 3000) return;
  lobbyWaiters.set(member.id, { at: Date.now() });
  const cat = pv.categoryId ? guild.channels.cache.get(pv.categoryId) : null;
  const validCat = cat && cat.type === ChannelType.GuildCategory;
  const parentId = validCat ? cat.id : (lobby.parent ? lobby.parent.id : undefined);
  const nameTpl = pv.nameMode === 'custom' ? pv.customName : pvFormatRaw(pv.nameMode, pv.customName);
  const wNameTpl = pv.waitMode === 'custom' ? pv.customWaitName : pvFormatRaw(pv.waitMode, pv.customWaitName);
  const ch = await guild.channels.create({
    name: fillPvName(nameTpl, member),
    type: ChannelType.GuildVoice,
    parent: parentId,
    bitrate: Math.max(8, Math.min(384, Number(pv.bitrate) || 64)) * 1000,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
      { id: member.id, allow: ['ViewChannel', 'Connect', 'Speak', 'Stream', 'ManageChannels'] },
    ],
  });
  privateChannels.set(ch.id, { ownerId: member.id, at: Date.now() });
  await member.voice.setChannel(ch.id, 'Privater Voice-Kanal').catch(() => {});
}

async function notifyWaitRoom(guild, cfg, room, member, st) {
  const notify = guild.channels.cache.get(room.notifyChannelId);
  if (!notify || !notify.isTextBased()) return;
  const tplRoom = room.prefix ? `${room.prefix} ${member.displayName || member.user?.username}` : (member.displayName || member.user?.username);
  const ping = room.teamRoleId ? `<@&${room.teamRoleId}> ` : '';
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎧 Support-Anfrage')
    .setDescription(`**${member.user?.username}** wartet auf Unterstützung.\nWarteraum: <#${room.waitingChannelId}>${room.name ? ` · **${room.name}**` : ''}`)
    .addFields({ name: 'Kanal', value: tplRoom ? 'Support-Kanal wird automatisch erstellt.' : '–', inline: true })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sup:take:${room.id}:${member.id}`).setLabel('Fall übernehmen').setStyle(ButtonStyle.Success).setEmoji('🎧'),
    new ButtonBuilder().setCustomId(`sup:later:${member.id}`).setLabel('Später').setStyle(ButtonStyle.Secondary)
  );
  await notify.send({ content: `${ping}Neue Support-Anfrage!`, embeds: [e], components: [row] }).catch(() => {});
}

async function cleanupPrivateChannels(client) {
  for (const [chId, rec] of privateChannels) {
    const ch = client.channels.cache.get(chId);
    if (!ch) { privateChannels.delete(chId); continue; }
    if (!ch.members || ch.members.size === 0) {
      privateChannels.delete(chId);
      try { await ch.delete('Privater Kanal ist leer.'); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------- wiring

export function startModules(client) {
  client.on(Events.GuildMemberAdd, (member) => {
    const g = member.guild;
    onMemberAdd(member, g, client).catch((e) => console.error('[MOD] Welcome:', e.message));
  });
  client.on(Events.GuildMemberRemove, (member) => {
    const g = member.guild;
    onMemberRemove(member, g).catch(() => {});
  });
  client.on(Events.VoiceStateUpdate, (oldS, newS) => {
    onVoiceStateUpdate(oldS, newS).catch((e) => console.error('[MOD] Voice:', e.message));
  });
  client.on(Events.MessageCreate, (m) => onMessage(m).catch(() => {}));

  setInterval(() => refreshAllStats(client), 5 * 60_000);
  setInterval(() => cleanupPrivateChannels(client), 60_000);
  if (!socialTimer) {
    socialTimer = setInterval(() => checkSocial(client).catch(() => {}), 5 * 60_000);
    checkSocial(client).catch(() => {});
  }
  setInterval(() => flushCounts(), 5 * 60_000);
  setTimeout(() => refreshAllStats(client), 15_000);
}

async function refreshAllStats(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await refreshServerStats(guild);
    } catch { /* ignore */ }
  }
}

export function clearTempTracking() { privateChannels.clear(); }
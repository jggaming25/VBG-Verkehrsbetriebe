import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { store } from '../store.js';
import { client, stopBot, restartBot, isBotRunning } from '../bot/client.js';
import { isDashboardAdminCached } from '../auth.js';
import { uid } from '../util.js';
import { loginUrl, exchangeCode } from './oauth.js';
import { refreshServerStats } from '../bot/modules.js';
import { decideSuggestion } from '../bot/suggestions.js';
import {
  closeTicket,
  reopenTicket,
  deleteTicket,
  createTicket,
  buildPanelEmbed,
  panelRow,
  normalizePanel,
} from '../bot/core.js';
import { readTranscript } from '../transcript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const adminCache = new Map();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    name: 'vbg.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 864e5,
      sameSite: 'lax',
      secure: config.isProd && /^https:/i.test(config.webUrl),
    },
  })
);
app.use(express.static(publicDir));

// ---------------- middleware ----------------

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'login' });
  next();
}

async function requireGuild(req, res, next) {
  const { gid } = req.params;
  const ok = await isDashboardAdminCached(client, req.session.user.id, gid, adminCache);
  if (!ok) return res.status(403).json({ error: 'forbidden' });
  next();
}

// ---------------- pages ----------------

app.get('/ping', (req, res) => res.json({ ok: true, uptime: process.uptime(), time: Date.now() }));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(publicDir, 'landing.html'));
});

app.get('/auth/login', (req, res) => {
  const state = uid();
  req.session.oauthState = state;
  res.redirect(loginUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Ungültiger OAuth-State.');
  }
  try {
    const data = await exchangeCode(code);
    req.session.user = {
      id: data.user.id,
      username: data.user.username,
      tag: `${data.user.username}#${data.user.discriminator || '0'}`,
      global_name: data.user.global_name || data.user.username,
      avatar: data.user.avatar,
      guilds: data.guilds,
    };
    req.session.oauthState = null;
    res.redirect('/dashboard');
  } catch (e) {
    res.status(500).send(`OAuth fehlgeschlagen: ${e.message}`);
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/transcript/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.sendFile(path.join(publicDir, 'transcript.html'));
});

// ---------------- api ----------------

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

app.get('/api/state', requireAuth, async (req, res) => {
  const out = [];
  for (const g of req.session.user.guilds || []) {
    if (!client.guilds.cache.has(g.id)) continue;
    const ok = await isDashboardAdminCached(client, req.session.user.id, g.id, adminCache);
    if (!ok) continue;
    const cfg = store.ensureConfig(g.id);
    const tickets = store.getTickets(g.id);
    const week = tickets.filter((t) => Date.now() - t.createdAt < 7 * 864e5).length;
    const responded = tickets.filter((t) => t.firstResponseAt && t.createdAt);
    const avgResp = responded.length
      ? Math.round(responded.reduce((s, t) => s + (t.firstResponseAt - t.createdAt), 0) / responded.length / 1000)
      : 0;
    const fb = tickets.filter((t) => t.feedback);
    const avgStars = fb.length ? fb.reduce((s, t) => s + t.feedback.stars, 0) / fb.length : 0;
    out.push({
      guild: { id: g.id, name: g.name, icon: g.icon },
      stats: {
        total: tickets.length,
        open: tickets.filter((t) => t.status === 'open').length,
        claimed: tickets.filter((t) => t.status === 'claimed').length,
        closed: tickets.filter((t) => t.status === 'closed').length,
        deleted: tickets.filter((t) => t.status === 'deleted').length,
        week,
        avgResponse: avgResp,
        avgStars: Math.round(avgStars * 10) / 10,
      },
      panels: store.getPanels(g.id).map((p) => ({
        id: p.id,
        name: p.name || p.title,
        color: p.color,
        channelId: p.channelId,
        categories: p.categories,
      })),
      config: cfg,
      actions: store.getActions(g.id, 50),
      recentTickets: tickets.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    });
  }
  res.json({ user: req.session.user, guilds: out });
});

app.get('/api/g/:gid/tickets', requireAuth, requireGuild, (req, res) => {
  let list = store.getTickets(req.params.gid);
  const status = String(req.query.status || 'all');
  if (status !== 'all') list = list.filter((t) => t.status === status);
  res.json({ tickets: list.sort((a, b) => b.createdAt - a.createdAt) });
});

app.get('/api/g/:gid/tickets/:tid', requireAuth, requireGuild, (req, res) => {
  const ticket = store.getTicket(req.params.gid, req.params.tid.toUpperCase());
  if (!ticket) return res.status(404).json({ error: 'not_found' });
  res.json({ ticket, transcript: readTranscript(ticket) });
});

app.get('/api/g/:gid/actions', requireAuth, requireGuild, (req, res) => {
  res.json({ actions: store.getActions(req.params.gid, 200) });
});

app.get('/api/transcript/:id', requireAuth, async (req, res) => {
  const id = req.params.id.toUpperCase();
  for (const g of req.session.user.guilds || []) {
    const ticket = store.getTicket(g.id, id);
    if (!ticket) continue;
    const ok = await isDashboardAdminCached(client, req.session.user.id, g.id, adminCache);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    return res.json({ guildId: g.id, ticket, transcript: readTranscript(ticket) });
  }
  res.status(404).json({ error: 'not_found' });
});

app.post('/api/g/:gid/tickets/:tid/action', requireAuth, requireGuild, async (req, res) => {
  const { action, reason } = req.body || {};
  const gid = req.params.gid;
  const guild = client.guilds.cache.get(gid);
  const ticket = store.getTicket(gid, req.params.tid);
  if (!ticket) return res.status(404).json({ error: 'not_found' });
  const actor = { id: req.session.user.id, user: { tag: req.session.user.tag } };
  try {
    if (action === 'close') {
      const r = await closeTicket({ guild, ticket, actor, reason });
      return res.json({ ok: true, ticket: r.ticket });
    }
    if (action === 'reopen') {
      const r = await reopenTicket({ guild, ticket, actor, reason });
      return res.json({ ok: true, ticket: r.ticket });
    }
    if (action === 'delete') {
      const r = await deleteTicket({ guild, ticket, actor });
      return res.json({ ok: true, ticket: r.ticket });
    }
    res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/g/:gid/settings', requireAuth, requireGuild, (req, res) => {
  const cfg = store.ensureConfig(req.params.gid);
  const body = req.body || {};
  const upd = { embed: cfg.embed || {} };
  for (const k of ['language', 'supportRoles', 'managerRoles', 'adminRoles', 'accessRoles', 'pingRoleId', 'openRoleId', 'closedRoleId', 'logChannelId', 'transcriptChannelId', 'defaultCategoryId', 'closedCategoryId', 'maxTicketsPerUser', 'autoCloseMinutes', 'autoDeleteHours', 'feedbackEnabled', 'autoTranscripts', 'messageLimit']) {
    if (body[k] !== undefined) upd[k] = body[k];
  }
  if (body.embed && typeof body.embed === 'object') upd.embed = { ...upd.embed, ...body.embed };
  store.updateConfig(req.params.gid, upd);
  res.json({ ok: true, config: store.ensureConfig(req.params.gid) });
});

// ---------------- Modul-Konfiguration (generisch) ----------------

app.get('/api/g/:gid/module/:name', requireAuth, requireGuild, (req, res) => {
  const cfg = store.ensureConfig(req.params.gid);
  const name = String(req.params.name).replace(/[^a-z]/gi, '');
  const supported = ['moderation', 'news', 'suggestions', 'welcome', 'farewell', 'stats', 'support', 'protection', 'activity', 'social'];
  if (!supported.includes(name)) return res.status(400).json({ error: 'unknown_module' });
  const extra = {};
  if (name === 'activity') extra.counts = cfg.activityCounts || {};
  if (name === 'moderation') extra.cases = store.getCases(req.params.gid);
  if (name === 'suggestions') extra.suggestions = store.getSuggestions(req.params.gid);
  if (name === 'stats') extra.channels = (cfg.stats?.channels || []).filter((c) => client && client.guilds.cache.get(req.params.gid)?.channels.cache.has(c.id));
  res.json({ module: name, config: cfg[name] || {}, meta: moduleMeta(req.params.gid, name), ...extra });
});

app.post('/api/g/:gid/module/:name', requireAuth, requireGuild, (req, res) => {
  const cfg = store.ensureConfig(req.params.gid);
  const name = String(req.params.name).replace(/[^a-z]/gi, '');
  const supported = ['moderation', 'news', 'suggestions', 'welcome', 'farewell', 'stats', 'support', 'protection', 'activity'];
  if (!supported.includes(name)) return res.status(400).json({ error: 'unknown_module' });
  if (name === 'social') return res.status(400).json({ error: 'social_immutable_via_generic' });
  const prev = cfg[name] || {};
  store.updateConfig(req.params.gid, { [name]: mergeModule(prev, req.body || {}) });
  res.json({ ok: true, config: store.ensureConfig(req.params.gid)[name] });
});

function mergeModule(prev, body) {
  const out = { ...prev };
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === '' || v === undefined) {
      if (Array.isArray(out[k])) out[k] = [];
      else delete out[k];
      continue;
    }
    if (Array.isArray(out[k]) && !Array.isArray(v)) {
      out[k] = Array.isArray(v) ? v : [v];
    } else {
      out[k] = v;
    }
  }
  return out;
}

function moduleMeta(gid, name) {
  const guild = client ? client.guilds.cache.get(gid) : null;
  const chan = (f) => {
    if (!guild || !f) return [];
    return guild.channels.cache
      .filter(f)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  };
  const roles = () => {
    if (!guild) return [];
    return guild.roles.cache.filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name }));
  };
  switch (name) {
    case 'news':
      return { channels: chan((c) => c.isTextBased()), roles: roles() };
    case 'suggestions':
      return { channels: chan((c) => c.isTextBased()), roles: roles() };
    case 'welcome':
    case 'farewell':
      return { channels: chan((c) => c.isTextBased()), roles: roles() };
    case 'stats':
      return { channels: chan((c) => c.type === 2) };
    case 'support':
      return { channels: chan(() => true), roles: roles() };
    case 'protection':
      return { channels: chan(() => true), roles: roles() };
    case 'activity':
      return { channels: chan(() => true), roles: roles() };
    default:
      return { channels: [], roles: roles() };
  }
}

// ---------------- Modul-Aktionen ----------------

app.post('/api/g/:gid/news/post', requireAuth, requireGuild, async (req, res) => {
  const guild = client ? client.guilds.cache.get(req.params.gid) : null;
  const cfg = store.ensureConfig(req.params.gid);
  const { title, message, image, thumbnail, pingRole } = req.body || {};
  const chId = cfg.news.channelId;
  if (!chId) return res.status(400).json({ error: 'Kein News-Kanal konfiguriert.' });
  const ch = guild && guild.channels.cache.get(chId);
  if (!ch || !ch.viewable) return res.status(400).json({ error: 'News-Kanal nicht verfügbar.' });
  const { EmbedBuilder } = await import('discord.js');
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title || '📰 News')
    .setDescription(message || '')
    .setTimestamp();
  if (image) e.setImage(image);
  if (thumbnail) e.setThumbnail(thumbnail);
  await ch.send({ content: pingRole ? `<@&${pingRole}>` : undefined, embeds: [e] });
  res.json({ ok: true });
});

app.post('/api/g/:gid/stats/setup', requireAuth, requireGuild, async (req, res) => {
  const guild = client ? client.guilds.cache.get(req.params.gid) : null;
  if (!guild) return res.status(400).json({ error: 'Bot offline.' });
  const cfg = store.ensureConfig(req.params.gid);
  const { kinds = ['👥', '🟢', '⚡', '🎧'], prefix = '📊' } = req.body || {};
  const created = [];
  for (const kind of kinds) {
    if (cfg.stats.channels.some((c) => c.kind === kind && guild.channels.cache.has(c.id))) continue;
    try {
      const ch = await guild.channels.create({
        name: `${prefix} ${kind} …`,
        type: 2,
        reason: 'Server-Stats',
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: ['Connect'] }, { id: guild.roles.everyone.id, allow: ['ViewChannel'] }],
      });
      cfg.stats.channels.push({ id: ch.id, kind });
      created.push(ch.id);
    } catch (e) {
      console.error('[STATS] Setup:', e.message);
    }
  }
  store.updateConfig(req.params.gid, { stats: { ...cfg.stats, enabled: true, prefix } });
  await refreshServerStats(guild).catch(() => {});
  res.json({ ok: true, created, channels: store.ensureConfig(req.params.gid).stats.channels });
});

app.post('/api/g/:gid/suggestions/:sid/decide', requireAuth, requireGuild, async (req, res) => {
  const guild = client ? client.guilds.cache.get(req.params.gid) : null;
  const { decision, reason } = req.body || {};
  const s = store.getSuggestion(req.params.gid, req.params.sid.toUpperCase());
  if (!s) return res.status(404).json({ error: 'not_found' });
  const actor = { id: req.session.user.id, user: { tag: req.session.user.tag } };
  const r = await decideSuggestion({ guild, suggestion: s, decision, moderator: actor, reason });
  res.json({ ok: r.ok, suggestion: s });
});

// ---------------- System-Controlling (Stopp / Start / Neustart) ----------------

app.get('/api/system', requireAuth, (req, res) => {
  const sys = store.getSystem();
  res.json({ running: isBotRunning(), ownerId: sys.ownerId || null, isOwner: req.session.user.id === sys.ownerId });
});

app.post('/api/system/control', requireAuth, async (req, res) => {
  const sys = store.getSystem();
  const claimed = store.claimOwner(req.session.user.id);
  if (req.session.user.id !== claimed) return res.status(403).json({ error: 'forbidden' });
  const action = String((req.body || {}).action || '');
  try {
    if (action === 'stop') {
      if (!isBotRunning()) return res.json({ ok: true, running: false, message: 'Bot läuft bereits nicht.' });
      await stopBot();
      return res.json({ ok: true, running: false, message: 'Bot gestoppt.' });
    }
    if (action === 'start') {
      if (isBotRunning()) return res.json({ ok: true, running: true, message: 'Bot läuft bereits.' });
      await import('../bot/control.js').then(async ({ clearFlag }) => {
        clearFlag();
      });
      await startBotSafe();
      return res.json({ ok: true, running: true, message: 'Bot gestartet.' });
    }
    if (action === 'restart') {
      const clientNow = (await import('../bot/client.js')).client;
      await restartBot();
      return res.json({ ok: true, running: isBotRunning(), message: 'Neustart angestoßen.' });
    }
    res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function startBotSafe() {
  const { startBot } = await import('../bot/client.js');
  try {
    await startBot();
  } catch (e) {
    console.error('[WEB] Bot-Start fehlgeschlagen:', e.message);
  }
}

function panelMeta(guild) {
  const cats = guild.channels.cache.filter((c) => c.type === 4).map((c) => ({ id: c.id, name: c.name }));
  const text = guild.channels.cache.filter((c) => c.isTextBased && c.isTextBased()).map((c) => ({ id: c.id, name: c.name }));
  const roles = guild.roles.cache.filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name }));
  return { categories: cats, textChannels: text, roles };
}

app.get('/api/g/:gid/panel-meta', requireAuth, requireGuild, (req, res) => {
  const guild = client ? client.guilds.cache.get(req.params.gid) : null;
  if (!guild) return res.status(400).json({ error: 'Bot offline.' });
  res.json({ meta: panelMeta(guild) });
});

function sanitizePanelBody(body, guild) {
  const b = body || {};
  const categories = (b.categories || []).map((c) => ({
    id: c.id || `cat_${uid()}`,
    name: String(c.name || 'Support').slice(0, 60),
    prefix: String(c.prefix || 'ticket').toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 20) || 'ticket',
    emoji: c.emoji || '🎫',
    description: c.description || '',
    categoryId: c.categoryId || null,
    active: c.active !== false,
    capacity: Math.max(0, Number(c.capacity) || 0),
    roles: Array.isArray(c.roles) ? c.roles.filter(Boolean) : [],
    allowOnBehalf: !!c.allowOnBehalf,
    embedOverride: !!c.embedOverride,
    openingEmbed: {
      title: (c.openingEmbed && c.openingEmbed.title) || null,
      description: (c.openingEmbed && c.openingEmbed.description) || null,
      image: (c.openingEmbed && c.openingEmbed.image) || null,
    },
  }));
  let channelId = String(b.channelId || '').trim();
  if (channelId && !guild.channels.cache.has(channelId)) channelId = '';
  return {
    id: b.id || null,
    channelId,
    name: String(b.name || 'Ticket Panel').slice(0, 60),
    description: b.description || '',
    color: /^#?[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color).replace('#', '') : '5865F2',
    footer: b.footer || null,
    thumbnail: b.thumbnail || null,
    ticketNameFormat: ['PREFIX-USERNAME', 'PREFIX-USER_ID', 'PREFIX-USER_NICK_NAME', 'custom'].includes(b.ticketNameFormat) ? b.ticketNameFormat : 'PREFIX-USERNAME',
    customTicketNameFormat: b.customTicketNameFormat || '%PREFIX%-%USERNAME%',
    mentionTeam: !!b.mentionTeam,
    maxTicketsPerUser: Math.max(0, Number(b.maxTicketsPerUser) || 0),
    closeRestricted: !!b.closeRestricted,
    onLeaveAction: ['none', 'close', 'info'].includes(b.onLeaveAction) ? b.onLeaveAction : 'none',
    allowAddUsers: !!b.allowAddUsers,
    panelEmbed: {
      title: (b.panelEmbed && b.panelEmbed.title) || b.name || 'Ticket Panel',
      description: (b.panelEmbed && b.panelEmbed.description) || b.description || '',
      image: (b.panelEmbed && b.panelEmbed.image) || null,
    },
    openingEmbed: {
      title: (b.openingEmbed && b.openingEmbed.title) || null,
      description: (b.openingEmbed && b.openingEmbed.description) || null,
      image: (b.openingEmbed && b.openingEmbed.image) || null,
    },
    rating: {
      enabled: !!(b.rating && b.rating.enabled),
      channelId: (b.rating && b.rating.channelId) || null,
      publicChannelId: (b.rating && b.rating.publicChannelId) || null,
    },
    automation: {
      autoCloseDays: Math.max(0, Number((b.automation && b.automation.autoCloseDays)) || 0),
      autoAlertMinutes: Math.max(0, Number((b.automation && b.automation.autoAlertMinutes)) || 0),
      autoTeamAlertMinutes: Math.max(0, Number((b.automation && b.automation.autoTeamAlertMinutes)) || 0),
      autoUnclaimMinutes: Math.max(0, Number((b.automation && b.automation.autoUnclaimMinutes)) || 0),
      closeIfNoResponse: !!(b.automation && b.automation.closeIfNoResponse),
      autoClaim: !!(b.automation && b.automation.autoClaim),
      closeAfterCloseRequest: !!(b.automation && b.automation.closeAfterCloseRequest),
    },
    logs: {
      enabled: !!(b.logs && b.logs.enabled),
      channelId: (b.logs && b.logs.channelId) || null,
      transcripts: (b.logs && b.logs.transcripts !== undefined) ? !!b.logs.transcripts : true,
    },
    claimCategory: {
      enabled: !!(b.claimCategory && b.claimCategory.enabled),
      categoryId: (b.claimCategory && b.claimCategory.categoryId) || null,
    },
  };
}

app.post('/api/g/:gid/panels/create', requireAuth, requireGuild, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.gid);
  if (!guild) return res.status(400).json({ error: 'Bot offline.' });
  const body = sanitizePanelBody(req.body, guild);
  delete body.id;
  const panel = {
    id: uid(),
    guildId: guild.id,
    ...body,
    createdAt: Date.now(),
  };
  panel.channelId = body.channelId;
  store.addPanel(guild.id, panel);
  res.json({ ok: true, panel: normalizePanel(panel) });
});

app.get('/api/g/:gid/panels/:pid', requireAuth, requireGuild, (req, res) => {
  const panel = store.getPanel(req.params.gid, req.params.pid);
  if (!panel) return res.status(404).json({ error: 'not_found' });
  res.json({ panel: normalizePanel(panel) });
});

app.post('/api/g/:gid/panels/:pid/update', requireAuth, requireGuild, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.gid);
  if (!guild) return res.status(400).json({ error: 'Bot offline.' });
  const existing = store.getPanel(req.params.gid, req.params.pid);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const patch = sanitizePanelBody(req.body, guild);
  const panel = store.updatePanel(guild.id, req.params.pid, patch);
  res.json({ ok: true, panel: normalizePanel(panel) });
});

app.post('/api/g/:gid/panels/:pid/send', requireAuth, requireGuild, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.gid);
  if (!guild) return res.status(400).json({ error: 'Bot offline.' });
  const panel = store.getPanel(guild.id, req.params.pid);
  if (!panel) return res.status(404).json({ error: 'not_found' });
  const p = normalizePanel(panel);
  if (!p.channelId) return res.status(400).json({ error: 'Kein Kanal ausgewählt.' });
  const target = guild.channels.cache.get(p.channelId);
  if (!target || !target.viewable) return res.status(400).json({ error: 'Kanal nicht verfügbar.' });
  await target.send({ embeds: [buildPanelEmbed(p, guild.name)], components: panelRow(p) });
  res.json({ ok: true, channelId: target.id });
});

app.post('/api/g/:gid/panels/delete', requireAuth, requireGuild, (req, res) => {
  store.removePanel(req.params.gid, (req.body || {}).panelId);
  res.json({ ok: true });
});

app.post('/api/g/:gid/panel/test', requireAuth, requireGuild, async (req, resp) => {
  const guild = client.guilds.cache.get(req.params.gid);
  const { panelId } = req.body || {};
  const panel = store.getPanel(guild.id, panelId);
  if (!panel) return resp.status(404).json({ error: 'not_found' });
  const r = await createTicket({ guild, creator: guild.members.cache.get(req.session.user.id), panel, topic: 'Dashboard-Test', cat: null });
  resp.json({ ok: r.ok, error: r.error || null, channelId: r.channel?.id || null });
});

export function startWeb() {
  app.listen(config.port, () => {
    console.log(`[WEB] Dashboard läuft auf Port ${config.port}`);
  });
  if (config.webUrl) {
    setInterval(async () => {
      try {
        await fetch(`${config.webUrl}/ping`);
      } catch {
        /* offline */
      }
    }, 4 * 60 * 1000);
    console.log(`[WEB] Self-Ping aktiv: ${config.webUrl}`);
  } else {
    console.warn('[WEB] Keine WEB_URL gesetzt, Self-Ping deaktiviert. Setze WEB_URL in .env bzw. Render für den Ping-Service.');
  }
}
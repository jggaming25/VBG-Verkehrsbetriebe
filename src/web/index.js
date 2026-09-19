import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { store } from '../store.js';
import { client } from '../bot/client.js';
import { isDashboardAdminCached } from '../auth.js';
import { uid } from '../util.js';
import { loginUrl, exchangeCode } from './oauth.js';
import {
  closeTicket,
  reopenTicket,
  deleteTicket,
  createTicket,
  buildPanelEmbed,
  panelRow,
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
        title: p.title,
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

app.post('/api/g/:gid/panels/create', requireAuth, requireGuild, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.gid);
  const { channelId, title, description, color, categories } = req.body || {};
  const target = guild.channels.cache.get(channelId);
  if (!target) return res.status(400).json({ error: 'Kanal nicht gefunden.' });
  const cats = (categories || []).map((c) => ({ label: c.label, channelId: c.channelId, emoji: c.emoji || '🎫' }));
  const panel = {
    id: uid(),
    guildId: guild.id,
    channelId: target.id,
    title: title || '🎫 Ticket erstellen',
    description: description || 'Klicke unten, um ein Ticket zu erstellen.',
    color: color || '#5865F2',
    footer: null,
    thumbnail: null,
    categories: cats,
    createdAt: Date.now(),
  };
  store.addPanel(guild.id, panel);
  await target.send({ embeds: [buildPanelEmbed(panel, guild.name)], components: panelRow(panel) });
  res.json({ ok: true, panel });
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
  const r = await createTicket({ guild, creator: guild.members.cache.get(req.session.user.id), panel, topic: 'Dashboard-Test', categoryChannel: null });
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
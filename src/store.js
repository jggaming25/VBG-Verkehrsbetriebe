import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = () => path.join(config.dataDir, 'db.json');

export function defaultConfig(guildId) {
  return {
    guildId,
    language: 'de',
    adminRoles: [],          // zusätzliche Admin-Rollen für Dashboard + Rest
    managerRoles: [],        // Rollen: Vollzugriff (close/delete/claim)
    supportRoles: [],        // Rollen: Ticket-Staff
    accessRoles: [],         // Rollen: sehen alle Tickets
    pingRoleId: null,        // Rolle, die bei neuen Tickets gepingt wird
    openRoleId: null,        // Rolle: Zugriff auf offene Tickets
    closedRoleId: null,      // Rolle: Zugriff auf geschlossene Tickets
    logChannelId: null,      // Log-Kanal
    transcriptChannelId: null, // Kanal für Transkript-Dateien
    defaultCategoryId: null, // Kategorie für neue Tickets
    closedCategoryId: null,  // Kategorie für geschlossene Tickets
    feedbackCategoryId: null,
    maxTicketsPerUser: 3,    // 0 = unbegrenzt
    autoCloseMinutes: 0,     // 0 = aus (Inaktivität)
    autoDeleteHours: 168,    // 0 = aus (offene Tickets nach X h schließen? -> gelöschte Tickets)
    feedbackEnabled: true,
    autoTranscripts: true,
    messageLimit: 150,
    embed: {
      color: '#5865F2',
      author: '',
      footer: '',
      image: '',
      thumbnail: '',
      title: '🎫 Neues Ticket',
      description: 'Unser Team hilft dir gerne weiter!',
    },
    moderation: {
      modlogChannelId: null,
      modRoles: [],
      ignoreRoles: [],
      dmOnAction: true,
      warnLimit: 0,          // 0 = aus
      warnAction: 'mute',    // mute | kick | ban
      autoDeleteMessages: false,
    },
    news: { channelId: null, roleId: null, enabled: false },
    suggestions: {
      channelId: null,
      teamRoles: [],
      requireApproval: false,
      dmOnDecide: true,
      reviewChannelId: null,
      deleteAfterDecide: false,
      categories: [{ name: 'Allgemein', emoji: '💡', description: 'Allgemeine Vorschläge', active: true }],
    },
    welcome: {
      enabled: false,
      channelId: null,
      message: 'Willkommen auf dem Server, {user}! Viel Spaß 🎉',
      embedEnabled: false,
      embedTitle: '',
      embedDescription: '',
      autoRoles: [],
      dmEnabled: false,
      dmMessage: 'Willkommen {user}! Schön, dass du da bist.',
    },
    farewell: {
      enabled: false,
      channelId: null,
      message: '{user} hat den Server verlassen. 👋',
    },
    stats: { enabled: false, prefix: '📊', channels: [] }, // channels = [{id,name,kind}]
    privatevoice: {
      enabled: false,
      lobbyChannelId: null,      // 'Erstellen'-Kanal: Wer dort hineingeht, bekommt seinen eigenen Kanal
      categoryId: null,          // Kategorie, in der die privaten Kanäle entstehen
      nameMode: 'USERNAME',      // USERNAME | USER_GLOBAL_NAME | custom
      customName: '🔊 | %USERNAME%',
      waitMode: 'JOIN_USERNAME', // JOIN_USERNAME | JOIN_USER_GLOBAL_NAME | custom
      customWaitName: '⏳ | Join %USERNAME%',
      bitrate: 64,               // in kbps
    },
    support: {
      enabled: false,
      rooms: [],                 // Warteräume: [{id,name,waitingChannelId,notifyChannelId,teamRoleId,enabled,prefix,times:[]}]
    },
    protection: {
      enabled: false,
      verifiedRoleId: null,
      verifyChannelId: null,
      kickOnFail: false,
    },
    activity: {
      enabled: false,
      rewards: [],              // [{messages, roleId}]
      resetDaily: false,
    },
    social: {
      youtube: [],              // [{channelId, name, lastVideoId, notifyChannelId, roleId}]
      twitch: [],
      notifyChannelId: null,
      lastCheck: 0,
    },
    levels: {
      enabled: false,
      textXp: 1,                // XP pro Nachricht (1 Nachricht = Level-Basis)
      voiceXp: 50,              // XP pro Stunde im Sprachkanal (gerechnet pro Minute, gespeichert als Wert pro 60 Min)
      cooldownSeconds: 30,      // Cooldown zwischen Nachrichten-XP pro User
      announceChannelId: null,  // Kanal für Level-Up-Nachrichten (null = keine)
      rewards: [],              // [{level, roleId}] – Rolle, die beim Erreichen des Levels vergeben wird
      ratingEnabled: false,
      ratingChannelId: null,
    },
  };
}

export class Store {
  constructor() {
    this.db = {
      configs: {},
      panels: {},
      tickets: [],
      actions: [],
      cases: [],
      suggestions: [],
      system: { ownerId: null },
      meta: { ticketSeq: {}, caseSeq: {}, suggestionSeq: {} },
      levels: {},             // guildId -> userId -> { xp, lastMessageAt }
    };
  }

  init() {
    const dir = config.dataDir;
    try {
      fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
    } catch (e) {
      console.warn(`[STORE] Datenverzeichnis "${dir}" nicht beschreibbar – verwende "data/"`, e.message);
      config.dataDir = 'data';
      fs.mkdirSync(path.join('data', 'transcripts'), { recursive: true });
    }
    if (fs.existsSync(file())) {
      try {
        const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
        this.db = { ...this.db, ...raw };
      } catch (e) {
        console.error('[STORE] Datenbank konnte nicht gelesen werden:', e.message);
      }
    }
  }

  save() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(this.db, null, 2));
  }

  // ---------- config ----------
  getConfig(guildId) {
    return this.db.configs[guildId];
  }
  ensureConfig(guildId) {
    if (!this.db.configs[guildId]) this.db.configs[guildId] = defaultConfig(guildId);
    return this.db.configs[guildId];
  }
  updateConfig(guildId, patch) {
    const cfg = this.ensureConfig(guildId);
    Object.assign(cfg, patch);
    this.save();
    return cfg;
  }

  // ---------- panels ----------
  getPanels(guildId) {
    return this.db.panels[guildId] || [];
  }
  addPanel(guildId, panel) {
    (this.db.panels[guildId] ??= []).push(panel);
    this.save();
  }
  removePanel(guildId, panelId) {
    const arr = this.db.panels[guildId];
    if (!arr) return;
    const i = arr.findIndex((p) => p.id === panelId);
    if (i >= 0) {
      arr.splice(i, 1);
      this.save();
    }
  }
  getPanel(guildId, panelId) {
    return this.getPanels(guildId).find((p) => p.id === panelId);
  }
  updatePanel(guildId, panelId, patch) {
    const panel = this.getPanel(guildId, panelId);
    if (panel) {
      Object.assign(panel, patch);
      this.save();
    }
    return panel;
  }

  // ---------- tickets ----------
  nextSeq(guildId) {
    const n = (this.db.meta.ticketSeq[guildId] || 0) + 1;
    this.db.meta.ticketSeq[guildId] = n;
    return n;
  }
  getTickets(guildId) {
    return this.db.tickets.filter((t) => t.guildId === guildId);
  }
  getTicket(guildId, idOrChannel) {
    return this.db.tickets.find(
      (t) => t.guildId === guildId && (t.id === idOrChannel || t.channelId === idOrChannel)
    );
  }
  addTicket(t) {
    this.db.tickets.push(t);
    this.save();
    return t;
  }
  updateTicket(id, patch) {
    const t = this.db.tickets.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch);
      this.save();
    }
    return t;
  }
  openCount(guildId) {
    return this.getTickets(guildId).filter((t) => t.status === 'open').length;
  }
  allTickets(guildId) {
    return this.getTickets(guildId);
  }

  // ---------- actions ----------
  addAction(a) {
    this.db.actions.push(a);
    if (this.db.actions.length > 3000) this.db.actions = this.db.actions.slice(-3000);
    this.save();
  }
  getActions(guildId, limit = 100) {
    return this.db.actions.filter((a) => a.guildId === guildId).slice(-limit).reverse();
  }

  // ---------- moderation cases ----------
  nextCaseSeq(guildId) {
    const n = (this.db.meta.caseSeq[guildId] || 0) + 1;
    this.db.meta.caseSeq[guildId] = n;
    return n;
  }
  getCases(guildId, userId = null) {
    let list = this.db.cases.filter((c) => c.guildId === guildId);
    if (userId) list = list.filter((c) => c.userId === userId);
    return list.sort((a, b) => b.at - a.at);
  }
  getCase(guildId, id) {
    return this.db.cases.find((c) => c.guildId === guildId && c.id === id);
  }
  addCase(c) {
    this.db.cases.push(c);
    if (this.db.cases.length > 5000) this.db.cases = this.db.cases.slice(-5000);
    this.save();
    return c;
  }
  updateCase(guildId, id, patch) {
    const c = this.getCase(guildId, id);
    if (c) {
      Object.assign(c, patch);
      this.save();
    }
    return c;
  }

  // ---------- suggestions ----------
  nextSuggestionSeq(guildId) {
    const n = (this.db.meta.suggestionSeq[guildId] || 0) + 1;
    this.db.meta.suggestionSeq[guildId] = n;
    return n;
  }
  getSuggestions(guildId, status = null) {
    let list = this.db.suggestions.filter((s) => s.guildId === guildId);
    if (status) list = list.filter((s) => s.status === status);
    return list.sort((a, b) => b.at - a.at);
  }
  getSuggestion(guildId, id) {
    return this.db.suggestions.find((s) => s.guildId === guildId && s.id === id);
  }
  addSuggestion(s) {
    this.db.suggestions.push(s);
    this.save();
    return s;
  }
  updateSuggestion(guildId, id, patch) {
    const s = this.getSuggestion(guildId, id);
    if (s) {
      Object.assign(s, patch);
      this.save();
    }
    return s;
  }

  // ---------- levels (XP / Voice & Text Level-System) ----------
  getLevelData(guildId, userId) {
    const all = this.db.levels[guildId] || (this.db.levels[guildId] = {});
    return all[userId] || (all[userId] = { xp: 0, lastMessageAt: 0, voiceSeconds: 0 });
  }
  addLevelXp(guildId, userId, amount, patch = {}) {
    const rec = this.getLevelData(guildId, userId);
    const before = rec.xp;
    rec.xp = Math.max(0, (rec.xp || 0) + Math.round(amount));
    Object.assign(rec, patch);
    this.save();
    return { rec, levelBefore: levelOf(before), levelAfter: levelOf(rec.xp) };
  }
  setLevelXp(guildId, userId, xp) {
    return this.addLevelXp(guildId, userId, xp - (this.getLevelData(guildId, userId).xp || 0));
  }
  allLevelData(guildId) {
    return this.db.levels[guildId] || {};
  }
  resetLevel(guildId, userId) {
    delete this.db.levels[guildId]?.[userId];
    this.save();
  }
  resetLevels(guildId) {
    this.db.levels[guildId] = {};
    this.save();
  }
  rankOf(guildId, userId) {
    const sorted = Object.entries(this.allLevelData(guildId)).sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0));
    const idx = sorted.findIndex(([uid]) => uid === userId);
    return idx < 0 ? null : idx + 1;
  }
  leaderboard(guildId, limit = 10) {
    return Object.entries(this.allLevelData(guildId))
      .filter(([, v]) => (v.xp || 0) > 0)
      .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
      .slice(0, limit)
      .map(([userId, v]) => ({ userId, xp: v.xp || 0, level: levelOf(v.xp || 0), voiceSeconds: v.voiceSeconds || 0 }))
      .map((x, i) => ({ ...x, rank: i + 1 }));
  }

  // ---------- system ----------
  getSystem() {
    return this.db.system || (this.db.system = { ownerId: null });
  }
  claimOwner(userId) {
    const sys = this.getSystem();
    if (!sys.ownerId) {
      sys.ownerId = userId;
      this.save();
    }
    return sys.ownerId;
  }
}

export const store = new Store();

// ---------------------------------------------------------------- Level-Formel
// XP-Kurve: level n erfordert n^2 * 25 XP gesamt (Level 1 = 25 XP, Level 2 = 100 XP, ...)
export function levelOf(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 25));
}
export function xpForLevel(level) {
  return level * level * 25;
}
export function xpIntoLevel(xp) {
  const l = levelOf(xp);
  return Math.max(0, xp - xpForLevel(l));
}
export function xpToNext(level) {
  return xpForLevel(level + 1) - xpForLevel(level);
}
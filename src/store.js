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
  };
}

export class Store {
  constructor() {
    this.db = {
      configs: {},
      panels: {},
      tickets: [],
      actions: [],
      meta: { ticketSeq: {} },
    };
  }

  init() {
    const dir = config.dataDir;
    fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
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
}

export const store = new Store();
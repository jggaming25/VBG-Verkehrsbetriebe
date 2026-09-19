import { store } from '../store.js';
import { closeTicket, deleteTicket } from './core.js';

export function startJobs(client) {
  setInterval(() => autoClose(client), 60_000);
  setInterval(() => autoDelete(client), 60_000);
  reconcile(client).catch(() => {});
}

async function autoClose(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = store.getConfig(guild.id);
    if (!cfg || !cfg.autoCloseMinutes) continue;
    for (const t of store.getTickets(guild.id)) {
      if (t.status !== 'open') continue;
      const idle = Date.now() - (t.lastActivityAt || t.createdAt);
      if (idle > cfg.autoCloseMinutes * 60_000) {
        try {
          await closeTicket({ guild, ticket: t, actor: null, reason: 'Automatische Schließung (Inaktivität)', auto: true });
          console.log(`[JOBS] Auto-Close: ${t.id}`);
        } catch (e) {
          console.error('[JOBS] Auto-Close Fehler:', e.message);
        }
      }
    }
  }
}

async function autoDelete(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = store.getConfig(guild.id);
    if (!cfg || !cfg.autoDeleteHours) continue;
    for (const t of store.getTickets(guild.id)) {
      if (t.status !== 'closed' || !t.closedAt) continue;
      if (Date.now() - t.closedAt > cfg.autoDeleteHours * 3_600_000) {
        try {
          await deleteTicket({ guild, ticket: t, actor: null });
          console.log(`[JOBS] Auto-Delete: ${t.id}`);
        } catch (e) {
          console.error('[JOBS] Auto-Delete Fehler:', e.message);
        }
      }
    }
  }
}

async function reconcile(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const t of store.getTickets(guild.id)) {
      if (t.status === 'deleted') continue;
      const channel = guild.channels.cache.get(t.channelId);
      if (!channel && t.status !== 'closed') {
        store.updateTicket(t.id, { status: t.status === 'closed' ? t.status : 'deleted', deletedAt: Date.now() });
      }
    }
  }
}
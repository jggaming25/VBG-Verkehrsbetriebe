import { Client, GatewayIntentBits, Events, ActivityType, ChannelType } from 'discord.js';
import { config } from '../config.js';
import { store } from '../store.js';
import { registerCommands } from './register.js';
import { handleInteraction } from './interactions.js';
import { startJobs } from './jobs.js';
import { startModules } from './modules.js';
import { isStopped, clearFlag, writeFlag } from './control.js';
import { isStaff } from '../auth.js';

const MIN_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
const FULL_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

export let client = null;

export function isBotRunning() {
  return Boolean(client && client.isReady && client.isReady());
}

export async function stopBot() {
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.error('[BOT] Destroy-Fehler:', e.message);
    }
    client = null;
  }
  writeFlag('stop');
  console.log('🛑 Bot gestoppt. Starte das Dashboard neu (Button „Starten“) bzw. starte den Prozess neu.');
}

export async function restartBot() {
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.error('[BOT] Destroy-Fehler:', e.message);
    }
    client = null;
  }
  console.log('🔄 Bot wird neu gestartet (neuer Login, Commands werden neu registriert)…');
  return startBot();
}

function attach(c) {
  c.once(Events.ClientReady, async (ready) => {
    console.log(`[BOT] Online als ${ready.user.tag}`);
    ready.user.setActivity('/panel', { type: ActivityType.Watching });
    try {
      await registerCommands(c);
    } catch (e) {
      console.error('[BOT] Slash-Registrierung fehlgeschlagen:', e.message);
    }
    startJobs(c);
    startModules(c);
  });

  c.on(Events.MessageCreate, (m) => {
    if (!m.guild || m.author.bot || m.system || m.channel.type === ChannelType.DM) return;
    const t = store.getTicket(m.guild.id, m.channel.id);
    if (!t || t.status !== 'open') return;
    const cfg = store.ensureConfig(m.guild.id);
    const isStaffMsg = m.member && isStaff(m.member, cfg);
    const patch = { messageCount: t.messageCount + 1, lastActivityAt: Date.now() };
    if (isStaffMsg && !t.firstResponseAt) patch.firstResponseAt = Date.now();
    Object.assign(t, patch);
    if (Date.now() - (t._sv || 0) > 120000) {
      t._sv = Date.now();
      store.save();
    }
  });

  c.on(Events.InteractionCreate, (i) => {
    handleInteraction(c, i).catch((e) => {
      console.error('[BOT] Interaction-Fehler:', e.message);
    });
  });

  c.on(Events.Error, (e) => console.error('[BOT] Client-Fehler:', e.message));
}

function build(intents) {
  const c = new Client({ intents });
  attach(c);
  return c;
}

export async function startBot() {
  if (isStopped()) {
    console.warn('⏸️ Bot ist per System-Flag gestoppt. Im Dashboard → System auf „Starten“ klicken oder system.flag entfernen.');
    return null;
  }
  clearFlag();
  const boot = async (intents) => {
    const c = build(intents);
    await c.login(config.token);
    return c;
  };
  try {
    client = await boot(FULL_INTENTS);
  } catch (e) {
    if (/disallowed/i.test(e.message || '')) {
      console.warn(
        '[BOT] Privilegierte Intents (GuildMembers/MessageContent) sind im Developer Portal nicht aktiviert – starte mit minimalen Intents. Bitte dort aktivieren für volle Funktionen.'
      );
      client = await boot(MIN_INTENTS);
    } else {
      throw e;
    }
  }
  return client;
}
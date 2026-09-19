import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { commands } from './commands.js';

export async function registerCommands(client) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commands.map((c) => c.data.toJSON());
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`[BOT] ${body.length} Slash-Commands registriert${config.guildId ? ` (Guild ${config.guildId})` : ' (global)'}`);
}
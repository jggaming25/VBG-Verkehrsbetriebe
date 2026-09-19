import 'dotenv/config';
import crypto from 'node:crypto';

const randomHex = () => crypto.randomBytes(32).toString('hex');

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || randomHex(),
  guildId: process.env.GUILD_ID || '',
  adminRoleId: process.env.ADMIN_ROLE_ID || '1544006176109498458',
  port: Number(process.env.PORT) || 10000,
  webUrl: String(process.env.WEB_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  dataDir: process.env.DATA_DIR || './data',
  isProd: process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER_EXTERNAL_URL),
  // Optionale API-Keys fuer Zusatzmodule
  removeBgApiKey: process.env.REMOVEBG_API_KEY || '',
  twitchClientId: process.env.TWITCH_CLIENT_ID || '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || '',
};
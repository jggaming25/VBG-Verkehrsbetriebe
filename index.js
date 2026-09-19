import { config } from './src/config.js';
import { store } from './src/store.js';
import { startBot } from './src/bot/client.js';
import { startWeb } from './src/web/index.js';

if (!config.token) {
  console.error('❌ DISCORD_TOKEN fehlt in .env!');
  process.exit(1);
}

if (!config.clientSecret) {
  console.warn('⚠️ CLIENT_SECRET fehlt in .env – Dashboard-Login (Discord) funktioniert erst nach Eintrag. Siehe README.');
}

store.init();
startWeb();
startBot().then(() => {
  console.log('✅ Bot gestartet.');
}).catch((e) => {
  console.error('❌ Bot-Login fehlgeschlagen:', e.message);
  process.exit(1);
});
import { config } from '../config.js';

const redirectUri = () => `${config.webUrl}/auth/callback`;

export function loginUrl(state) {
  const p = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${p}`;
}

export async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(j.error_description || 'OAuth-Token-Fehler');
  }
  const headers = { Authorization: `Bearer ${j.access_token}` };
  const [user, guildsRes] = await Promise.all([
    fetch('https://discord.com/api/users/@me', { headers }).then((x) => x.json()),
    fetch('https://discord.com/api/users/@me/guilds', { headers }).then((x) => x.json()),
  ]);
  const guilds = Array.isArray(guildsRes) ? guildsRes : [];
  return {
    token: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
    user,
    guilds: guilds.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      permissions: String(g.permissions),
    })),
  };
}
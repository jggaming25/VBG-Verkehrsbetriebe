const state = {
  data: null,
  sys: { running: false, ownerId: null, isOwner: false },
  guildIndex: 0,
  view: 'overview',
  ticketFilter: 'all',
  ticketSearch: '',
};

const $ = (s) => document.querySelector(s);
const main = () => $('#main');
const toast = (m, t = 2600) => {
  const el = $('#toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), t);
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(ts) {
  return ts ? new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
}
function ago(ts) {
  if (!ts) return '–';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function guildIcon(g) {
  return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null;
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/auth/login'; throw new Error('login'); }
  if (r.status === 403) throw new Error('Keine Berechtigung – Admin-Rolle erforderlich.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fehler');
  return j;
}
const jsonBody = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- system modal / confirm

function openModal(html) {
  const back = $('#modalBack');
  const mod = $('#modal');
  mod.innerHTML = html;
  back.hidden = false;
  return new Promise((resolve) => {
    const _close = (val) => { back.hidden = true; mod.innerHTML = ''; resolve(val); };
    back.querySelectorAll('[data-yes]').forEach((b) => b.addEventListener('click', () => _close(true)));
    back.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => _close(false)));
    back.addEventListener('click', (e) => { if (e.target === back) _close(false); });
  });
}
function confirmModal(title, msg, yesLabel, danger) {
  return openModal(`
    <h3>${esc(title)}</h3>
    <p>${esc(msg)}</p>
    <div class="row" style="justify-content:flex-end">
      <button class="btn ghost sm" data-no>Abbrechen</button>
      <button class="btn sm ${danger ? 'red' : 'green'}" data-yes>${esc(yesLabel)}</button>
    </div>`);
}

// ---------------------------------------------------------------- init

const NAV = [
  { group: 'Ticket-System' },
  { id: 'overview', icon: '📊', label: 'Übersicht' },
  { id: 'tickets', icon: '🎟️', label: 'Tickets' },
  { id: 'panels', icon: '🧩', label: 'Panels' },
  { group: 'Module' },
  { id: 'suggestions', icon: '💡', label: 'Vorschläge' },
  { id: 'news', icon: '📰', label: 'News' },
  { id: 'moderation', icon: '🛡️', label: 'Moderation' },
  { id: 'welcome', icon: '👋', label: 'Willkommen' },
  { id: 'privatevoice', icon: '🎤', label: 'Private Kanäle' },
  { id: 'support', icon: '🎧', label: 'Voice-Support' },
  { id: 'stats', icon: '📈', label: 'Server-Stats' },
  { id: 'protection', icon: '🔐', label: 'Schutz' },
  { id: 'activity', icon: '🏅', label: 'Aktivität' },
  { id: 'levels', icon: '🏆', label: 'Level-System' },
  { id: 'social', icon: '📱', label: 'Social Media' },
  { group: 'Verwaltung' },
  { id: 'settings', icon: '⚙️', label: 'Einstellungen' },
  { id: 'logs', icon: '📜', label: 'Audit-Logs' },
  { id: 'system', icon: '🖥️', label: 'System' },
];

async function refreshState() {
  state.data = await api('/api/state');
}

async function refreshSystem() {
  try {
    state.sys = await api('/api/system');
  } catch {
    state.sys = { running: false, ownerId: null, isOwner: false };
  }
  const pill = $('#sysPill');
  if (pill) {
    pill.className = 'system-pill ' + (state.sys.running ? 'on' : 'off');
    pill.innerHTML = `<span class="dot"></span>${state.sys.running ? 'Bot online' : 'Bot gestoppt'}`;
  }
}

async function init() {
  await Promise.all([refreshState().catch((e) => toast(e.message)), refreshSystem()]);
  const u = state.data.user;
  $('#userInfo').innerHTML = `<b>${esc(u.global_name || u.username)}</b>`;
  renderNav();
  renderGuildList();
  render();
  setInterval(refreshSystem, 15000);
}

function renderNav() {
  $('#nav').innerHTML = NAV.map((e) => e.group ? `<div class="group">${esc(e.group)}</div>` : `
    <button data-view="${e.id}" class="${state.view === e.id ? 'active' : ''}">
      <span>${e.icon}</span>${esc(e.label)}
    </button>`).join('');
  document.querySelectorAll('#nav button').forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      renderNav();
      render();
    })
  );
}

function renderGuildList() {
  const list = $('#guildList');
  if (!state.data.guilds.length) {
    list.innerHTML = '<p class="muted small" style="padding: 8px 10px">Kein Server mit Admin-Rechten.</p>';
    return;
  }
  state.guildIndex = Math.min(state.guildIndex, state.data.guilds.length - 1);
  list.innerHTML = state.data.guilds
    .map((g, i) => {
      const gd = g.guild;
      const img = guildIcon(gd);
      return `<div class="guild ${i === state.guildIndex ? 'active' : ''}" data-gidx="${i}">
        ${img ? `<img src="${img}" alt="">` : `<div class="no-img">${esc(gd.name[0].toUpperCase())}</div>`}
        <span>${esc(gd.name)}</span></div>`;
    })
    .join('');
  list.querySelectorAll('.guild').forEach((el) =>
    el.addEventListener('click', () => {
      state.guildIndex = Number(el.dataset.gidx);
      renderGuildList();
      render();
    })
  );
}

function current() {
  return state.data.guilds[state.guildIndex];
}
function gid() {
  return current().guild.id;
}

// ---------------------------------------------------------------- router

function render() {
  if (!state.data) return;
  if (!state.data.guilds.length) {
    renderNoGuild();
    return;
  }
  const view = state.view;
  if (!state.data.guilds[state.guildIndex]) { state.guildIndex = 0; renderGuildList(); }
  const handlers = {
    overview: renderOverview,
    tickets: renderTickets,
    panels: renderPanels,
    suggestions: () => renderModule('suggestions', viewSuggestions),
    news: () => renderModule('news', viewNews),
    moderation: () => renderModule('moderation', viewModeration),
    welcome: () => renderModule('welcome', viewWelcome),
    stats: () => renderModule('stats', viewStats),
    privatevoice: () => renderModule('privatevoice', viewPrivateVoice),
    support: () => renderModule('support', viewSupport),
    protection: () => renderModule('protection', viewProtection),
    activity: () => renderModule('activity', viewActivity),
    levels: () => renderModule('levels', viewLevels),
    social: () => renderModule('social', viewSocial),
    settings: renderSettings,
    logs: renderLogs,
    system: renderSystem,
  };
  (handlers[view] || renderOverview)();
}

function renderNoGuild() {
  main().innerHTML = `
    <div class="hero"><div class="icon">🤖</div><div class="t">
      <h1>Willkommen!</h1>
      <p class="sub">${state.sys.running ? 'Kein Server verfügbar – lade den Bot in deinen Server ein und stelle sicher, dass du die Admin-Rolle hast.' : 'Der Bot ist aktuell gestoppt. Er kann über System wieder gestartet werden.'}</p>
    </div></div>
    ${state.sys.running ? '' : `<div class="card danger-zone mt">
      <div class="row between wrap">
        <div><b>Bot ist gestoppt</b><p class="muted small">Starte den Bot neu, um das Dashboard zu nutzen.</p></div>
        <button class="btn green" id="sysStart">▶️ Bot starten</button>
      </div>
    </div>`}`;
  const sb = $('#sysStart');
  if (sb) sb.addEventListener('click', () => control('start', 'Bot starten', 'Soll der Bot wirklich gestartet werden?'));
  if (!$('#sysPill')) bindSysPill();
}

function bindSysPill() {
  const pill = document.createElement('span');
  pill.id = 'sysPill';
  pill.className = 'system-pill ' + (state.sys.running ? 'on' : 'off');
  pill.innerHTML = `<span class="dot"></span>${state.sys.running ? 'Bot online' : 'Bot gestoppt'}`;
  $('#userInfo').appendChild(document.createElement('br'));
  $('#userInfo').appendChild(pill);
}

// ---------------------------------------------------------------- system

function renderSystem() {
  const s = state.sys;
  main().innerHTML = `
    <div class="hero"><div class="icon">🖥️</div><div class="t">
      <h1>System-Verwaltung</h1>
      <p class="sub">Stoppen und Neustarten des Bots – nützlich z.B. nach Update-Deploys.</p>
    </div><span class="system-pill ${s.running ? 'on' : 'off'}" id="sysPill"><span class="dot"></span>${s.running ? 'Bot online' : 'Bot gestoppt'}</span></div>

    <div class="grid g2">
      <div class="card">
        <h3>⚙️ Betrieb</h3>
        <p class="muted small mt">Status, Verbindung und Command-Registrierung.</p>
        <div class="row mt wrap">
          <button class="btn green" id="ctrlRestart" ${s.running ? '' : 'disabled'}>🔄 Neustart</button>
          <button class="btn red" id="ctrlStop" ${s.running ? '' : 'disabled'}>⏹️ Stoppen</button>
          <button class="btn ghost" id="ctrlStart" ${s.running ? 'disabled' : ''}>▶️ Starten</button>
        </div>
        <p class="muted small mt" id="sysMsg">${s.isOwner ? 'Du bist der System-Owner und darfst steuern.' : s.ownerId ? '⚠️ Ein anderer Benutzer ist als System-Owner festgelegt – nur er kann steuern.' : 'Du wirst beim ersten Befehl automatisch als System-Owner festgelegt.'}</p>
      </div>
      <div class="card">
        <h3>ℹ️ Informationen</h3>
        <p class="muted small mt">Nach einem <b>Neustart</b> loggt sich der Bot neu ein und registriert die Slash-Commands frisch. Falls du neuen Code gepusht hast, deployt Render automatisch – für einen sofortigen Update-Rollout:<br><br>
        <code>Push → Render Man. Deploy → dann hier „🔄 Neustart“</code> klicken.</p>
        <p class="muted small mt"><b>Stoppen:</b> Der Bot wird sauber getrennt, das Dashboard bleibt erreichbar. Danach mit „▶️ Starten“ wieder aktivieren.</p>
      </div>
    </div>`;

  $('#ctrlRestart').addEventListener('click', async () => {
    const ok = await confirmModal('Bot neu starten?', 'Der Bot wird abgemeldet und frisch eingeloggt (z.B. nach Updates). Das dauert wenige Sekunden.', 'Neu starten');
    if (!ok) return;
    await doControl('restart', '🔄 Neustart angestoßen…');
  });
  $('#ctrlStop').addEventListener('click', async () => {
    const ok = await confirmModal('Bot stoppen?', 'Der Bot wird vom Discord-Server getrennt. Das Dashboard bleibt erreichbar. Tickets/Aktionen sind währenddessen nicht möglich.', 'Stoppen', true);
    if (!ok) return;
    await doControl('stop', '🛑 Bot wurde gestoppt.');
  });
  $('#ctrlStart').addEventListener('click', async () => {
    const ok = await confirmModal('Bot starten?', 'Starte den Bot neu (einloggen + Commands registrieren).', 'Starten');
    if (!ok) return;
    await doControl('start', '▶️ Bot wird gestartet…');
  });
}

async function doControl(action, msg) {
  try {
    const r = await api('/api/system/control', jsonBody({ action }));
    toast(msg);
    await refreshSystem();
    await refreshState();
    render();
    setTimeout(() => { location.reload(); }, 1200);
  } catch (e) {
    toast(e.message);
    await refreshSystem();
    render();
  }
}
const control = doControl;

// ---------------------------------------------------------------- overview

function statCard(val, lab, extra) {
  return `<div class="stat"><div class="val">${val}</div><div class="lab">${lab}</div>${extra || ''}</div>`;
}

function ticketRow(t) {
  const st = t.status === 'claimed' ? 'claimed' : t.status === 'closed' ? 'closed' : t.status === 'deleted' ? 'deleted' : 'open';
  return `<tr class="clickable" data-tid="${esc(t.id)}">
    <td><b>${esc(t.id)}</b></td>
    <td><span class="badge ${st}">${esc(t.status)}</span></td>
    <td>${esc(t.topic || '–')}</td>
    <td>${esc(t.creatorName)}</td>
    <td>${t.claimedBy ? `<code>${esc(t.claimedBy)}</code>` : '–'}</td>
    <td>${fmt(t.createdAt)}</td>
    <td>${ago(t.closedAt || t.createdAt)}</td>
  </tr>`;
}

function renderOverview() {
  const g = current();
  const s = g.stats;
  main().innerHTML = `
    <div class="hero"><div class="icon">📊</div><div class="t">
      <h1>${esc(g.guild.name)}</h1>
      <p class="sub">Zeige mir die wichtigsten Kennzahlen deines Ticket-Systems.</p>
    </div></div>
    <div class="stats grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      ${statCard(s.open, 'Offen', '<span style="color:var(--green)">●</span>')}
      ${statCard(s.claimed, 'Geclaimt', '<span style="color:var(--yellow)">●</span>')}
      ${statCard(s.closed, 'Geschlossen', '<span style="color:var(--red)">●</span>')}
      ${statCard(s.total, 'Gesamt')}
      ${statCard(s.week, 'Diese Woche')}
      ${statCard(s.avgResponse ? s.avgResponse + 's' : '–', 'Ø Antwortzeit')}
      ${statCard(s.avgStars ? '⭐ ' + s.avgStars : '–', 'Ø Bewertung')}
    </div>
    <h2>Aktuelle Tickets</h2>
    <div class="card mt">
      <table>
        <thead><tr><th>ID</th><th>Status</th><th>Thema</th><th>Ersteller</th><th>Claimed</th><th>Erstellt</th><th>Aktivität</th></tr></thead>
        <tbody>${g.recentTickets.length ? g.recentTickets.map(ticketRow).join('') : '<tr><td colspan="7" class="muted">Noch keine Tickets.</td></tr>'}</tbody>
      </table>
    </div>`;
  bindTicketRows();
}

function renderTickets() {
  const gidV = gid();
  const tabs = ['all', 'open', 'claimed', 'closed', 'deleted'];
  main().innerHTML = `
    <div class="hero"><div class="icon">🎟️</div><div class="t">
      <h1>Tickets</h1><p class="sub">Alle Tickets mit Filter, Suche und Details inkl. Transkript.</p>
    </div></div>
    <div class="row between wrap">
      <div class="tabs">
        ${tabs.map((x) => `<button class="tab ${state.ticketFilter === x ? 'active' : ''}" data-f="${x}">${esc(x)}</button>`).join('')}
      </div>
      <input style="max-width:300px" placeholder="🔍 Suchen (ID, Creator, Thema)…" id="tSearch" value="${esc(state.ticketSearch)}">
    </div>
    <div class="card mt"><table>
      <thead><tr><th>ID</th><th>Status</th><th>Thema</th><th>Ersteller</th><th>Claimed</th><th>Erstellt</th><th>Aktivität</th></tr></thead>
      <tbody id="tBody"><tr><td colspan="7" class="muted">Lade…</td></tr></tbody></table></div>`;

  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { state.ticketFilter = b.dataset.f; renderTickets(); }));
  $('#tSearch').addEventListener('input', (e) => {
    state.ticketSearch = e.target.value.toLowerCase();
    loadTickets(gidV);
  });
  loadTickets(gidV);
}

async function loadTickets(gidV) {
  const data = await api(`/api/g/${gidV}/tickets?status=${state.ticketFilter}`);
  const q = state.ticketSearch;
  let list = data.tickets;
  if (q) list = list.filter((t) => [t.id, t.creatorName, t.creatorTag, t.topic, t.channelName].join(' ').toLowerCase().includes(q));
  const body = $('#tBody');
  if (body) {
    body.innerHTML = list.length ? list.map(ticketRow).join('') : '<tr><td colspan="7" class="muted">Keine Tickets gefunden.</td></tr>';
    bindTicketRows();
  }
}

function bindTicketRows() {
  document.querySelectorAll('tr[data-tid]').forEach((tr) => tr.addEventListener('click', () => showTicket(tr.dataset.tid)));
}

async function showTicket(id) {
  const g = current();
  const data = await api(`/api/g/${g.guild.id}/tickets/${id}`);
  const t = data.ticket;
  const fb = t.feedback;
  main().innerHTML = `
    <div class="row between wrap">
      <div class="row"><a class="btn ghost sm" href="javascript:void(0)" id="bBack">← Zurück</a>
        <h1 style="margin:0 0 0 10px">${esc(t.id)} <span class="badge ${t.status}">${esc(t.status)}</span></h1>
      </div>
      <div class="row">
        ${t.status !== 'deleted' && t.status !== 'closed' ? `<button class="btn sm red" data-act="close">🔒 Schließen</button>` : ''}
        ${t.status === 'closed' ? `<button class="btn sm yellow" data-act="reopen">🔓 Wieder öffnen</button>` : ''}
        ${t.status !== 'deleted' ? `<button class="btn sm red" data-act="delete">🗑️ Löschen</button>` : ''}
      </div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><b>Ersteller</b><p class="mt small">${esc(t.creatorName)} (<code>${esc(t.creatorTag)}</code>)</p></div>
      <div class="card"><b>Thema</b><p class="mt small">${esc(t.topic || '–')}</p></div>
      <div class="card"><b>Kanal</b><p class="mt small">${t.channelName ? `<code>#${esc(t.channelName)}</code>` : '(gelöscht)'}</p></div>
      <div class="card"><b>Erstellt</b><p class="mt small">${fmt(t.createdAt)}</p></div>
      ${t.claimedBy ? `<div class="card"><b>Claimed von</b><p class="mt small"><code>${esc(t.claimedBy)}</code> (${fmt(t.claimAt)})</p></div>` : ''}
      ${t.closeReason ? `<div class="card"><b>Schließgrund</b><p class="mt small">${esc(t.closeReason)}</p></div>` : ''}
      ${t.closeRequest ? `<div class="card"><b>🔔 Schließanfrage</b><p class="mt small">${esc(t.closeRequest)}</p></div>` : ''}
      ${fb ? `<div class="card"><b>Feedback</b><p class="mt small">${'⭐'.repeat(fb.stars)}${'☆'.repeat(5 - fb.stars)}${fb.comment ? `<br>${esc(fb.comment)}` : ''}</p></div>` : ''}
      <div class="card"><b>Nachrichten</b><p class="mt small">${t.messageCount}</p></div>
      ${t.firstResponseAt ? `<div class="card"><b>Erste Antwort</b><p class="mt small">${fmt(t.firstResponseAt)}</p></div>` : ''}
      ${t.notes && t.notes.length ? `<div class="card"><b>📝 Notizen</b><p class="mt small">${t.notes.length} private Team-Notizen</p></div>` : ''}
    </div>
    <h2>Transkript</h2>
    <div class="card mt"><pre>${esc(data.transcript || 'Kein Transkript vorhanden.')}</pre></div>`;

  $('#bBack').addEventListener('click', () => renderNavView('tickets'));
  document.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'delete') {
        const ok = await confirmModal(`Ticket ${t.id} löschen?`, 'Kanal wird unwiderruflich gelöscht. Das Transkript bleibt gespeichert.', 'Löschen', true);
        if (!ok) return;
      }
      let reason;
      if (act === 'close') {
        const r = await promptModal('Ticket schließen', 'Grund (optional):');
        if (r === null) return;
        reason = r;
      }
      try {
        await api(`/api/g/${g.guild.id}/tickets/${t.id}/action`, jsonBody({ action: act, reason }));
        toast(`✅ ${act} durchgeführt`);
        await refreshState();
        if (act === 'delete') renderNavView('tickets'); else showTicket(t.id);
      } catch (e) { toast(e.message); }
    })
  );
}

function renderNavView(view) {
  state.view = view;
  renderNav();
  render();
}
function promptModal(title, msg) {
  return openModal(`
    <h3>${esc(title)}</h3>
    <p>${esc(msg)}</p>
    <input id="promptVal" placeholder="…">
    <div class="row mt" style="justify-content:flex-end">
      <button class="btn ghost sm" data-no>Abbrechen</button>
      <button class="btn sm green" data-yes>OK</button>
    </div>`).then((ok) => ok ? ($('#promptVal').value || '').trim() : null);
}

// ---------------------------------------------------------------- panels (GalaxyBot-Stil)

state.editor = { panel: null, meta: null, tab: 'general' };

const RATING_SHOW = ['creator', 'category', 'closeReason', 'handler', 'duration', 'rating'];
const FORMAT_OPTS = [
  { id: 'PREFIX-USERNAME', label: '%PREFIX%-%USERNAME%', desc: 'z.B. bug-pluto' },
  { id: 'PREFIX-USER_ID', label: '%PREFIX%-%USER_ID%', desc: 'z.B. bug-821835831844012103' },
  { id: 'PREFIX-USER_NICK_NAME', label: '%PREFIX%-%USER_NICK_NAME%', desc: 'z.B. bug-pluto-plüschi' },
  { id: 'custom', label: 'Eigene', desc: 'eigenes Format mit Platzhaltern' },
];

function renderPanels() {
  if (state.editor.panel) return renderPanelEditor();
  const g = current();
  if (!state.editor.meta) {
    (async () => {
      try {
        const meta = await api(`/api/g/${g.guild.id}/panel-meta`);
        state.editor.meta = meta.meta;
        renderPanels();
      } catch { /* weiter mit Liste ohne Namen */ }
    })();
  }
  main().innerHTML = `
    <div class="row between wrap">
      <div class="hero"><div class="icon">🧩</div><div class="t">
        <h1>Panels</h1><p class="sub">Ticket-Panels mit Kategorien, Embeds, Automatisierung und mehr.</p>
      </div></div>
      <button class="btn sm" id="newPanelBtn">＋ Neues Panel erstellen</button>
    </div>
    <div class="grid g2 mt" id="panelList"></div>`;

  $('#newPanelBtn').addEventListener('click', async () => {
    try {
      const meta = await api(`/api/g/${g.guild.id}/panel-meta`);
      state.editor = { panel: null, meta: meta.meta, tab: 'general' };
      renderPanelEditor();
    } catch (e) { toast(e.message); }
  });

  const panels = g.panels;
  $('#panelList').innerHTML = panels.length
    ? panels.map((p) => `<div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:14px;height:14px;border-radius:4px;background:#${esc(p.color || '5865F2')};border:1px solid var(--border)"></span>
          <b>${esc(p.name || p.title)}</b>
        </div>
        <p class="muted small mt">Kanal: <code>#${esc(channelName(p.channelId))}</code></p>
        <p class="muted small">${p.categories.length} Kategorie(n): ${(p.categories || []).map((c) => `${c.emoji || ''} ${esc(c.name || c.label)}`).join(', ')}</p>
        <div class="row mt between">
          <button class="btn ghost sm" data-edit="${esc(p.id)}">✏️ Bearbeiten</button>
          <button class="btn red sm" data-dpid="${esc(p.id)}">🗑️</button>
        </div>
      </div>`).join('')
    : '<p class="muted">Keine Panels. Erstelle dein erstes Panel mit <b>＋ Neues Panel erstellen</b>.</p>';

  document.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        const [meta, pd] = await Promise.all([
          api(`/api/g/${g.guild.id}/panel-meta`),
          api(`/api/g/${g.guild.id}/panels/${b.dataset.edit}`),
        ]);
        state.editor = { panel: pd.panel, meta: meta.meta, tab: 'general' };
        renderPanelEditor();
      } catch (e) { toast(e.message); }
    })
  );
  document.querySelectorAll('[data-dpid]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!await confirmModal('Panel löschen?', 'Das Panel wird aus dem Dashboard entfernt. In Discord gesendete Panels bleiben bestehen, sofern nicht manuell gelöscht.', 'Löschen', true)) return;
      await api(`/api/g/${g.guild.id}/panels/delete`, jsonBody({ panelId: b.dataset.dpid }));
      toast('🗑️ Panel gelöscht');
      await refreshState();
      renderPanels();
    })
  );
}

function channelName(id) {
  const list = (state.editor && state.editor.meta ? state.editor.meta.textChannels : []);
  const hit = list.find((c) => c.id === id);
  return hit ? hit.name : id || '–';
}

function catName(id) {
  const list = (state.editor && state.editor.meta ? state.editor.meta.categories : []);
  const hit = list.find((c) => c.id === id);
  return hit ? hit.name : id || '–';
}

function roleName(id) {
  const m = state.editor.meta;
  const hit = m.roles.find((r) => r.id === id);
  return hit ? hit.name : id || '–';
}

function optCategories() {
  return state.editor.meta.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}
function optTextChannels(selected) {
  return [`<option value="">— Keiner —</option>`, ...state.editor.meta.textChannels.map((c) => `<option value="${esc(c.id)}" ${selected === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`)].join('');
}
function optRoles(multiSel) {
  return state.editor.meta.roles.map((r) => `<option value="${esc(r.id)}" ${(multiSel || []).includes(r.id) ? 'selected' : ''}>@${esc(r.name)}</option>`).join('');
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}
function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `${c(r)}${c(g)}${c(b)}`;
}

const PANEL_TABS = [
  { id: 'general', label: 'Allgemeines' },
  { id: 'embeds', label: 'Embeds' },
  { id: 'categories', label: 'Kategorien' },
  { id: 'rating', label: 'Bewertung' },
  { id: 'automation', label: 'Automation' },
  { id: 'logs', label: 'Logs' },
  { id: 'claim', label: 'Claim-Kategorie' },
  { id: 'send', label: 'Panel senden' },
];

function editorHeader(p) {
  return `
    <div class="row between wrap" style="margin-bottom:18px">
      <div class="hero" style="margin:0"><div class="icon">🧩</div><div class="t">
        <h1>${state.editor.panel ? 'Panel bearbeiten' : 'Neues Panel erstellen'}</h1>
        <p class="sub" style="margin:0">${esc(p.name || 'Unbenanntes Panel')}</p>
      </div></div>
      <button class="btn ghost sm" id="edClose">← Zurück zu Panels</button>
    </div>
    <div class="tabs" style="margin-bottom:16px">
      ${PANEL_TABS.map((t) => `<button class="tab ${state.editor.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>`;
}

function renderPanelEditor() {
  const ed = state.editor;
  const p = ed.panel || (ed.panel = {
    id: null, name: '', channelId: '', color: '5865F2', ticketNameFormat: 'PREFIX-USERNAME', customTicketNameFormat: '%PREFIX%-%USERNAME%',
    mentionTeam: false, maxTicketsPerUser: 0, closeRestricted: false, onLeaveAction: 'none', allowAddUsers: false,
    panelEmbed: { title: '', description: '', image: null }, openingEmbed: { title: '', description: '', image: null },
    categories: [], rating: { enabled: false, channelId: null, publicChannelId: null },
    automation: { autoCloseDays: 0, autoAlertMinutes: 0, autoTeamAlertMinutes: 0, autoUnclaimMinutes: 0, closeIfNoResponse: false, autoClaim: false, closeAfterCloseRequest: false },
    logs: { enabled: false, channelId: null, transcripts: true },
    claimCategory: { enabled: false, categoryId: null },
  });

  let body = '';
  if (ed.tab === 'general') body = tabGeneral(p);
  if (ed.tab === 'embeds') body = tabEmbeds(p);
  if (ed.tab === 'categories') body = tabCategories(p);
  if (ed.tab === 'rating') body = tabRating(p);
  if (ed.tab === 'automation') body = tabAutomation(p);
  if (ed.tab === 'logs') body = tabLogs(p);
  if (ed.tab === 'claim') body = tabClaim(p);
  if (ed.tab === 'send') body = tabSend(p);

  main().innerHTML = editorHeader(p) + body;
  bindEditorEvents(p);
}

function panelField(label, id, value, type = 'text', hint = '') {
  const attrs = type === 'number' ? `min="0"` : '';
  const t = type === 'textarea' ? `<textarea id="${id}">${esc(value == null ? '' : value)}</textarea>` : `<input id="${id}" type="${type === 'number' ? 'number' : 'text'}" value="${esc(value == null ? '' : value)}" ${attrs}>`;
  return `<div><label>${label}</label>${t}${hint ? `<p class="muted small">${hint}</p>` : ''}</div>`;
}

function switchRow(id, checked, label, hint = '') {
  return `<div class="card"><b class="small">${label}</b>${hint ? `<p class="muted small">${hint}</p>` : ''}
    <div class="row mt"><label class="switch" style="margin:0"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label></div></div>`;
}

function switchLine(id, checked, label, cls = '', value = '') {
  return `<label class="switchLine ${cls}" style="margin:0;cursor:pointer">
    <span class="switch" style="margin:0;cursor:pointer"><input type="checkbox" class="${id}" ${checked ? 'checked' : ''} ${value ? `value="${esc(value)}"` : ''}><span class="track"></span><span class="knob"></span></span>
    <span class="switchText">${label}</span>
  </label>`;
}

function rgbColorPicker(id, rgb) {
  return `<div class="rgbpicker">
    <input type="color" id="${id}_color" value="#${rgbToHex(rgb.r, rgb.g, rgb.b)}">
    <div class="rgbrow"><span>R</span><input type="range" id="${id}_r" min="0" max="255" value="${rgb.r}"><b id="${id}_rv">${rgb.r}</b></div>
    <div class="rgbrow"><span>G</span><input type="range" id="${id}_g" min="0" max="255" value="${rgb.g}"><b id="${id}_gv">${rgb.g}</b></div>
    <div class="rgbrow"><span>B</span><input type="range" id="${id}_b" min="0" max="255" value="${rgb.b}"><b id="${id}_bv">${rgb.b}</b></div>
    <input id="${id}_hex" type="text" value="#${rgbToHex(rgb.r, rgb.g, rgb.b)}" maxlength="7">
  </div>`;
}

function tabGeneral(p) {
  return `<div class="grid g2 mt">
    <div class="card">${panelField('Name', 'eName', p.name, 'text', 'Name, den du dem Panel gibst (z.B. „Panel 1")')}</div>
    <div class="card"><label>Kanal (Panel erscheint dort)</label>
      <select id="eChannel"><option value="">— Kanal wählen —</option>${state.editor.meta.textChannels.map((c) => `<option value="${esc(c.id)}" ${p.channelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>
      <p class="muted small">Dies sollte nicht dein Transkript-Kanal sein.</p>
    </div>
  </div>
  <div class="grid g2 mt">
    ${switchRow('eMentionTeam', p.mentionTeam, 'Team markieren', 'Teammitglieder werden automatisch bei neuen Tickets dieser Kategorie markiert (Ping wird direkt gelöscht).')}
    ${switchRow('eCloseRestricted', p.closeRestricted, 'Ticket schließen einschränken', 'Nur Teammitglieder können Tickets schließen – nicht der Ersteller.')}
    ${switchRow('eAllowAdd', p.allowAddUsers, 'Weitere Personen hinzufügen lassen', 'Erlaubt dem Ticket-Ersteller, weitere Nutzer über /ticket add hinzuzufügen.')}
    ${switchRow('eAutoClaim', p.automation.autoClaim, 'Auto-Claim', 'Ticket wird automatisch beansprucht, wenn ein Teammitglied schreibt.')}
  </div>
  <div class="grid g2 mt">
    <div class="card">${panelField('Gleichzeitige Tickets-Limit', 'eMaxTickets', p.maxTicketsPerUser, 'number', '0 = unbegrenzt (Server-Einstellung gilt dann).')}</div>
    <div class="card"><label>Aktion, wenn der Ersteller den Server verlässt</label>
      <select id="eOnLeave">
        <option value="none" ${p.onLeaveAction === 'none' ? 'selected' : ''}>Nichts machen</option>
        <option value="close" ${p.onLeaveAction === 'close' ? 'selected' : ''}>Ticket automatisch schließen</option>
        <option value="info" ${p.onLeaveAction === 'info' ? 'selected' : ''}>Info-Nachricht senden</option>
      </select>
    </div>
  </div>
  <div class="card mt"><label>Format der Ticket-Kanalnamen</label>
    <div class="grid ${FORMAT_OPTS.length === 4 ? '' : ''}" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
      ${FORMAT_OPTS.map((f) => `<label class="fmtOpt" data-fmt="${f.id}">
        <input type="radio" name="fmt" value="${f.id}" ${p.ticketNameFormat === f.id ? 'checked' : ''}>
        <b>${esc(f.label)}</b><p class="muted small">${esc(f.desc)}</p>
      </label>`).join('')}
    </div>
    <div id="eCustomWrap" style="display:${p.ticketNameFormat === 'custom' ? 'block' : 'none'}">
      ${panelField('Eigenes Format', 'eCustomFmt', p.customTicketNameFormat, 'text', 'Platzhalter: %CASEID% %PREFIX% %USERNAME% %USER_ID% %USER_NICK_NAME% %DISPLAY_NAME%')}
    </div>
  </div>
  <div class="row mt"><button class="btn green sm" id="eSaveGeneral">💾 Speichern</button></div>`;
}

function tabEmbeds(p) {
  const pe = p.panelEmbed || {};
  const oe = p.openingEmbed || {};
  const rgb = hexToRgb(p.color);
  return `<div class="grid g2 mt">
    <div class="card"><label>Farbe (Embed)</label>${rgbColorPicker('eColor', rgb)}<p class="muted small">RGB-Auswahl oder Farbe direkt übernehmen.</p></div>
    <div class="card"><p class="muted small"><b>Embed-Editor</b><br>Diese Embeds werden für alle Kategorien in diesem Panel verwendet (in Kategorien optional überschreibbar).</p></div>
  </div>
  <h2>Panel-Embed</h2>
  <div class="card mt"><div class="grid g2">
    ${panelField('Titel', 'peTitle', pe.title || p.name)}
    ${panelField('Bild-URL (optional)', 'peImage', pe.image || '')}
  </div>
  ${panelField('Beschreibung', 'peDesc', pe.description || '', 'textarea')}</div>
  <h2>Eröffnungs-Embed</h2>
  <div class="card mt"><div class="grid g2">
    ${panelField('Titel', 'oeTitle', oe.title || '')}
    ${panelField('Bild-URL (optional)', 'oeImage', oe.image || '')}
  </div>
  ${panelField('Beschreibung', 'oeDesc', oe.description || '', 'textarea')}</div>
  <div class="row mt"><button class="btn green sm" id="eSaveEmbeds">💾 Speichern</button></div>`;
}

function tabCategories(p) {
  const cats = p.categories || [];
  return `<div class="row between mt"><h2 style="margin:0">Kategorien</h2><button class="btn sm" id="eAddCat">＋ Neue Kategorie erstellen</button></div>
  <div id="catList" class="mt">${cats.length ? cats.map((c, i) => catCard(c, i)).join('') : '<p class="muted">Noch keine Kategorien – erstelle die erste.</p>'}</div>
  <div class="row mt"><button class="btn green sm" id="eSaveCats">💾 Kategorien speichern</button></div>`;
}

function catCard(c, i) {
  const oe = c.openingEmbed || {};
  return `<div class="card mt" data-catid="${esc(c.id)}">
    <div class="row between">
      <div class="row"><label class="switch" style="margin:0"><input type="checkbox" class="cat_active" ${c.active !== false ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
        <b>${esc(c.name || 'Kategorie')}</b> <span class="badge ${c.active !== false ? 'open' : 'closed'}">${c.active !== false ? 'aktiv' : 'inaktiv'}</span></div>
      <button class="btn red sm cat_del">🗑️</button>
    </div>
    <div class="grid g2 mt">
      <div>${panelField('Name (Pflicht)', 'cat_name_' + i, c.name)}</div>
      <div>${panelField('Prefix (Pflicht)', 'cat_prefix_' + i, c.prefix, 'text', 'Kurzform für Kanalnamen, z.B. „bug" für „Bug Report"')}</div>
    </div>
    <div class="grid g2 mt">
      <div>${panelField('Emoji', 'cat_emoji_' + i, c.emoji || '')}</div>
      <div><label>Kategorie</label><select class="cat_category"><option value="">— Keine —</option>${state.editor.meta.categories.map((k) => `<option value="${esc(k.id)}" ${c.categoryId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>
    </div>
    <div class="grid g2 mt">
      <div>${panelField('Beschreibung', 'cat_desc_' + i, c.description)}</div>
      <div>${panelField('Auslastung (0 = aus)', 'cat_cap_' + i, c.capacity, 'number', 'Ab 80% wird das Panel gelb, ab 100% rot.')}</div>
    </div>
    <div class="card mt"><label>Rollen (Zugriff auf Tickets dieser Kategorie)</label>
      <select multiple class="cat_roles">${optRoles(c.roles || [])}</select>
      <div class="row wrap mt">
        ${switchLine('cat_onbehalf', c.allowOnBehalf, 'Im Auftrag erlauben')}
        ${switchLine('cat_embedov', c.embedOverride, 'Eröffnungs-Embed überschreiben')}
      </div>
      <div class="ovEmbed" style="display:${c.embedOverride ? 'block' : 'none'}">
        <div class="grid g2 mt">
          <div>${panelField('Titel (Override)', 'cat_ov_title_' + i, oe.title || '')}</div>
          <div>${panelField('Bild-URL', 'cat_ov_img_' + i, oe.image || '')}</div>
        </div>
        <div class="mt">${panelField('Beschreibung', 'cat_ov_desc_' + i, oe.description || '')}</div>
      </div>
    </div>
  </div>`;
}

function tabRating(p) {
  const r = p.rating || {};
  return `<div class="grid g2 mt">
    ${switchRow('eRatingOn', r.enabled, 'Bewertungsmodul aktivieren', 'Nutzer erhalten nach dem Schließen per DM die Frage, wie ihnen der Support gefallen hat.')}
    <div class="card"><p class="muted small"><b>Kanal</b> – interner Rating-Log.<br><b>Öffentlicher Kanal</b> – zusätzlicher öffentlicher Log (optional).</p></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><label>Kanal (interner Rating-Log)</label><select id="eRatingChan">${optTextChannels(r.channelId)}</select></div>
    <div class="card"><label>Kanal für öffentlichen Log</label><select id="eRatingPub">${optTextChannels(r.publicChannelId)}</select></div>
  </div>
  <div class="row mt"><button class="btn green sm" id="eSaveRating">💾 Speichern</button></div>`;
}

function tabAutomation(p) {
  const a = p.automation || {};
  return `<div class="grid g2 mt">
    <div class="card">${panelField('Auto-Close nach X Tagen Inaktivität (0 = aus)', 'eAutoCloseDays', a.autoCloseDays, 'number')}</div>
    <div class="card">${panelField('Auto-Alert nach X Minuten Inaktivität (0 = aus)', 'eAutoAlertMin', a.autoAlertMinutes, 'number', 'Benachrichtigt den Ersteller bei Inaktivität.')}</div>
    <div class="card">${panelField('Auto-Team-Alert nach X Minuten (0 = aus)', 'eAutoTeamMin', a.autoTeamAlertMinutes, 'number', 'Markiert das zuständige Team-Mitglied bei Inaktivität.')}</div>
    <div class="card">${panelField('Auto-Unclaim nach X Minuten (0 = aus)', 'eAutoUnclaimMin', a.autoUnclaimMinutes, 'number')}</div>
  </div>
  <div class="grid g2 mt">
    ${switchRow('eCloseNoResp', a.closeIfNoResponse, 'Ticket schließen, wenn der Ersteller nicht reagiert', 'Nach Auto-Alert wird ohne Antwort automatisch geschlossen.')}
    ${switchRow('eCloseAfterReq', a.closeAfterCloseRequest, 'Direkt schließen nach Close-Request', 'Ticket wird geschlossen, sobald die Close-Request abgeschlossen ist.')}
  </div>
  <div class="row mt"><button class="btn green sm" id="eSaveAutomation">💾 Speichern</button></div>`;
}

function tabLogs(p) {
  const l = p.logs || {};
  return `<div class="grid g2 mt">
    ${switchRow('eLogsOn', l.enabled, 'Ticket-Aktivitäten loggen', 'Alle Ticket-Aktionen werden in den ausgewählten Kanal geloggt.')}
    ${switchRow('eTranscripts', l.transcripts !== false, 'Ticket-Transkripte aktivieren', 'Nach dem Schließen wird ein Transkript gespeichert (im Team Dashboard ansehbar).')}
  </div>
  <div class="card mt"><label>Log-Kanal</label><select id="eLogChan">${optTextChannels(l.channelId)}</select></div>
  <div class="row mt"><button class="btn green sm" id="eSaveLogs">💾 Speichern</button></div>`;
}

function tabClaim(p) {
  const c = p.claimCategory || {};
  return `<div class="grid g2 mt">
    ${switchRow('eClaimOn', c.enabled, 'Claim-Kategorie aktivieren', 'Geclaimte Tickets werden automatisch in eine andere Kategorie verschoben.')}
    <div class="card"><label>Kategorie</label><select id="eClaimCat"><option value="">— Keine —</option>${state.editor.meta.categories.map((k) => `<option value="${esc(k.id)}" ${c.categoryId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>
  </div>
  <div class="row mt"><button class="btn green sm" id="eSaveClaim">💾 Speichern</button></div>`;
}

function tabSend(p) {
  const rgb = hexToRgb(p.color);
  return `<div class="row between mt"><div><h2 style="margin:0">Panel senden</h2><p class="muted small">Sendet das Panel in den ausgewählten Kanal.</p></div></div>
  <div class="card mt" style="max-width:480px">
    <div class="embed-preview" style="border-left:4px solid #${esc(p.color || '5865F2')};padding:14px;border-radius:10px;background:var(--panel2)">
      <b class="small">${esc((p.panelEmbed && p.panelEmbed.title) || p.name || 'Ticket Panel')}</b>
      <p class="small" style="color:var(--muted);margin-top:6px">${esc((p.panelEmbed && p.panelEmbed.description) || '— keine Beschreibung —')}</p>
      <div class="muted small mt" style="color:var(--muted)">${(p.categories || []).map((c) => `${c.emoji || '🎫'} ${esc(c.name)}`.trim()).join(' · ') || '— Kategorien —'}</div>
    </div>
    <div class="row mt between">
      <button class="btn ghost sm" id="eSaveAll">💾 Alle Änderungen speichern</button>
      <button class="btn green sm" id="eSendPanel">📨 Panel senden</button>
    </div>
  </div>`;
}

function valOf(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}
function chkOf(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? el.checked : fallback;
}

function collectPanelFromDom(p) {
  const getPanel = () => state.editor.panel;

  const cats = (getPanel() && getPanel().categories || []);
  const updated = cats.map((c, i) => {
    const n = $(`#cat_name_${i}`);
    if (!n) return c;
    const categoryId = document.querySelectorAll('.cat_category')[i] ? document.querySelectorAll('.cat_category')[i].value : c.categoryId;
    const roles = [...(document.querySelectorAll('.cat_roles')[i] ? document.querySelectorAll('.cat_roles')[i].selectedOptions : [])].map((o) => o.value);
    const active = document.querySelectorAll('.cat_active')[i] ? document.querySelectorAll('.cat_active')[i].checked : c.active !== false;
    const onbehalf = document.querySelectorAll('.cat_onbehalf')[i] ? document.querySelectorAll('.cat_onbehalf')[i].checked : !!c.allowOnBehalf;
    const ov = document.querySelectorAll('.cat_embedov')[i] ? document.querySelectorAll('.cat_embedov')[i].checked : !!c.embedOverride;
    const oe = c.openingEmbed || {};
    return {
      ...c,
      name: n.value, prefix: $(`#cat_prefix_${i}`).value, emoji: $(`#cat_emoji_${i}`).value, description: $(`#cat_desc_${i}`).value,
      categoryId, roles, active, allowOnBehalf: onbehalf, embedOverride: ov,
      capacity: Math.max(0, parseInt($(`#cat_cap_${i}`).value, 10) || 0),
      openingEmbed: { title: valOf(`cat_ov_title_${i}`, oe.title), description: valOf(`cat_ov_desc_${i}`, oe.description), image: valOf(`cat_ov_img_${i}`, oe.image) || null },
    };
  });

  const panelEmbed = {
    title: valOf('peTitle', (p.panelEmbed && p.panelEmbed.title) || p.name),
    description: valOf('peDesc', (p.panelEmbed && p.panelEmbed.description) || ''),
    image: valOf('peImage', (p.panelEmbed && p.panelEmbed.image) || '') || null,
  };
  const openingEmbed = {
    title: valOf('oeTitle', (p.openingEmbed && p.openingEmbed.title) || '') || null,
    description: valOf('oeDesc', (p.openingEmbed && p.openingEmbed.description) || '') || null,
    image: valOf('oeImage', (p.openingEmbed && p.openingEmbed.image) || '') || null,
  };
  const color = document.getElementById('eColor_hex') ? document.getElementById('eColor_hex').value.replace('#', '') : p.color;

  return {
    id: getPanel().id,
    name: valOf('eName', p.name),
    channelId: valOf('eChannel', p.channelId),
    color,
    ticketNameFormat: (document.querySelector('input[name="fmt"]:checked') || {}).value || p.ticketNameFormat || 'PREFIX-USERNAME',
    customTicketNameFormat: valOf('eCustomFmt', p.customTicketNameFormat),
    mentionTeam: chkOf('eMentionTeam', p.mentionTeam),
    closeRestricted: chkOf('eCloseRestricted', p.closeRestricted),
    allowAddUsers: chkOf('eAllowAdd', p.allowAddUsers),
    maxTicketsPerUser: Math.max(0, parseInt(valOf('eMaxTickets', p.maxTicketsPerUser), 10) || 0),
    onLeaveAction: valOf('eOnLeave', p.onLeaveAction),
    panelEmbed, openingEmbed,
    categories: updated,
  };
}

function collectSingleTab(p) {
  const tab = state.editor.tab;
  const body = {};
  if (tab === 'rating') body.rating = { enabled: $('#eRatingOn').checked, channelId: $('#eRatingChan').value || null, publicChannelId: $('#eRatingPub').value || null };
  if (tab === 'automation') body.automation = {
    autoCloseDays: Math.max(0, parseInt($('#eAutoCloseDays').value, 10) || 0),
    autoAlertMinutes: Math.max(0, parseInt($('#eAutoAlertMin').value, 10) || 0),
    autoTeamAlertMinutes: Math.max(0, parseInt($('#eAutoTeamMin').value, 10) || 0),
    autoUnclaimMinutes: Math.max(0, parseInt($('#eAutoUnclaimMin').value, 10) || 0),
    closeIfNoResponse: $('#eCloseNoResp').checked,
    autoClaim: false,
    closeAfterCloseRequest: $('#eCloseAfterReq').checked,
  };
  if (tab === 'logs') body.logs = { enabled: $('#eLogsOn').checked, channelId: $('#eLogChan').value || null, transcripts: $('#eTranscripts').checked };
  if (tab === 'claim') body.claimCategory = { enabled: $('#eClaimOn').checked, categoryId: $('#eClaimCat').value || null };
  if (tab === 'general') {
    Object.assign(body, collectPanelFromDom(p));
  }
  return body;
}

async function saveEditor(body, msg) {
  const ed = state.editor;
  const gv = current().guild.id;
  try {
    if (ed.panel && ed.panel.id) {
      const r = await api(`/api/g/${gv}/panels/${ed.panel.id}/update`, jsonBody({ ...ed.panel, ...body }));
      state.editor.panel = r.panel;
    } else {
      const r = await api(`/api/g/${gv}/panels/create`, jsonBody(body));
      state.editor.panel = r.panel;
    }
    await refreshState();
    toast(msg || '✅ Gespeichert');
    renderPanelEditor();
  } catch (e) { toast(e.message); }
}

function bindEditorEvents(p) {
  // Tabs
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { collectTabState(); state.editor.tab = b.dataset.tab; renderPanelEditor(); })
  );
  const closeBtn = $('#edClose');
  if (closeBtn) closeBtn.addEventListener('click', () => { state.editor.panel = null; renderNavView('panels'); });

  // Allgemeines
  const fmtRadios = document.querySelectorAll('input[name="fmt"]');
  fmtRadios.forEach((r) => r.addEventListener('change', () => {
    $('#eCustomWrap').style.display = r.value === 'custom' ? 'block' : 'none';
    if (r.value === 'custom') state.editor.panel.ticketNameFormat = 'custom';
  }));

  // Embeds: RGB picker sync
  bindRgbPicker('eColor', (hex) => { state.editor.panel.color = hex; });

  // Kategorien
  const addCat = $('#eAddCat');
  if (addCat) addCat.addEventListener('click', () => {
    state.editor.panel.categories = [...(state.editor.panel.categories || []), {
      id: 'cat_' + Math.random().toString(36).slice(2, 9), name: 'Neue Kategorie', prefix: 'neu', emoji: '🎫',
      description: '', categoryId: '', active: true, capacity: 0, roles: [], allowOnBehalf: false, embedOverride: false, openingEmbed: {},
    }];
    renderPanelEditor();
  });
  const catDel = document.querySelectorAll('.cat_del');
  catDel.forEach((b) => {
    const card = b.closest('[data-catid]');
    b.addEventListener('click', () => {
      state.editor.panel.categories = state.editor.panel.categories.filter((c) => c.id !== card.dataset.catid);
      renderPanelEditor();
    });
  });
  const ovToggles = document.querySelectorAll('.cat_embedov');
  ovToggles.forEach((t) => {
    t.addEventListener('change', () => {
      const box = t.closest('.card').querySelector('.ovEmbed');
      if (box) box.style.display = t.checked ? 'block' : 'none';
    });
  });

  // Save buttons
  const saveGeneral = $('#eSaveGeneral');
  if (saveGeneral) saveGeneral.addEventListener('click', () => saveEditor(collectSingleTab(p), '✅ Panel gespeichert'));
  const saveEmbeds = $('#eSaveEmbeds');
  if (saveEmbeds) saveEmbeds.addEventListener('click', () => saveEditor(collectPanelFromDom(p), '✅ Embeds gespeichert'));
  const saveCats = $('#eSaveCats');
  if (saveCats) saveCats.addEventListener('click', () => saveEditor(collectPanelFromDom(p), '✅ Kategorien gespeichert'));
  const saveRating = $('#eSaveRating');
  if (saveRating) saveRating.addEventListener('click', () => saveEditor(collectSingleTab(p), '✅ Bewertung gespeichert'));
  const saveAutomation = $('#eSaveAutomation');
  if (saveAutomation) saveAutomation.addEventListener('click', () => saveEditor(collectSingleTab(p), '✅ Automation gespeichert'));
  const saveLogs = $('#eSaveLogs');
  if (saveLogs) saveLogs.addEventListener('click', () => saveEditor(collectSingleTab(p), '✅ Logs gespeichert'));
  const saveClaim = $('#eSaveClaim');
  if (saveClaim) saveClaim.addEventListener('click', () => saveEditor(collectSingleTab(p), '✅ Claim-Kategorie gespeichert'));
  const saveAll = $('#eSaveAll');
  if (saveAll) saveAll.addEventListener('click', () => saveEditor(collectPanelFromDom(p), '✅ Alle Änderungen gespeichert'));
  const sendPanel = $('#eSendPanel');
  if (sendPanel) sendPanel.addEventListener('click', async () => {
    const ok = await confirmModal('Panel senden?', 'Das Panel wird in den ausgewählten Kanal gesendet.', 'Panel senden');
    if (!ok) return;
    const ed = state.editor;
    try {
      if (!(ed.panel && ed.panel.id)) {
        const r = await api(`/api/g/${gid()}/panels/create`, jsonBody(collectPanelFromDom(p)));
        ed.panel = r.panel;
      } else {
        const r = await api(`/api/g/${gid()}/panels/${ed.panel.id}/update`, jsonBody(collectPanelFromDom(p)));
        ed.panel = r.panel;
      }
      const r = await api(`/api/g/${gid()}/panels/${ed.panel.id}/send`, { method: 'POST' });
      toast('📨 Panel gesendet!');
      await refreshState();
      state.editor.panel = null;
      renderNavView('panels');
    } catch (e) { toast(e.message); }
  });
}

function collectTabState() {
  const t = state.editor.tab;
  const p = state.editor.panel;
  if (!p) return;
  try {
    if (t === 'general') Object.assign(p, collectPanelFromDom(p));
    if (t === 'embeds') Object.assign(p, collectPanelFromDom(p));
    if (t === 'categories') { const c = collectPanelFromDom(p); p.categories = c.categories; }
    if (t === 'rating') Object.assign(p, collectSingleTab(p));
    if (t === 'automation') Object.assign(p, collectSingleTab(p));
    if (t === 'logs') Object.assign(p, collectSingleTab(p));
    if (t === 'claim') Object.assign(p, collectSingleTab(p));
  } catch { /* Dom nicht vollständig */ }
}

function bindRgbPicker(id, onChange) {
  const hexIn = document.getElementById(`${id}_hex`);
  const colorIn = document.getElementById(`${id}_color`);
  const setHex = (hex) => { if (hexIn) hexIn.value = '#' + hex; if (colorIn) colorIn.value = '#' + hex; if (onChange) onChange(hex); };
  ['r', 'g', 'b'].forEach((ch) => {
    const sl = document.getElementById(`${id}_${ch}`);
    const val = document.getElementById(`${id}_${ch}v`);
    if (!sl) return;
    sl.addEventListener('input', () => {
      if (val) val.textContent = sl.value;
      const r = parseInt(document.getElementById(`${id}_r`).value, 10);
      const g = parseInt(document.getElementById(`${id}_g`).value, 10);
      const b = parseInt(document.getElementById(`${id}_b`).value, 10);
      setHex(rgbToHex(r, g, b));
    });
  });
  if (hexIn) hexIn.addEventListener('input', () => {
    let h = hexIn.value.replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(h)) {
      const rgb = hexToRgb(h);
      const r = document.getElementById(`${id}_r`); const g = document.getElementById(`${id}_g`); const b = document.getElementById(`${id}_b`);
      if (r) r.value = rgb.r; if (g) g.value = rgb.g; if (b) b.value = rgb.b;
      const rv = document.getElementById(`${id}_rv`); const gv = document.getElementById(`${id}_gv`); const bv = document.getElementById(`${id}_bv`);
      if (rv) rv.textContent = rgb.r; if (gv) gv.textContent = rgb.g; if (bv) bv.textContent = rgb.b;
      setHex(h.toLowerCase());
    }
  });
  if (colorIn) colorIn.addEventListener('input', () => {
    const h = colorIn.value.replace('#', '');
    const rgb = hexToRgb(h);
    const r = document.getElementById(`${id}_r`); const g = document.getElementById(`${id}_g`); const b = document.getElementById(`${id}_b`);
    if (r) r.value = rgb.r; if (g) g.value = rgb.g; if (b) b.value = rgb.b;
    const rv = document.getElementById(`${id}_rv`); const gv = document.getElementById(`${id}_gv`); const bv = document.getElementById(`${id}_bv`);
    if (rv) rv.textContent = rgb.r; if (gv) gv.textContent = rgb.g; if (bv) bv.textContent = rgb.b;
    setHex(h);
  });
}

// ---------------------------------------------------------------- logs / settings

function renderLogs() {
  const g = current();
  const logs = g.actions;
  main().innerHTML = `
    <div class="hero"><div class="icon">📜</div><div class="t"><h1>Audit-Logs</h1><p class="sub">Alle Ticket-Aktionen im Überblick.</p></div></div>
    <div class="card mt"><table>
      <thead><tr><th>Zeit</th><th>Aktion</th><th>Ticket</th><th>Von</th><th>Details</th></tr></thead>
      <tbody>${logs.length ? logs.map((a) => `
        <tr><td>${fmt(a.at)}</td><td>${esc(a.type)}</td><td>${esc(a.ticketId || '–')}</td><td>${esc(a.actorName || a.actorId || '–')}</td><td class="muted">${esc((a.detail || '').slice(0, 70))}</td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">Noch keine Aktionen.</td></tr>'}</tbody></table></div>`;
}

function renderSettings() {
  const g = current();
  const c = g.config;
  const e = c.embed || {};
  main().innerHTML = `
    <div class="hero"><div class="icon">⚙️</div><div class="t"><h1>Einstellungen</h1><p class="sub">Grundkonfiguration des Ticket-Systems.</p></div></div>
    <div class="grid g2 mt">
      ${field('Sprache', 'language', c.language, 'text')}
      ${field('Support-Rollen (IDs, kommasepariert)', 'supportRoles', (c.supportRoles || []).join(','), 'text')}
      ${field('Manager-Rollen', 'managerRoles', (c.managerRoles || []).join(','), 'text')}
      ${field('Admin-Rollen', 'adminRoles', (c.adminRoles || []).join(','), 'text')}
      ${field('Access-Rollen', 'accessRoles', (c.accessRoles || []).join(','), 'text')}
      ${field('Ping-Rolle (ID)', 'pingRoleId', c.pingRoleId || '', 'text')}
      ${field('Log-Kanal (ID)', 'logChannelId', c.logChannelId || '', 'text')}
      ${field('Transkript-Kanal (ID)', 'transcriptChannelId', c.transcriptChannelId || '', 'text')}
      ${field('Default-Kategorie (ID)', 'defaultCategoryId', c.defaultCategoryId || '', 'text')}
      ${field('Close-Kategorie (ID)', 'closedCategoryId', c.closedCategoryId || '', 'text')}
      ${field('Max Tickets pro User', 'maxTicketsPerUser', c.maxTicketsPerUser, 'number')}
      ${field('Auto-Close nach (Minuten, 0=aus)', 'autoCloseMinutes', c.autoCloseMinutes, 'number')}
      ${field('Auto-Delete nach (Stunden, 0=aus)', 'autoDeleteHours', c.autoDeleteHours, 'number')}
      ${field('Message-Limit Transkript', 'messageLimit', c.messageLimit, 'number')}
      ${fieldSwitch('Feedback aktiv', 'feedbackEnabled', c.feedbackEnabled)}
      ${fieldSwitch('Auto-Transkripte', 'autoTranscripts', c.autoTranscripts)}
    </div>
    <h2>Embed-Anpassung</h2>
    <div class="grid g2 mt">
      ${field('Farbe', 'embedColor', e.color || '#5865F2', 'text')}
      ${field('Author', 'embedAuthor', e.author || '', 'text')}
      ${field('Footer', 'embedFooter', e.footer || '', 'text')}
      ${field('Titel', 'embedTitle', e.title || '', 'text')}
      ${field('Beschreibung', 'embedDescription', e.description || '', 'text')}
      ${field('Thumbnail-URL', 'embedThumbnail', e.thumbnail || '', 'text')}
    </div>
    <button class="btn green mt" id="saveSettings">💾 Speichern</button>`;

  $('#saveSettings').addEventListener('click', async () => {
    const pick = (name) => document.querySelector(`[data-k="${name}"]`);
    const num = (n) => Math.max(0, parseInt(pick(n).value, 10) || 0);
    const list = (n) => pick(n).value.split(',').map((x) => x.trim()).filter(Boolean);
    const body = {
      language: pick('language').value,
      supportRoles: list('supportRoles'), managerRoles: list('managerRoles'), adminRoles: list('adminRoles'), accessRoles: list('accessRoles'),
      pingRoleId: pick('pingRoleId').value || null, logChannelId: pick('logChannelId').value || null, transcriptChannelId: pick('transcriptChannelId').value || null,
      defaultCategoryId: pick('defaultCategoryId').value || null, closedCategoryId: pick('closedCategoryId').value || null,
      maxTicketsPerUser: num('maxTicketsPerUser'), autoCloseMinutes: num('autoCloseMinutes'), autoDeleteHours: num('autoDeleteHours'), messageLimit: num('messageLimit'),
      feedbackEnabled: pick('feedbackEnabled').checked, autoTranscripts: pick('autoTranscripts').checked,
      embed: { color: pick('embedColor').value, author: pick('embedAuthor').value, footer: pick('embedFooter').value, title: pick('embedTitle').value, description: pick('embedDescription').value, thumbnail: pick('embedThumbnail').value },
    };
    try {
      await api(`/api/g/${current().guild.id}/settings`, jsonBody(body));
      toast('✅ Einstellungen gespeichert');
      await refreshState();
    } catch (e) { toast(e.message); }
  });
}

function field(label, key, value, type) {
  return `<div class="card"><label>${label}</label><input class="mt" type="${type}" data-k="${key}" value="${esc(value)}"></div>`;
}
function fieldSwitch(label, key, value) {
  return `<div class="card"><label>${label}</label>
    <div class="row mt">
      <label class="switch" style="margin:0">
        <input type="checkbox" data-k="${key}" ${value ? 'checked' : ''}><span class="track"></span><span class="knob"></span>
      </label>
      <span class="muted small">${value ? 'aktiv' : 'inaktiv'}</span>
    </div></div>`;
}

// ---------------------------------------------------------------- generic module renderer

async function renderModule(name, builder) {
  const gv = gid();
  const d = await api(`/api/g/${gv}/module/${name}`);
  builder(gv, d);
}

function selectHtml(id, options, value, placeholder = '— nicht gesetzt —', multiple = false) {
  const opts = [`<option value="">${esc(placeholder)}</option>`, ...options.map((o) => `<option value="${esc(o.id)}" ${String(value || '') === String(o.id) ? 'selected' : ''}>${esc(o.name)}</option>`)];
  return `<select id="${id}" ${multiple ? 'multiple' : ''}>${opts.join('')}</select>`;
}
function chans(meta) {
  return (meta.channels || []).map((c) => ({ id: c.id, name: `#${c.name}` }));
}
function roles(meta) {
  return (meta.roles || []).map((r) => ({ id: r.id, name: `@${r.name}` }));
}
async function saveModuleConfig(gv, name, body, extraMsg) {
  try {
    await api(`/api/g/${gv}/module/${name}`, jsonBody(body));
    toast('✅ Gespeichert');
    await refreshState();
    renderModule(name, UI_BUILDERS[name]);
    if (extraMsg) toast(extraMsg);
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- modules UI

const UI_BUILDERS = {};

function viewNews(gv, d) {
  const c = d.config;
  main().innerHTML = `
    <div class="row between wrap">
      <div class="hero"><div class="icon">📰</div><div class="t"><h1>News</h1><p class="sub">Kanal, Benachrichtigungsrolle und Erstellen von News-Embeds.</p></div></div>
      <label class="switch" style="margin:0"><input type="checkbox" id="newsEnabled" ${c.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>News-Kanal</label>${selectHtml('newsChannel', chans(d.meta), c.channelId)}</div>
      <div class="card"><label>Benachrichtigungs-Rolle (/news subscribe)</label>${selectHtml('newsRole', roles(d.meta), c.roleId)}</div>
    </div>
    <h2>Neue News veröffentlichen</h2>
    <div class="card mt">
      <div class="grid g2">
        <div><label>Titel</label><input id="nTitle" placeholder="🎉 Update angekündigt"></div>
        <div><label>Großes Bild (URL, optional)</label><input id="nImage" placeholder="https://…"></div>
      </div>
      <label>Nachricht</label><textarea id="nMessage" placeholder="Schreibe hier die News…"></textarea>
      <div class="row mt"><button class="btn green sm" id="nPost">📤 Veröffentlichen</button></div>
    </div>
    <div class="row mt"><button class="btn ghost sm" id="nSave">💾 Kanal/Rolle speichern</button></div>`;
  $('#nSave').addEventListener('click', () => saveModuleConfig(gv, 'news', { channelId: $('#newsChannel').value || null, roleId: $('#newsRole').value || null, enabled: $('#newsEnabled').checked }));
  $('#nPost').addEventListener('click', async () => {
    try {
      await api(`/api/g/${gv}/news/post`, jsonBody({ title: $('#nTitle').value, message: $('#nMessage').value, image: $('#nImage').value }));
      toast('📰 News veröffentlicht');
      $('#nMessage').value = '';
    } catch (e) { toast(e.message); }
  });
}

function viewSuggestions(gv, d) {
  const c = d.config;
  const sugs = d.suggestions || [];
  const open = sugs.filter((s) => s.status === 'pending');
  const done = sugs.filter((s) => s.status !== 'pending');
  main().innerHTML = `
    <div class="row between wrap">
      <div class="hero"><div class="icon">💡</div><div class="t"><h1>Vorschläge</h1><p class="sub">Kategorien, Abstimmung, Annahme &amp; Ablehnung von Vorschlägen.</p></div></div>
      ${c.requireApproval ? `<span class="badge pending">🔎 Prüfung aktiv</span>` : ''}
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Vorschlags-Kanal</label>${selectHtml('sgChannel', chans(d.meta), c.channelId)}</div>
      <div class="card"><label>Prüf-Kanal (optional)</label>${selectHtml('sgReview', chans(d.meta), c.reviewChannelId)}</div>
      <div class="card"><label>Team-Rolle (darf annehmen/ablehnen)</label>${selectHtml('sgTeam', roles(d.meta), (c.teamRoles || [])[0])}</div>
      <div class="card"><label>Kategorien (eine pro Zeile: Name = Emoji)</label><textarea id="sgCats">${esc((c.categories || []).map((x) => `${x.name} = ${x.emoji || '💡'}`).join('\n'))}</textarea></div>
    </div>
    <div class="grid g2 mt">
      <div class="card">${fieldSwitchNoL('Erst prüfen', 'sgApproval', c.requireApproval, 'Neue Vorschläge müssen zuerst geprüft werden')}</div>
      <div class="card">${fieldSwitchNoL('DM bei Entscheidung', 'sgDm', c.dmOnDecide, 'Benachrichtige den Autor per DM')}</div>
    </div>
    <h2>Offene Vorschläge (${open.length})</h2>
    <div class="card mt">${open.length ? open.map(sgRow).join('') : '<p class="muted">Keine offenen Vorschläge.</p>'}</div>
    ${done.length ? `<h2>Entschieden (${done.length})</h2><div class="card mt">${done.slice(0, 15).map(sgRowClosed).join('')}</div>` : ''}
    <div class="row mt"><button class="btn ghost sm" id="sgSave">💾 Konfiguration speichern</button></div>`;
  $('#sgSave').addEventListener('click', () => {
    const cats = $('#sgCats').value.split('\n').map((l) => l.trim().split(/\s*=\s*/)).filter((x) => x && x[0]).map(([name, emoji]) => ({ name, emoji: emoji || '💡', description: '', active: true }));
    saveModuleConfig(gv, 'suggestions', { channelId: $('#sgChannel').value || null, reviewChannelId: $('#sgReview').value || null, teamRoles: $('#sgTeam').value ? [$('#sgTeam').value] : [], categories: cats, requireApproval: $('#sgApprovalCheck').checked, dmOnDecide: $('#sgDmCheck').checked });
  });
  document.querySelectorAll('[data-sdec]').forEach((b) =>
    b.addEventListener('click', async () => {
      const sid = b.dataset.sid;
      const decision = b.dataset.sdec;
      let reason;
      if (decision === 'decline') {
        const r = await promptModal('Vorschlag ablehnen', 'Ablehnungsgrund (optional):');
        if (r === null) return;
        reason = r;
      }
      try {
        await api(`/api/g/${gv}/suggestions/${sid}/decide`, jsonBody({ decision, reason }));
        toast('✅ Entscheidung gespeichert');
        renderModule('suggestions', UI_BUILDERS.suggestions);
      } catch (e) { toast(e.message); }
    })
  );
}

function sgRow(s) {
  return `<div class="card" style="margin-bottom:10px;padding:14px">
    <div class="row between wrap">
      <div><b>${esc(s.categoryEmoji)} ${esc(s.category)} #${s.seq}</b> <span class="badge pending">${esc(s.status)}</span>
        <p class="small muted mt">${esc(s.idea)}</p>
        <p class="small muted">von ${esc(s.authorTag)} · ${s.up} 👍 / ${s.down} 👎</p>
      </div>
      <div class="row"><button class="btn green sm" data-sdec="accept" data-sid="${esc(s.id)}">✅ Annehmen</button><button class="btn red sm" data-sdec="decline" data-sid="${esc(s.id)}">❌ Ablehnen</button></div>
    </div></div>`;
}
function sgRowClosed(s) {
  return `<div class="card" style="margin-bottom:10px;padding:12px">
    <div class="row between wrap"><div>
      <span class="badge ${s.status}">${s.status === 'accepted' ? '✅ angenommen' : '❌ abgelehnt'}</span> <b>#${s.seq} ${esc(s.category)}</b> ${s.up}👍/${s.down}👎
      <p class="small muted mt">${esc(s.idea)}</p>
    </div><button class="btn ghost sm" data-sdec="reset" data-sid="${esc(s.id)}">🔄 Stimmen zurücksetzen</button></div></div>`;
}

function fieldSwitchNoL(label, id, value, hint) {
  return `<b class="small">${label}</b><p class="muted small">${hint}</p>
    <div class="row mt"><label class="switch" style="margin:0"><input type="checkbox" id="${id}Check" ${value ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label></div>`;
}

function viewModeration(gv, d) {
  const c = d.config;
  const cases = d.cases || [];
  main().innerHTML = `
    <div class="row between wrap">
      <div class="hero"><div class="icon">🛡️</div><div class="t"><h1>Moderation</h1><p class="sub">Modlog-Kanal, Warnlimit und automatische Aktionen.</p></div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Modlog-Kanal</label>${selectHtml('mwLog', chans(d.meta), c.modlogChannelId)}</div>
      <div class="card"><label>Moderator-Rolle (optional)</label>${selectHtml('mwRoles', roles(d.meta), (c.modRoles || [])[0])}</div>
      <div class="card"><label>Warnlimit (0 = aus)</label><input id="mwLimit" type="number" min="0" value="${c.warnLimit || 0}"></div>
      <div class="card"><label>Aktion bei Warnlimit</label><select id="mwAction"><option value="mute" ${c.warnAction === 'mute' ? 'selected' : ''}>Auto-Mute</option><option value="kick" ${c.warnAction === 'kick' ? 'selected' : ''}>Auto-Kick</option><option value="ban" ${c.warnAction === 'ban' ? 'selected' : ''}>Auto-Ban</option></select></div>
    </div>
    <div class="grid g2 mt">
      <div class="card">${fieldSwitchNoL('DM bei Aktionen', 'mwDm', c.dmOnAction, 'Benutzer per DM über Mod-Aktionen informieren')}</div>
      <div class="card"><label>Ignorierte Rollen (IDs, kommasepariert)</label><input id="mwIgnore" value="${esc((c.ignoreRoles || []).join(','))}"></div>
    </div>
    <div class="row mt"><button class="btn ghost sm" id="mwSave">💾 Speichern</button></div>
    <h2>Moderationsfälle (${cases.length})</h2>
    <div class="card mt"><table>
      <thead><tr><th>Case</th><th>Systemdaten</th><th>Grund</th><th>Zeit</th></tr></thead>
      <tbody>${cases.slice(0, 50).map((c2) => `<tr>
        <td><b>${esc(c2.id)}</b> ${esc(c2.type)}</td>
        <td>${c2.userTag ? esc(c2.userTag) : esc(c2.userId || '–')}</td>
        <td class="muted">${esc((c2.reason || '').slice(0, 60))}</td>
        <td>${fmt(c2.at)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Noch keine Fälle.</td></tr>'}</tbody></table></div>`;
  $('#mwSave').addEventListener('click', () => saveModuleConfig(gv, 'moderation', {
    modlogChannelId: $('#mwLog').value || null,
    modRoles: $('#mwRoles').value ? [$('#mwRoles').value] : [],
    warnLimit: Math.max(0, parseInt($('#mwLimit').value, 10) || 0),
    warnAction: $('#mwAction').value,
    dmOnAction: $('#mwDmCheck').checked,
    ignoreRoles: $('#mwIgnore').value.split(',').map((x) => x.trim()).filter(Boolean),
  }));
}

async function viewWelcome(gv, d) {
  d = d || {};
  const w = d.config;
  let f = { channelId: null, message: '{user} hat den Server verlassen. 👋' };
  try {
    const fd = await api(`/api/g/${gv}/module/farewell`);
    f = fd.config || f;
  } catch { /* ignore */ }
  main().innerHTML = `
    <div class="row between wrap">
      <div class="hero"><div class="icon">👋</div><div class="t"><h1>Welcome &amp; Leave</h1><p class="sub">Begrüßung neuer Mitglieder, Auto-Rollen und Abschiedsnachrichten.</p></div></div>
      <label class="switch" style="margin:0"><input type="checkbox" id="wEnabled" ${w.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Willkommens-Kanal</label>${selectHtml('wChannel', chans(d.meta), w.channelId)}</div>
      <div class="card"><label>Abschieds-Kanal</label>${selectHtml('fChannel', chans(d.meta), f.channelId)}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Willkommens-Nachricht (Platzhalter {user} {tag} {name})</label><textarea id="wMsg">${esc(w.message || '')}</textarea></div>
      <div class="card"><label>Abschieds-Nachricht</label><textarea id="fMsg">${esc(f.message || '{user} hat den Server verlassen. 👋')}</textarea></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Auto-Rollen (eine ID pro Zeile)</label><textarea id="wRoles">${esc((w.autoRoles || []).join('\n'))}</textarea></div>
      <div class="card">${fieldSwitchNoL('Willkommens-DM', 'wDm', w.dmEnabled, 'Neue Mitglieder erhalten eine private Begrüßung')
        }<div class="mt"><label>DM-Text</label><textarea id="wDmMsg">${esc(w.dmMessage || '')}</textarea></div></div>
    </div>
    <div class="row mt"><button class="btn ghost sm" id="wSave">💾 Speichern</button></div>`;
  $('#wSave').addEventListener('click', () => {
    saveModuleConfig(gv, 'welcome', {
      enabled: $('#wEnabled').checked, channelId: $('#wChannel').value || null, message: $('#wMsg').value,
      autoRoles: $('#wRoles').value.split('\n').map((x) => x.trim()).filter(Boolean),
      dmEnabled: $('#wDmCheck').checked, dmMessage: $('#wDmMsg').value,
    });
    saveModuleConfig(gv, 'farewell', { channelId: $('#fChannel').value || null, message: $('#fMsg').value });
    toast('✅ Willkommen/Abschied gespeichert');
  });
}

function viewStats(gv, d) {
  const c = d.config;
  main().innerHTML = `
    <div class="hero"><div class="icon">📈</div><div class="t"><h1>Server Stats</h1><p class="sub">Automatische Statistik-Voice-Kanäle (Mitglieder, Online, Boosts, Voice).</p></div></div>
    <div class="grid g2 mt">
      <div class="card"><label>Präfix für Kanalnamen</label><input id="sPrefix" value="${esc(c.prefix || '📊')}"></div>
      <div class="card"><label>Aktive Statistik-Kanäle</label><p class="mt small muted">${(d.channels || []).map((x) => esc(x.kind)).join(', ') || '— noch keine —'}</p></div>
    </div>
    <div class="card mt">
      <label>Statistik-Kanäle erstellen (können gelöscht werden)</label>
      <div class="row wrap">
        ${['👥', '🟢', '⚡', '🎧'].map((k) => `${switchLine('sKind', k === '👥', k === '👥' ? 'Mitglieder' : k === '🟢' ? 'Online' : k === '⚡' ? 'Boosts' : 'Im Voice', 'sKindLine', k)}`).join('')}
      </div>
      <div class="row mt"><button class="btn green sm" id="sSetup">⚙️ Statistik-Kanäle einrichten</button></div>
    </div>`;
  $('#sSetup').addEventListener('click', async () => {
    const kinds = [...document.querySelectorAll('.sKind:checked')].map((x) => x.value);
    try {
      const r = await api(`/api/g/${gv}/stats/setup`, jsonBody({ kinds, prefix: $('#sPrefix').value || '📊' }));
      toast(`✅ ${r.created.length} Statistik-Kanäle erstellt`);
      renderModule('stats', UI_BUILDERS.stats);
    } catch (e) { toast(e.message); }
  });
}

function viewPrivateVoice(gv, d) {
  const c = d.config || {};
  const cats = (d.meta.categories || []).map((x) => ({ id: x.id, name: `📁 ${x.name}` }));
  const vcs = (d.meta.voiceChannels || []);
  const vcOpts = vcs.map((x) => ({ id: x.id, name: `🎤 ${x.name}` }));
  const nameRadio = (id, val, label, desc) => `<label class="fmtOpt" data-fmt="${id}" style="margin-bottom:8px">
    <input type="radio" name="pvName" value="${id}" ${c.nameMode === id ? 'checked' : ''}>
    <b>${label}</b><p class="muted small">${desc}</p></label>`;
  const waitRadio = (id, val, label, desc) => `<label class="fmtOpt" data-fmt="${id}" style="margin-bottom:8px">
    <input type="radio" name="pvWait" value="${id}" ${c.waitMode === id ? 'checked' : ''}>
    <b>${label}</b><p class="muted small">${desc}</p></label>`;
  main().innerHTML = `
    <div class="hero"><div class="icon">🎤</div><div class="t">
      <h1>Private Kanäle</h1>
      <p class="sub">Jedes Mitglied kann sich einen eigenen Sprachkanal erstellen – einfach in den Start-Kanal gehen.</p>
    </div></div>
    <div class="card"><p class="small muted" style="margin:0"><b>So funktioniert es:</b> Wer den <b>Start-Kanal</b> (Lobby) betritt, bekommt automatisch einen eigenen Sprachkanal. Verlässt er den Kanal, wird er wieder gelöscht. Der Besitzer kann seinen Kanal verwalten (umbenennen, Limit, sperren, …).</p></div>
    <div class="grid g2 mt">
      <div class="card"><label>Start-Kanal (Lobby)</label>${selectHtml('pvLobby', vcOpts, c.lobbyChannelId, '— Kanal wählen —')}</div>
      <div class="card"><label>Kategorie (wo neue Kanäle entstehen)</label>${selectHtml('pvCat', cats, c.categoryId, '— wie Lobby —')}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>Name neuer Kanäle – mit was?</label>
        ${nameRadio('USERNAME', 'USERNAME', 'Benutzername', 'z.B. „pluto"')}
        ${nameRadio('USER_GLOBAL_NAME', 'USER_GLOBAL_NAME', 'Anzeigename', 'z.B. „Pluto" (Nickname bevorzugt)')}
        ${nameRadio('custom', 'custom', 'Eigenes Format', 'mit %USERNAME% / %USER_ID% / %USER_GLOBAL_NAME% / %DISPLAY_NAME%')}
        <div id="pvCustomWrap" style="display:${c.nameMode === 'custom' ? 'block' : 'none'}"><input id="pvCustomName" value="${esc(c.customName || '🔊 | %USERNAME%')}"></div>
      </div>
      <div class="card"><label>Kanal-Qualität (Bitrate)</label>
        <div class="row"><input type="range" id="pvBitrate" min="8" max="384" step="8" value="${Number(c.bitrate) || 64}" style="flex:1"><b id="pvBitrateV" class="muted" style="width:70px;text-align:right">${Number(c.bitrate) || 64} kbps</b></div>
        <p class="muted small">Weniger = stabiler für alle. 64 ist der Standard, höher klingt besser, braucht aber mehr Internet.</p>
      </div>
    </div>
    <h2>Warteraum-Kanal (wenn der Kanal gesperrt ist, optional)</h2>
    <div class="card mt">
      <p class="muted small">Ein gesperrter privater Kanal kann später einen „Warteraum" bekommen, in dem Gäste warten, bis der Besitzer sie reinlässt. Hier legst du den Namen fest:</p>
      <div class="grid g2">
        ${waitRadio('JOIN_USERNAME', 'JOIN_USERNAME', '⏳ Join %USERNAME%', 'z.B. „⏳ Join pluto"')}
        ${waitRadio('JOIN_USER_GLOBAL_NAME', 'JOIN_USER_GLOBAL_NAME', '⏳ Join %USER_GLOBAL_NAME%', 'z.B. „⏳ Join Pluto"')}
        ${waitRadio('custom', 'custom', 'Eigenes Format', 'mit denselben Platzhaltern')}
      </div>
      <div id="pvWaitWrap" style="display:${c.waitMode === 'custom' ? 'block' : 'none'}"><input id="pvCustomWait" value="${esc(c.customWaitName || '⏳ | Join %USERNAME%')}"></div>
    </div>
    <div class="row mt"><button class="btn green sm" id="pvSave">💾 Speichern und aktivieren</button></div>`;

  document.querySelectorAll('input[name="pvName"]').forEach((r) => r.addEventListener('change', () => {
    $('#pvCustomWrap').style.display = r.value === 'custom' ? 'block' : 'none';
  }));
  document.querySelectorAll('input[name="pvWait"]').forEach((r) => r.addEventListener('change', () => {
    $('#pvWaitWrap').style.display = r.value === 'custom' ? 'block' : 'none';
  }));
  const br = $('#pvBitrate');
  br.addEventListener('input', () => { $('#pvBitrateV').textContent = br.value + ' kbps'; });
  $('#pvSave').addEventListener('click', () => {
    saveModuleConfig(gv, 'privatevoice', {
      enabled: true,
      lobbyChannelId: $('#pvLobby').value || null,
      categoryId: $('#pvCat').value || null,
      nameMode: (document.querySelector('input[name="pvName"]:checked') || {}).value || 'USERNAME',
      customName: $('#pvCustomName').value || '🔊 | %USERNAME%',
      waitMode: (document.querySelector('input[name="pvWait"]:checked') || {}).value || 'JOIN_USERNAME',
      customWaitName: $('#pvCustomWait').value || '⏳ | Join %USERNAME%',
      bitrate: parseInt(br.value, 10) || 64,
    });
  });
}

function viewSupport(gv, d) {
  const c = d.config || {};
  const rooms = c.rooms || [];
  const vcs = (d.meta.voiceChannels || []);
  const texts = (d.meta.textChannels || [d.meta.channels || []].flat()).filter((x) => x && x.type !== 2);
  const allRoles = d.meta.roles || [];
  const vcOpts = vcs.map((x) => ({ id: x.id, name: `🎤 ${x.name}` }));
  const textOpts = texts.map((x) => ({ id: x.id, name: `#${x.name}` }));
  const roleOpts = allRoles.map((r) => ({ id: r.id, name: `@${r.name}` }));
  main().innerHTML = `
    <div class="hero"><div class="icon">🎧</div><div class="t">
      <h1>Voice-Support</h1>
      <p class="sub">Deine Mitglieder warten in einem Sprachkanal und bekommen Hilfe. Du legst fest, wer benachrichtigt wird.</p>
    </div></div>
    <div class="card"><p class="small muted" style="margin:0"><b>So funktioniert es:</b> Ein Mitglied betritt den <b>Warteraum</b> (Sprachkanal). Dann wird im <b>Benachrichtigungs-Kanal</b> eine Nachricht mit Knopf „Fall übernehmen“ gepostet und deine <b>Team-Rolle</b> gemeldet. Wer übernimmt, spricht mit dem Mitglied in seinem Sprachkanal.</p></div>
    <div class="row between wrap mt">
      <h2 style="margin:0">Warteräume</h2>
      <button class="btn sm" id="spNew">＋ Warteraum erstellen</button>
    </div>
    <div id="spRooms" class="mt"></div>
    <button class="btn ghost sm mt" id="spSave">💾 Speichern</button>`;

  $('#spRooms').innerHTML = rooms.length
    ? rooms.map((r, i) => `
      <div class="card mt" data-room="${esc(r.id)}">
        <div class="row between">
          <div class="row"><label class="switch" style="margin:0"><input type="checkbox" class="sp_on" ${r.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
            <b>${esc(r.name || 'Warteraum')}</b></div>
          <button class="btn red sm sp_del">🗑️</button>
        </div>
        <div class="grid g2 mt">
          <div><label>Name des Warteraums</label><input class="sp_name" value="${esc(r.name || '')}"></div>
          <div><label>Anzeige-Präfix (für Support-Kanal, optional)</label><input class="sp_prefix" value="${esc(r.prefix || '')}" placeholder="z.B. Support"></div>
        </div>
        <div class="grid g2 mt">
          <div><label>Warteraum (Sprachkanal – wer dort reinkommt, braucht Hilfe)</label>${selectHtml('spWait' + i, vcOpts, r.waitingChannelId)}</div>
          <div><label>Benachrichtigungs-Kanal</label>${selectHtml('spNotif' + i, textOpts, r.notifyChannelId)}</div>
        </div>
        <div class="card mt"><label>Team-Rolle (wird bei neuen Anfragen gemeldet)</label>${selectHtml('spTeam' + i, roleOpts, r.teamRoleId)}</div>
      </div>`).join('')
    : '<p class="muted">Noch keine Warteräume. Klicke auf „Warteraum erstellen“.';

  $('#spNew').addEventListener('click', () => {
    rooms.push({ id: 'room_' + Math.random().toString(36).slice(2, 9), name: 'Neuer Warteraum', enabled: true, waitingChannelId: null, notifyChannelId: null, teamRoleId: null, prefix: '', times: [] });
    viewSupport(gv, d);
  });
  document.querySelectorAll('.sp_del').forEach((b) => {
    const id = b.closest('[data-room]').dataset.room;
    b.addEventListener('click', () => {
      c.rooms = rooms.filter((r) => r.id !== id);
      viewSupport(gv, d);
    });
  });
  document.querySelectorAll('.sp_on').forEach((t, idx) => { t.dataset.idx = idx; });

  $('#spSave').addEventListener('click', () => {
    rooms.forEach((r, i) => {
      const selWait = $(`#spWait${i}`); const selNotif = $(`#spNotif${i}`); const selTeam = $(`#spTeam${i}`);
      r.waitingChannelId = selWait ? selWait.value || null : r.waitingChannelId;
      r.notifyChannelId = selNotif ? selNotif.value || null : r.notifyChannelId;
      r.teamRoleId = selTeam ? selTeam.value || null : r.teamRoleId;
      const nameIn = document.querySelectorAll('.sp_name')[i]; if (nameIn) r.name = nameIn.value || r.name;
      const prefIn = document.querySelectorAll('.sp_prefix')[i]; if (prefIn) r.prefix = prefIn.value || '';
      const onIn = document.querySelectorAll('.sp_on')[i]; if (onIn) r.enabled = onIn.checked;
    });
    saveModuleConfig(gv, 'support', { enabled: true, rooms });
  });
}

function viewProtection(gv, d) {
  const c = d.config;
  main().innerHTML = `
    <div class="hero"><div class="icon">🔐</div><div class="t"><h1>Guild Protection</h1><p class="sub">Captcha-Verifizierung für neue Mitglieder (DM + Rolle).</p></div></div>
    <div class="grid g2 mt">
      <div class="card"><label>Verifizierungs-Rolle</label>${selectHtml('pvRole', roles(d.meta), c.verifiedRoleId)}</div>
      <div class="card"><label>Fallback-Kanal (falls DM blockiert)</label>${selectHtml('pvChannel', chans(d.meta), c.verifyChannelId)}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card">${fieldSwitchNoL('Captcha-Verifizierung', 'pvOn', c.enabled, 'Neue Mitglieder müssen einen Code aus ihrer DM bestätigen')}</div>
      <div class="card"><p class="small muted"><b>So funktioniert es:</b> Beim Beitritt erhält der User eine DM mit 6-stelligem Code und Button. Nach Bestätigung bekommt er die Verifizierungs-Rolle. Falls DMs blockiert sind, erscheint der Code im Fallback-Kanal und der User nutzt <code>/verify</code>.</p></div>
    </div>
    <div class="row mt"><button class="btn ghost sm" id="pvSave">💾 Speichern</button></div>`;
  $('#pvSave').addEventListener('click', () => saveModuleConfig(gv, 'protection', {
    enabled: $('#pvOnCheck').checked, verifiedRoleId: $('#pvRole').value || null, verifyChannelId: $('#pvChannel').value || null,
  }));
}

function viewActivity(gv, d) {
  const c = d.config;
  const counts = d.counts || {};
  main().innerHTML = `
    <div class="hero"><div class="icon">🏅</div><div class="t"><h1>Activity Rewards</h1><p class="sub">Automatische Rollen für Aktivität (Nachrichten-Meilensteine).</p></div></div>
    <div class="grid g2 mt">
      <div class="card">${fieldSwitchNoL('Aktivitätsbelohnungen', 'aOn', c.enabled, 'Roll-Belohnungen aktivieren')}</div>
      <div class="card"><label>Belohnungen (eine pro Zeile: Nachrichten = Rollen-ID)</label><textarea id="aRewards">${esc((c.rewards || []).map((r) => `${r.messages} = ${r.roleId}`).join('\n'))}</textarea></div>
    </div>
    <div class="row mt"><button class="btn ghost sm" id="aSave">💾 Speichern</button></div>
    <h2>Gemessene Aktivität (Top 20)</h2>
    <div class="card mt"><table><thead><tr><th>User-ID</th><th>Nachrichten</th></tr></thead>
      <tbody>${Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([u, n]) => `<tr><td><code>${esc(u)}</code></td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Noch keine Daten.</td></tr>'}</tbody></table></div>`;
  $('#aSave').addEventListener('click', () => {
    const rewards = $('#aRewards').value.split('\n').map((l) => l.trim().split(/\s*=\s*/)).filter((x) => x && x[1]).map(([messages, roleId]) => ({ messages: Math.max(1, parseInt(messages, 10) || 1), roleId: (roleId.match(/\d{15,20}/) || [roleId])[0] }));
    saveModuleConfig(gv, 'activity', { enabled: $('#aOnCheck').checked, rewards });
  });
}

function viewLevels(gv, d) {
  const c = d.config || {};
  const rewards = c.rewards || [];
  const top = d.leaderboard || [];
  const textCh = (d.meta.textChannels || []).map((x) => ({ id: x.id, name: `#${x.name}` }));
  const roleOpts = (d.meta.roles || []).map((r) => ({ id: r.id, name: `@${r.name}` }));
  const rankIcon = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}.`);
  const pct = (rec) => {
    const level = Math.floor(Math.sqrt(rec.xp / 25));
    const into = rec.xp - level * level * 25;
    const next = (level + 1) * (level + 1) * 25 - level * level * 25;
    return { level, pct: next > 0 ? Math.min(100, Math.round((into / next) * 100)) : 0 };
  };
  main().innerHTML = `
    <div class="hero"><div class="icon">🏆</div><div class="t">
      <h1>Level-System</h1>
      <p class="sub">Deine Mitglieder sammeln XP für Nachrichten und Sprachzeit – mit Rollen-Belohnungen und Rangliste.</p>
    </div></div>
    <div class="card"><p class="small muted" style="margin:0"><b>So funktioniert es:</b> 1 Nachricht = <b>${c.textXp ?? 1} XP</b> (mit Cooldown), pro Stunde im Sprachkanal = <b>${c.voiceXp ?? 50} XP</b>. Mit <code>/level</code> verwalten Admins das System, mit <code>/rank</code> &amp; <code>/leaderboard</code> sehen Mitglieder ihren Stand.</p></div>
    <div class="grid g2 mt">
      <div class="card">${fieldSwitchNoL('Level-System aktivieren', 'lvOn', c.enabled, 'XP für Nachrichten und Sprachzeit wird gesammelt')}</div>
      <div class="card"><label>Kanal für Level-Up-Nachrichten</label>${selectHtml('lvChan', textCh, c.announceChannelId, '— aus —')}<p class="muted small">Wenn ein Mitglied ein Level schafft, wird es hier verkündet.</p></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><label>XP pro Nachricht</label><input id="lvTextXp" type="number" min="1" value="${c.textXp ?? 1}"><p class="muted small">Cooldown verhindert Spammen.</p></div>
      <div class="card"><label>Cooldown (Sekunden)</label><input id="lvCooldown" type="number" min="1" value="${c.cooldownSeconds ?? 30}"></div>
    </div>
    <div class="card mt"><label>XP pro Stunde im Sprachkanal</label>
      <div class="row"><input type="range" id="lvVoiceXp" min="10" max="200" step="5" value="${c.voiceXp ?? 50}" style="flex:1"><b id="lvVoiceXpV" class="muted" style="width:70px;text-align:right">${c.voiceXp ?? 50}</b></div>
    </div>
    <h2>Level-Rollen (Belohnungen)</h2>
    <div class="card mt">
      <div id="lvRewards">${rewards.length
        ? rewards.sort((a, b) => a.level - b.level).map((r, i) => `
          <div class="row between wrap" data-lvr="${esc(r.id || i)}" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <b>Level ${r.level}</b><span><@${r.roleId}> → <code>${esc(r.roleId)}</code></span>
            <button class="btn red sm lv_reward_rm" data-level="${r.level}">✕</button>
          </div>`).join('')
        : '<p class="muted">Noch keine Level-Rollen. Füge unten eine hinzu.</p>'}</div>
      <div class="row wrap mt">
        <input id="lvRewLevel" type="number" min="1" placeholder="Level" style="max-width:110px">
        ${selectHtml('lvRewRole', roleOpts, '', '— Rolle wählen —')}
        <button class="btn green sm" id="lvRewAdd">＋ Rolle hinzufügen</button>
      </div>
    </div>
    <h2>Rangliste (Top 10)</h2>
    <div class="card mt"><table><thead><tr><th>#</th><th>Mitglied</th><th>Level</th><th>Fortschritt</th><th>XP</th></tr></thead>
      <tbody>${top.map((x) => {
        const p = pct(x);
        return `<tr><td>${rankIcon(x.rank)}</td><td><code>${esc(x.userId)}</code></td><td>${p.level}</td><td>${p.pct}%</td><td>${x.xp}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">Noch keine erfasste Aktivität.</td></tr>'}</tbody></table></div>
    <div class="row mt"><button class="btn ghost sm" id="lvSave">💾 Speichern</button></div>`;

  const vx = $('#lvVoiceXp');
  vx.addEventListener('input', () => { $('#lvVoiceXpV').textContent = vx.value; });
  $('#lvRewAdd').addEventListener('click', () => {
    const level = Math.max(1, parseInt($('#lvRewLevel').value, 10) || 1);
    const roleId = $('#lvRewRole').value;
    if (!roleId) return toast('Bitte eine Rolle wählen.');
    c.rewards = [...(c.rewards || []).filter((r) => r.level !== level), { level, roleId }];
    viewLevels(gv, d);
  });
  document.querySelectorAll('.lv_reward_rm').forEach((b) => b.addEventListener('click', () => {
    const level = Number(b.dataset.level);
    c.rewards = (c.rewards || []).filter((r) => r.level !== level);
    viewLevels(gv, d);
  }));
  $('#lvSave').addEventListener('click', () => {
    saveModuleConfig(gv, 'levels', {
      enabled: $('#lvOnCheck').checked,
      announceChannelId: $('#lvChan').value || null,
      textXp: Math.max(1, parseInt($('#lvTextXp').value, 10) || 1),
      cooldownSeconds: Math.max(1, parseInt($('#lvCooldown').value, 10) || 30),
      voiceXp: parseInt(vx.value, 10) || 50,
      rewards: c.rewards || [],
    });
  });
}

function viewSocial(gv, d) {
  const c = d.config;
  main().innerHTML = `
    <div class="hero"><div class="icon">📱</div><div class="t"><h1>Social Media</h1><p class="sub">Automatische Benachrichtigungen für Twitch &amp; YouTube.</p></div></div>
    <div class="grid g2 mt">
      <div class="card"><label>Standard-Benachrichtigungs-Kanal</label>${selectHtml('sxChan', chans(d.meta), c.notifyChannelId)}</div>
      <div class="card"><p class="small muted"><b>Twitch:</b> benötigt <code>TWITCH_CLIENT_ID</code> &amp; <code>TWITCH_CLIENT_SECRET</code> in der Umgebung (Render → Environment).<br><b>YouTube:</b> funktioniert ohne Key per RSS-Feed.</p></div>
    </div>
    <h2>YouTube-Kanäle</h2>
    <div class="card mt"><label>Eine pro Zeile: <code>Kanal-ID = Name [= Rolle] [= #Kanal-ID]</code></label>
      <textarea id="sxYt">${esc((c.youtube || []).map((x) => `${x.channelId} = ${x.name || ''} = ${x.roleId || ''} = ${x.notifyChannelId || ''}`).join('\n'))}</textarea></div>
    <h2>Twitch-Kanäle</h2>
    <div class="card mt"><label>Eine pro Zeile: <code>Benutzername = Anzeigename [= Rolle] [= #Kanal-ID]</code></label>
      <textarea id="sxTw">${esc((c.twitch || []).map((x) => `${x.name} = ${x.displayName || x.name} = ${x.roleId || ''} = ${x.notifyChannelId || ''}`).join('\n'))}</textarea></div>
    <div class="row mt"><button class="btn ghost sm" id="sxSave">💾 Speichern</button></div>`;
  $('#sxSave').addEventListener('click', () => {
    const parseYt = (l) => {
      const p = l.split('=').map((x) => x.trim());
      return { channelId: p[0], name: p[1] || p[0], roleId: p[2] || null, notifyChannelId: p[3] || null };
    };
    const parseTw = (l) => {
      const p = l.split('=').map((x) => x.trim());
      return { name: p[0], displayName: p[1] || p[0], roleId: p[2] || null, notifyChannelId: p[3] || null };
    };
    saveModuleConfig(gv, 'social', {
      notifyChannelId: $('#sxChan').value || null,
      youtube: $('#sxYt').value.split('\n').map(parseYt).filter((x) => x.channelId),
      twitch: $('#sxTw').value.split('\n').map(parseTw).filter((x) => x.name),
    });
  });
}

UI_BUILDERS.suggestions = viewSuggestions;
UI_BUILDERS.news = viewNews;
UI_BUILDERS.moderation = viewModeration;
UI_BUILDERS.welcome = viewWelcome;
UI_BUILDERS.stats = viewStats;
UI_BUILDERS.privatevoice = viewPrivateVoice;
UI_BUILDERS.support = viewSupport;
UI_BUILDERS.protection = viewProtection;
UI_BUILDERS.activity = viewActivity;
UI_BUILDERS.levels = viewLevels;
UI_BUILDERS.social = viewSocial;

init();
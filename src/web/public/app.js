const state = {
  data: null,
  guildIndex: 0,
  view: 'overview',
  ticketFilter: 'all',
  ticketSearch: '',
};

const $ = (s) => document.querySelector(s);
const main = () => $('#main');
const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}
function ago(ts) {
  if (!ts) return '–';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function guildUrl(g) {
  return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null;
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/auth/login'; throw new Error('login'); }
  if (r.status === 403) { throw new Error('Keine Berechtigung – du benötigst die Admin-Rolle.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fehler');
  return j;
}

async function refreshState() {
  state.data = await fetchJSON('/api/state');
}

async function init() {
  try {
    await refreshState();
  } catch (e) {
    $('#userInfo').textContent = e.message;
    return;
  }
  const u = state.data.user;
  $('#userInfo').innerHTML = `<b>${esc(u.global_name || u.username)}</b>`;
  bindNav();
  renderGuildList();
  render();
}

function bindNav() {
  document.querySelectorAll('.nav button').forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      document.querySelectorAll('.nav button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      render();
    })
  );
}

function renderGuildList() {
  const list = $('#guildList');
  if (!state.data.guilds.length) {
    list.innerHTML = '<p class="muted" style="font-size:12px">Kein Server mit Admin-Rechten.</p>';
    return;
  }
  state.guildIndex = Math.min(state.guildIndex, state.data.guilds.length - 1);
  list.innerHTML = state.data.guilds
    .map((g, i) => {
      const gd = g.guild;
      const img = guildUrl(gd);
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

// ---------------------------------------------------------------- views

function render() {
  if (!state.data || !state.data.guilds.length) {
    main().innerHTML = '<p class="muted">Kein Server verfügbar.</p>';
    return;
  }
  const view = state.view;
  if (!state.data.guilds[state.guildIndex]) { state.guildIndex = 0; renderGuildList(); }
  if (view === 'overview') renderOverview();
  else if (view === 'tickets') renderTickets();
  else if (view === 'panels') renderPanels();
  else if (view === 'logs') renderLogs();
  else if (view === 'settings') renderSettings();
}

function statCard(val, lab, color) {
  return `<div class="stat"><div class="val" style="color:${color || 'var(--text)'}">${val}</div><div class="lab">${lab}</div></div>`;
}

function ticketRow(t) {
  return `<tr class="clickable" data-tid="${esc(t.id)}">
    <td>${esc(t.id)}</td>
    <td><span class="badge ${t.status}">${esc(t.status)}</span></td>
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
    <h1 style="margin-bottom:18px">${esc(g.guild.name)}</h1>
    <div class="stats">
      ${statCard(s.open, 'Offen', 'var(--green)')}
      ${statCard(s.claimed, 'Geclaimt', 'var(--yellow)')}
      ${statCard(s.closed, 'Geschlossen', 'var(--red)')}
      ${statCard(s.total, 'Gesamt')}
      ${statCard(s.week, 'Diese Woche')}
      ${statCard(s.avgResponse ? s.avgResponse + 's' : '–', 'Ø Antwortzeit')}
      ${statCard(s.avgStars ? '⭐ ' + s.avgStars : '–', 'Ø Bewertung')}
    </div>
    <h2 class="mt">Aktuelle Tickets</h2>
    <div class="card mt">
      <table>
        <thead><tr><th>ID</th><th>Status</th><th>Thema</th><th>Ersteller</th><th>Claimed</th><th>Erstellt</th><th>Aktivität</th></tr></thead>
        <tbody>
          ${g.recentTickets.length ? g.recentTickets.map(ticketRow).join('') : '<tr><td colspan="7" class="muted">Noch keine Tickets.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  bindTicketRows();
}

function renderTickets() {
  const gid = current().guild.id;
  const tabs = ['all', 'open', 'claimed', 'closed', 'deleted'];
  main().innerHTML = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap">
      <h1>Tickets</h1>
      <div class="tabs">
        ${tabs.map((x) => `<button class="tab ${state.ticketFilter === x ? 'active' : ''}" data-f="${x}">${esc(x)}</button>`).join('')}
      </div>
    </div>
    <input class="mt" style="max-width:340px" placeholder="🔍 Suchen (ID, Creator, Thema)…" id="tSearch">
    <div class="card mt"><table>
      <thead><tr><th>ID</th><th>Status</th><th>Thema</th><th>Ersteller</th><th>Claimed</th><th>Erstellt</th><th>Aktivität</th></tr></thead>
      <tbody id="tBody"></tbody></table></div>`;

  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.ticketFilter = b.dataset.f;
      renderTickets();
    })
  );
  $('#tSearch').addEventListener('input', (e) => {
    state.ticketSearch = e.target.value.toLowerCase();
    loadTickets(gid);
  });
  loadTickets(gid);
}

async function loadTickets(gid) {
  const data = await fetchJSON(`/api/g/${gid}/tickets?status=${state.ticketFilter}`);
  const q = state.ticketSearch;
  let list = data.tickets;
  if (q) {
    list = list.filter((t) =>
      [t.id, t.creatorName, t.creatorTag, t.topic, t.channelName].join(' ').toLowerCase().includes(q)
    );
  }
  $('#tBody').innerHTML = list.length ? list.map(ticketRow).join('') : '<tr><td colspan="7" class="muted">Keine Tickets gefunden.</td></tr>';
  bindTicketRows();
}

function bindTicketRows() {
  document.querySelectorAll('tr[data-tid]').forEach((tr) =>
    tr.addEventListener('click', () => showTicket(tr.dataset.tid))
  );
}

async function showTicket(id) {
  const g = current();
  const data = await fetchJSON(`/api/g/${g.guild.id}/tickets/${id}`);
  const t = data.ticket;
  const fb = t.feedback;
  main().innerHTML = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap">
      <h1>${esc(t.id)} <span class="badge ${t.status}">${esc(t.status)}</span></h1>
      <div class="row">
        <a class="btn ghost sm" href="#overview" onclick="window.__back()">← Zurück</a>
        ${t.status !== 'deleted' && t.status !== 'closed' ? `<button class="btn sm red" data-act="close">🔒 Schließen</button>` : ''}
        ${t.status === 'closed' ? `<button class="btn sm yellow" data-act="reopen">🔓 Wieder öffnen</button>` : ''}
        ${t.status !== 'deleted' ? `<button class="btn sm red" data-act="delete">🗑️ Löschen</button>` : ''}
      </div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><b>Ersteller</b><p>${esc(t.creatorName)} (<code>${esc(t.creatorTag)}</code>)</p></div>
      <div class="card"><b>Thema</b><p>${esc(t.topic || '–')}</p></div>
      <div class="card"><b>Kanal</b><p>${t.channelName ? `<code>#${esc(t.channelName)}</code>` : '(gelöscht)'}</p></div>
      <div class="card"><b>Erstellt</b><p>${fmt(t.createdAt)}</p></div>
      ${t.claimedBy ? `<div class="card"><b>Claimed von</b><p><code>${esc(t.claimedBy)}</code> (${fmt(t.claimAt)})</p></div>` : ''}
      ${t.closeReason ? `<div class="card"><b>Schließgrund</b><p>${esc(t.closeReason)}</p></div>` : ''}
      ${fb ? `<div class="card"><b>Feedback</b><p>${'⭐'.repeat(fb.stars)}${'☆'.repeat(5 - fb.stars)}${fb.comment ? `<br>${esc(fb.comment)}` : ''}</p></div>` : ''}
      <div class="card"><b>Nachrichten</b><p>${t.messageCount}</p></div>
      ${t.firstResponseAt ? `<div class="card"><b>Erste Antwort</b><p>${fmt(t.firstResponseAt)}</p></div>` : ''}
    </div>
    <h2 class="mt">Transkript</h2>
    <div class="card mt"><pre>${esc(data.transcript || 'Kein Transkript vorhanden.')}</pre></div>`;

  document.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      const reason = act === 'close' && !window.confirm('Ticket schließen?') ? null : '';
      if (act === 'delete' && !window.confirm(`Ticket ${t.id} wirklich löschen?`)) return;
      const payload = { action: act };
      if (act === 'close') {
        const r = prompt('Grund (optional):');
        if (r === null) return;
        payload.reason = r;
      }
      try {
        await fetchJSON(`/api/g/${g.guild.id}/tickets/${t.id}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        toast(`✅ ${act} durchgeführt`);
        await refreshState();
        showTicket(t.id);
      } catch (e) {
        toast(e.message);
      }
    })
  );
}
window.__back = () => {
  state.view = 'tickets';
  bindNav();
  document.querySelectorAll('.nav button').forEach((x) => x.classList.remove('active'));
  document.querySelector('[data-view="tickets"]')?.classList.add('active');
  render();
};

function renderPanels() {
  const g = current();
  main().innerHTML = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap">
      <h1>Panels</h1><button class="btn sm ghost" id="newPanelBtn">+ Neues Panel</button>
    </div>
    <div id="panelForm" class="card mt" style="display:none">
      <label>Kanal-ID (wo das Panel erscheint)</label><input id="pChannel" placeholder="123456789012345678">
      <label>Titel</label><input id="pTitle" placeholder="🎫 Ticket erstellen">
      <label>Beschreibung</label><textarea id="pDesc" placeholder="Klicke unten…"></textarea>
      <label>Farbe</label><input id="pColor" placeholder="#5865F2">
      <label>Kategorien (eine pro Zeile: Label = Kanal-ID)</label>
      <textarea id="pCats" placeholder="Support = 12345678&#10;Billing = 98765432"></textarea>
      <div class="row mt"><button class="btn green sm" id="pSave">Erstellen</button></div>
    </div>
    <div class="grid mt" id="panelList"></div>`;

  $('#newPanelBtn').addEventListener('click', () => {
    $('#panelForm').style.display = $('#panelForm').style.display === 'none' ? 'block' : 'none';
  });
  $('#pSave').addEventListener('click', async () => {
    const cats = $('#pCats').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.split(/\s*[=:]\s*/);
      return { label: (m[0] || m[1] || '').trim(), channelId: ((m[1] || m[0]) || '').trim() };
    }).filter((c) => c.channelId);
    try {
      await fetchJSON(`/api/g/${g.guild.id}/panels/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: $('#pChannel').value.trim(), title: $('#pTitle').value, description: $('#pDesc').value, color: $('#pColor').value, categories: cats }),
      });
      toast('✅ Panel erstellt');
      await refreshState();
      renderPanels();
    } catch (e) {
      toast(e.message);
    }
  });
  loadPanels(g);
}

async function loadPanels(g) {
  const panels = g.panels;
  $('#panelList').innerHTML = panels.length
    ? panels.map((p) => `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <b>${esc(p.title)}</b>
          <button class="btn red sm" data-pid="${esc(p.id)}">🗑️</button>
        </div>
        <p class="muted mt" style="font-size:13px">Kanal: <code>${esc(p.channelId)}</code></p>
        <p class="muted" style="font-size:13px">${p.categories.length} Kategorie(n): ${p.categories.map((c) => esc(c.label)).join(', ')}</p>
      </div>`).join('')
    : '<p class="muted">Keine Panels. Erstelle ein Panel über <code>/panel create</code> in Discord oder oben.</p>';
  document.querySelectorAll('[data-pid]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Panel löschen?')) return;
      await fetchJSON(`/api/g/${g.guild.id}/panels/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId: b.dataset.pid }),
      });
      toast('🗑️ Panel gelöscht');
      await refreshState();
      renderPanels();
    })
  );
}

function renderLogs() {
  const g = current();
  const logs = g.actions;
  main().innerHTML = `
    <h1>Logs</h1>
    <div class="card mt"><table>
      <thead><tr><th>Zeit</th><th>Aktion</th><th>Ticket</th><th>Von</th><th>Details</th></tr></thead>
      <tbody>
        ${logs.length ? logs.map((a) => `
          <tr>
            <td>${fmt(a.at)}</td>
            <td>${esc(a.type)}</td>
            <td>${esc(a.ticketId || '–')}</td>
            <td>${esc(a.actorName || a.actorId || '–')}</td>
            <td class="muted">${esc((a.detail || '').slice(0, 60))}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="muted">Noch keine Aktionen.</td></tr>'}
      </tbody></table></div>`;
}

function renderSettings() {
  const g = current();
  const c = g.config;
  const e = c.embed || {};
  main().innerHTML = `
    <h1>Einstellungen</h1>
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
      ${field('Feedback aktiv', 'feedbackEnabled', c.feedbackEnabled, 'checkbox')}
      ${field('Auto-Transkripte', 'autoTranscripts', c.autoTranscripts, 'checkbox')}
    </div>
    <h2 class="mt">Embed Anpassung</h2>
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
    const bool = (n) => pick(n).checked;
    const body = {
      language: pick('language').value,
      supportRoles: list('supportRoles'),
      managerRoles: list('managerRoles'),
      adminRoles: list('adminRoles'),
      accessRoles: list('accessRoles'),
      pingRoleId: pick('pingRoleId').value || null,
      logChannelId: pick('logChannelId').value || null,
      transcriptChannelId: pick('transcriptChannelId').value || null,
      defaultCategoryId: pick('defaultCategoryId').value || null,
      closedCategoryId: pick('closedCategoryId').value || null,
      maxTicketsPerUser: num('maxTicketsPerUser'),
      autoCloseMinutes: num('autoCloseMinutes'),
      autoDeleteHours: num('autoDeleteHours'),
      messageLimit: num('messageLimit'),
      feedbackEnabled: bool('feedbackEnabled'),
      autoTranscripts: bool('autoTranscripts'),
      embed: {
        color: pick('embedColor').value,
        author: pick('embedAuthor').value,
        footer: pick('embedFooter').value,
        title: pick('embedTitle').value,
        description: pick('embedDescription').value,
        thumbnail: pick('embedThumbnail').value,
      },
    };
    try {
      await fetchJSON(`/api/g/${current().guild.id}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('✅ Einstellungen gespeichert');
      await refreshState();
    } catch (e) {
      toast(e.message);
    }
  });
}

function field(label, key, value, type) {
  if (type === 'checkbox') {
    return `<div class="card"><label>${label}</label>
      <div class="row mt"><input type="checkbox" data-k="${key}" ${value ? 'checked' : ''}></div></div>`;
  }
  return `<div class="card"><label>${label}</label><input class="mt" type="${type}" data-k="${key}" value="${esc(value)}"></div>`;
}

init();
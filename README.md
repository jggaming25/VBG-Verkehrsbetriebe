# 🎫 VBG Tickets – Galaxy-Bot-Style Ticket-System

Ein komplett selbstgehostetes Ticket-System für Discord (Original-Vorbild: **Galaxy Bot**) mit
**Discord-Bot**, **Web-Dashboard** (Login per Discord), **Transkripten**, **Feedback**,
**Auto-Close / Auto-Delete**, **Rollen-System**, **Logs** und **i18n (DE/EN)**.

Bot und Dashboard laufen in **einem** Prozess und können über **Render** gehostet werden.
Ein eingebauter **Self-Ping** (+ optional **UptimeRobot**) hält die Website am Leben.

---

## ✨ Module / Features

| Modul | Beschreibung |
|---|---|
| 🧩 **Panels** | Unbegrenzte Ticket-Panels mit 1–5 Kategorien (Buttons oder Select-Menü) |
| 🎟️ **Tickets** | Erstellen über Panel, `/new`, Button oder Dashboard (mit Kategorie-Thema) |
| 🛠️ **Ticket-Tools** | Claim / Unclaim, Close (+Grund), Reopen, Delete (mit Bestätigung), Rename, Add/Remove User |
| 📄 **Transkripte** | Automatisch bei Close, als Datei & als **Web-Link** (nur für Admins) |
| ⭐ **Feedback** | 1–5 Sterne + optionales Kommentar nach dem Schließen |
| ⏰ **Auto-Close** | Schließt Tickets nach X Minuten Inaktivität |
| 🗑️ **Auto-Delete** | Löscht geschlossene Tickets nach X Stunden |
| 🛡️ **Rollen** | Admin-, Manager-, Support- und Access-Rollen; Ping-Rolle bei neuen Tickets |
| 📜 **Logs** | Alle Aktionen (erstellen, schließen, claimen, löschen, Feedback …) in einen Log-Kanal |
| 🌍 **i18n** | `de` und `en` einstellbar |
| 📊 **Dashboard** | Login per Discord, Übersicht, Statistiken, Tickets, Transkript-Viewer, Panels, Einstellungen, Logs |
| 🚦 **REST-System** | Bot erkennt automatisch gelöschte Kanäle & räumt auf |
| 🛡️ **Dashboard-Zugriff** | Nur **Server-Administratoren** oder Mitglieder mit **Admin-Rolle (`1544006176109498458`)** |

---

## 📦 Enthaltene Slash-Commands

`/panel create` · `/panel delete` · `/panel list` · `/new` · `/close` · `/reopen` ·
`/claim` · `/unclaim` · `/add` · `/remove` · `/rename` · `/delete` · `/transcript` ·
`/tickets` · `/ticketinfo` · `/stats` · `/config view` · `/config set` · `/config help`

---

## 🚀 Deployment auf Render (Anleitung)

### 1) Discord Developer Portal vorbereiten

1. Gehe auf <https://discord.com/developers/applications> und öffne deine App (**VBG Bot**).
2. **Bot → Privileged Gateway Intents** aktivieren:
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**
3. **Bot → Token** kopieren (bei dir gesetzt).
4. **OAuth2 → General → Client ID** und **Client Secret** kopieren.
5. **OAuth2 → Redirects**: füge hinzu
   `https://DEINE-APP.onrender.com/auth/callback`
   (später deine echte Render-URL; lokal `http://localhost:10000/auth/callback`).

### 2) Bot einladen

Öffne diese URL (ersetze `CLIENT_ID` durch deine Client-ID):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=2416438352&integration_type=0&scope=bot%20applications.commands
```

Benötigte Rechte sind darin enthalten (Kanäle verwalten, Nachrichten senden/managern,
Rollen verwalten, Nachrichtenverlauf lesen, Einbettungen, Dateien, Reaktionen, Emojis,
Slash-Commands u. a.).

### 3) Repository auf GitHub

Dieses Projekt liegt aktuell im Repo **`jggaming25/VBG-Verkehrsbetriebe`**.
Alternativ: GitHub-Repo anlegen und die Dateien pushen.

### 4) Render Web Service anlegen

Am einfachsten über den **Blueprint**:

1. <https://dashboard.render.com/blueprints> → **New Blueprint Instance** → Repo auswählen.
2. Render liest `render.yaml` und legt den Service `vbg-ticket-bot` an.
3. **Environment-Variablen** (werden bei `sync: false` abgefragt) eintragen:

| Variable | Wert |
|---|---|
| `DISCORD_TOKEN` | dein Bot-Token |
| `CLIENT_ID` | deine Client-ID |
| `CLIENT_SECRET` | dein Client-Secret |
| `SESSION_SECRET` | langes, geheimes Zufalls-Zeichenfolge |
| `GUILD_ID` | die ID deines Discord-Servers (empfohlen, sonst dauert die Command-Registrierung bis zu 1 h) |
| `WEB_URL` | `https://DEINE-APP.onrender.com` |
| `ADMIN_ROLE_ID` | `1544006176109498458` (bereits vorbelegt) |

4. **Deploy** → Render baut `npm install` und startet `npm start`.
5. Nach dem Start ist der Bot online und die Commands sind innerhalb weniger Sekunden verfügbar.

> ⚠️ Wichtig: Das **Client Secret** und der **Session Secret** niemals ins Repo committen –
> nur als Env-Variablen setzen. Der Bot-Token ist in `.env` lokal hinterlegt, aber
> `.env` ist via `.gitignore` vom Repo ausgeschlossen.

### 5) Ping-Service (damit Render Free nicht einschläft)

Render Free Services schlafen nach ~15 Min Inaktivität ein. Zwei Schutzmaßnahmen:

- **Eingebauter Self-Ping:** Der Server pingt sich selbst alle 4 Minuten über `WEB_URL/ping`.
- **UptimeRobot (empfohlen als Backup):**
  1. <https://uptimerobot.com> → Add New Monitor
  2. Type **HTTP(s)**, Intervall **5 Minuten**
  3. URL: `https://DEINE-APP.onrender.com/ping`
  4. Alert Contact einstellen → los

Healthcheck kann zusätzlich in Render auf `/ping` gesetzt werden.

---

## 🖥️ Dashboard

URL: `https://DEINE-APP.onrender.com/`

- **Login per Discord** (OAuth2, `identify` + `guilds`).
- Zugriff **nur**, wenn du auf dem Server **Administrator** bist **oder** die Rolle
  `1544006176109498458` hast.
- Bereiche: **Übersicht** (Statistiken + aktuelle Tickets), **Tickets** (filtern & suchen,
  Detailansicht mit Transkript + Aktionen Schließen/Wieder öffnen/Löschen),
  **Panels** (ansehen / per Formular erstellen / löschen), **Logs**, **Einstellungen**
  (Rollen, Kanäle, Auto-Close, Auto-Delete, Feedback, Embed-Look …).

Transkript-Links aus Discord öffnen die Seite `/transcript/T-0001` (ebenfalls nur mit Berechtigung).

---

## 🧑‍💻 Lokale Entwicklung

```bash
npm install
# .env anlegen (Template: .env.example) – Token steht dort bereits
npm start
```

Dann: <http://localhost:10000>

Für den lokalen Dashboard-Login brauchst du zusätzlich in der Discord-App die Redirect-URL
`http://localhost:10000/auth/callback` und `CLIENT_SECRET` in `.env`.

---

## ⚙️ Konfiguration per `/config set`

Beispiele:

```text
/config set language en
/config set supportroles @Support-Team
/config set managerroles @Moderatoren
/config set adminroles @Admins
/config set logchannel #logs
/config set transcriptchannel #transkripte
/config set defaultcategory 123456789012345678
/config set closedcategory 123456789012345678
/config set pingrole @Support-Team
/config set maxticketsperuser 3
/config set autocloseminutes 30        # Tickets ohne Aktivität schließen nach 30 Min
/config set autodeletehours 72         # geschlossene Tickets nach 72 h löschen
/config set feedbackenabled true
/config set embedcolor #23a55a
/config set embedtitle "🎫 Unser Ticket-System"
```

Alle Werte lassen sich auch im Dashboard unter **Einstellungen** ändern.

---

## 🔐 Sicherheits-Hinweis

- Der im Chat geteilte Bot-Token ist veröffentlicht worden. **Empfehlung:** In den
  Discord Developer Settings einen **neuen Token** erzeugen (`Bot → Reset Token`)
  und in Render als `DISCORD_TOKEN` neu setzen. Der Code funktioniert weiterhin.
- Niemals `CLIENT_SECRET`, `SESSION_SECRET` oder den Token committen.
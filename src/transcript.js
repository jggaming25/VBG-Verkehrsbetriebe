import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function cleanContent(m) {
  if (!m.content) return '';
  let c = m.content;
  for (const e of m.embeds ? m.embeds : []) {
    if (e.title) c += `\n> **${e.title}**\n`;
    if (e.description) c += `> ${e.description}\n`;
  }
  return c.trim();
}

export async function buildTranscript(channel, cfg, ticket) {
  cfg = cfg || {};
  const limit = cfg.messageLimit || 150;
  const all = [];
  let before;
  while (all.length < limit) {
    const page = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!page || page.size === 0) break;
    all.push(...page.values());
    before = page.lastKey();
    if (page.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const msgs = all.slice(-limit);

  const lines = [];
  const hr = '\n' + '-'.repeat(48) + '\n';
  lines.push(`# Transkript – ${ticket.id}`);
  lines.push('');
  lines.push(`**Ticket:** ${ticket.id}`);
  lines.push(`**Kanal:** #${ticket.channelName || channel.name}`);
  lines.push(`**Erstellt von:** <@${ticket.creatorId}>`);
  lines.push(`**Erstellt am:** ${new Date(ticket.createdAt).toLocaleString('de-DE')}`);
  if (ticket.topic) lines.push(`**Thema:** ${ticket.topic}`);
  lines.push(`**Status:** ${ticket.status}`);
  if (ticket.closedAt) lines.push(`**Geschlossen am:** ${new Date(ticket.closedAt).toLocaleString('de-DE')}`);
  if (ticket.closeReason) lines.push(`**Schließgrund:** ${ticket.closeReason}`);
  if (ticket.feedback) lines.push(`**Feedback:** ${'★'.repeat(ticket.feedback.stars)}${'☆'.repeat(5 - ticket.feedback.stars)}` + (ticket.feedback.comment ? ` – "${ticket.feedback.comment}"` : ''));
  lines.push(hr);

  if (msgs.length === 0) {
    lines.push('_Keine Nachrichten vorhanden._');
  } else {
    let currentAuthor = null;
    for (const m of msgs) {
      const author = `<@${m.author.id}> (${m.author.tag})`;
      if (author !== currentAuthor) {
        lines.push('');
        lines.push(`### ${author} — ${m.createdAt.toLocaleString('de-DE')}`);
        currentAuthor = author;
      }
      const body = cleanContent(m) || (m.attachments.size ? `[Anhang: ${m.attachments.map((a) => a.name).join(', ')}]` : '');
      if (body) lines.push('- ' + body.replace(/\n/g, '\n  ').replace(/^- /, ''));
    }
  }

  const relPath = path.join('transcripts', `${ticket.id}.md`);
  const absPath = path.join(config.dataDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
  return { absPath, relPath, text: lines.join('\n') };
}

export function readTranscript(ticket) {
  if (!ticket || !ticket.transcriptPath) return null;
  const abs = path.join(config.dataDir, ticket.transcriptPath);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function transcriptExists(ticket) {
  if (!ticket || !ticket.transcriptPath) return false;
  return fs.existsSync(path.join(config.dataDir, ticket.transcriptPath));
}
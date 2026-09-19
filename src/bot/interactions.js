import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { isStaff } from '../auth.js';
import { extractionId } from '../util.js';
import {
  createTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  claimTicket,
  unclaimTicket,
  addParticipant,
  giveFeedback,
  clearCloseRequest,
} from './core.js';
import { voteSuggestion, decideSuggestion, submitSuggestion, suggestionEmbed, suggestionRow } from './suggestions.js';
import { verifyCode } from './modules.js';
import { helpRow, helpEmbed } from './commands-general.js';

export async function handleInteraction(client, i) {
  if (i.isChatInputCommand()) return; // handled via commands.js
  if (!i.inGuild() && !i.customId.startsWith('fb:')) {
    return ack(i, { content: 'Das funktioniert nur in einem Server.', ephemeral: true }, true);
  }

  const guild = i.guild;
  const cfg = i.guild ? store.ensureConfig(guild.id) : null;
  const member = i.guild ? i.member : null;
  const isAdminOrStaff = member ? isStaff(member, cfg) : false;

  // ---------------- Buttons ----------------
  if (i.isButton()) {
    const cd = i.customId;

    if (cd.startsWith('popen:')) {
      const panelId = cd.split(':')[1];
      const panel = store.getPanel(guild.id, panelId);
      if (!panel) return ack(i, { content: 'Dieses Panel existiert nicht mehr.', ephemeral: true }, true);
      const cat = panel.categories[0];
      const categoryChannel = cat && cat.channelId ? guild.channels.cache.get(cat.channelId) : null;
      await i.deferReply({ ephemeral: true });
      const res = await createTicket({ guild, creator: member, panel, topic: cat ? cat.label : null, categoryChannel });
      if (!res.ok) return i.editReply({ content: res.error });
      return i.editReply({ content: `🎫 Ticket erstellt: <#${res.channel.id}>` });
    }

    if (cd.startsWith('pselect:')) return;

    if (cd.startsWith('fb:')) {
      const [, stars, ticketId] = cd.split(':');
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: 'Ticket nicht gefunden.', ephemeral: true }, true);
      if (ticket.feedback) {
        return ack(i, { content: `Dein Ticket hat bereits ein Feedback: ${'⭐'.repeat(ticket.feedback.stars)}`, ephemeral: true }, true);
      }
      const modal = new ModalBuilder()
        .setCustomId(`fbcomment:${stars}:${ticketId}`)
        .setTitle('Feedback');
      const field = new TextInputBuilder()
        .setCustomId('comment')
        .setLabel('Kommentar (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500);
      modal.addComponents(new ActionRowBuilder().addComponents(field));
      store.updateTicket(ticketId, { _fbStars: Number(stars) });
      return i.showModal(modal);
    }

    if (cd.startsWith('tk:delx:')) {
      return ack(i, { content: 'Abbruch. Ticket bleibt erhalten.', ephemeral: true }, true);
    }

    if (cd.startsWith('tk:delc:')) {
      const ticketId = cd.split(':')[2];
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: 'Ticket nicht gefunden.', ephemeral: true }, true);
      if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
      await deleteTicket({ guild, ticket, actor: i.user });
      return ack(i, { content: `🗑️ Ticket **${ticket.id}** wurde gelöscht.`, ephemeral: true }, true);
    }

    if (cd.startsWith('sug:')) {
      const [, action, id] = cd.split(':');
      const s = store.getSuggestion(guild.id, id);
      if (!s) return ack(i, { content: 'Vorschlag nicht gefunden.', ephemeral: true }, true);
      if (action === 'up' || action === 'down') {
        await voteSuggestion({ guild, suggestion: s, voter: i.user, direction: action });
        await refreshSuggestions(guild, cfg, s);
        return ack(i, { content: `🗳️ Stimme registriert (${s.up} 👍 / ${s.down} 👎).`, ephemeral: true }, true);
      }
      if (action === 'accept' || action === 'decline' || action === 'resetv') {
        if (!isAdminOrStaff && !(cfg.suggestions?.teamRoles || []).some((r) => member?.roles.cache.has(r))) {
          return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
        }
        await decideSuggestion({ guild, suggestion: s, decision: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'reset', moderator: i.user });
        return ack(i, { content: action === 'resetv' ? '🔄 Stimmen zurückgesetzt.' : `✅ Vorschlag ${action === 'accept' ? 'angenommen' : 'abgelehnt'}.`, ephemeral: true }, true);
      }
      return ack(i, { content: `#${s.seq} · ${s.category} · ${s.up} 👍 / ${s.down} 👎`, ephemeral: true }, true);
    }

    if (cd.startsWith('tk:reqc:')) {
      const parts = cd.split(':');
      const ticketId = parts[2];
      const v = parts[3];
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: 'Ticket nicht gefunden.', ephemeral: true }, true);
      if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
      if (v === 'yes') {
        await closeTicket({ guild, ticket, actor: i.user, reason: ticket.closeRequest || 'Auftragsgemäße Schließung' });
        return ack(i, { content: `🔒 Ticket **${ticket.id}** wurde geschlossen.`, ephemeral: true }, true);
      }
      await clearCloseRequest({ guild, ticket });
      await guild.channels.cache.get(ticket.channelId)?.send({ content: `↩️ Schließanfrage von <@${ticket.creatorId}> wurde abgelehnt – Ticket bleibt offen.` });
      return ack(i, { content: 'Schließanfrage verworfen.', ephemeral: true }, true);
    }

    if (cd.startsWith('verify:') || cd === 'verify') {
      if (!cfg.protection?.enabled) return ack(i, { content: 'Verifizierung ist deaktiviert.', ephemeral: true }, true);
      const modal = new ModalBuilder().setCustomId('vcode').setTitle('🔐 Verifizierung');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('code').setLabel('Captcha-Code').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('6-stelliger Code aus der DM')
        )
      );
      return i.showModal(modal);
    }

    if (cd.startsWith('tk:')) {
      const [, action, ticketId] = cd.split(':');
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: t(cfg, 'errors_no_ticket'), ephemeral: true }, true);
      const channel = guild.channels.cache.get(ticket.channelId);
      const isCreator = ticket.creatorId === i.user.id;

      switch (action) {
        case 'claim': {
          if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          if (ticket.claimedBy === i.user.id) {
            await unclaimTicket({ guild, ticket, actor: i.user });
            await channel?.send({ content: `↩️ Claim von <@${i.user.id}> zurückgenommen.` });
          } else {
            if (ticket.claimedBy && ticket.claimedBy !== i.user.id) {
              return ack(i, { content: `Ticket ist bereits von <@${ticket.claimedBy}> übernommen.`, ephemeral: true }, true);
            }
            await claimTicket({ guild, ticket, actor: i.user });
            await channel?.send({ content: `🖐️ <@${i.user.id}> übernimmt dieses Ticket.` });
          }
          return ack(i, { content: 'Status aktualisiert.', ephemeral: true }, true);
        }
        case 'unclaim': {
          if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          await unclaimTicket({ guild, ticket, actor: i.user });
          await channel?.send({ content: `↩️ Claim von <@${i.user.id}> zurückgenommen.` });
          return ack(i, { content: 'Unclaim erfolgreich.', ephemeral: true }, true);
        }
        case 'add': {
          if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          const modal = new ModalBuilder().setCustomId(`add:${ticketId}`).setTitle('Benutzer hinzufügen');
          const field = new TextInputBuilder()
            .setCustomId('user')
            .setLabel('Benutzer-ID oder @Erwähnung')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(field));
          return i.showModal(modal);
        }
        case 'close': {
          if (!isAdminOrStaff && !isCreator) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          if (ticket.status === 'closed') return ack(i, { content: t(cfg, 'errors_ticket_closed'), ephemeral: true }, true);
          const modal = new ModalBuilder().setCustomId(`close:${ticketId}`).setTitle('Ticket schließen');
          const field = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Grund (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200);
          modal.addComponents(new ActionRowBuilder().addComponents(field));
          return i.showModal(modal);
        }
        case 'reopen': {
          if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          if (ticket.status !== 'closed') return ack(i, { content: t(cfg, 'errors_ticket_open'), ephemeral: true }, true);
          await reopenTicket({ guild, ticket, actor: i.user });
          return ack(i, { content: `🔓 Ticket **${ticket.id}** wurde wiedereröffnet.`, ephemeral: true }, true);
        }
        case 'delete': {
          if (!isAdminOrStaff) return ack(i, { content: t(cfg, 'errors_no_perm'), ephemeral: true }, true);
          const confirm = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tk:delc:${ticketId}`).setLabel('Ja, löschen').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tk:delx:${ticketId}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
          );
          return ack(i, { content: `⚠️ Sicher? **${ticket.id}** wird unwiderruflich gelöscht.`, components: [confirm], ephemeral: true }, true);
        }
      }
    }
  }

  // ---------------- Select (Help / Panel) ----------------
  if (i.isStringSelectMenu() && i.customId === 'help:cat') {
    const cfg = store.ensureConfig(i.guild.id);
    const focus = i.values[0];
    return i.reply({ embeds: [helpEmbed(cfg, focus)], components: helpRow(), ephemeral: true });
  }

  if (i.isStringSelectMenu() && i.customId.startsWith('pselect:')) {
    const panelId = i.customId.split(':')[1];
    const panel = store.getPanel(guild.id, panelId);
    if (!panel) return ack(i, { content: 'Dieses Panel existiert nicht mehr.', ephemeral: true }, true);
    const channelId = i.values[0];
    const categoryChannel = guild.channels.cache.get(channelId);
    const cat = panel.categories.find((c) => c.channelId === channelId);
    await i.deferReply({ ephemeral: true });
    const res = await createTicket({ guild, creator: member, panel, topic: cat ? cat.label : null, categoryChannel });
    if (!res.ok) return i.editReply({ content: res.error });
    return i.editReply({ content: `🎫 Ticket erstellt: <#${res.channel.id}>` });
  }

  // ---------------- Modals ----------------
  if (i.isModalSubmit()) {
    const cd = i.customId;

    if (cd === 'vcode') {
      if (!cfg?.protection?.enabled) return ack(i, { content: 'Verifizierung ist deaktiviert.', ephemeral: true }, true);
      const code = i.fields.getTextInputValue('code');
      const r = verifyCode(guild.id, i.user.id, code);
      if (!r.ok) return ack(i, { content: '❌ Code ungültig oder abgelaufen.', ephemeral: true }, true);
      if (!cfg.protection.verifiedRoleId) return ack(i, { content: '✅ Verifiziert! (Keine Rolle gesetzt)', ephemeral: true }, true);
      await i.member.roles.add(cfg.protection.verifiedRoleId, 'Verifiziert').catch(() => {});
      return ack(i, { content: `✅ Verifiziert – du hast **<@&${cfg.protection.verifiedRoleId}>** erhalten!`, ephemeral: true }, true);
    }

    if (cd === 'sug:new') {
      const category = i.fields.getTextInputValue('category');
      const idea = i.fields.getTextInputValue('idea');
      if (!idea || idea.length < 5) return ack(i, { content: '❌ Bitte eine ausführlichere Idee eingeben.', ephemeral: true }, true);
      const res = await submitSuggestion({ guild, author: i.member, category, idea });
      if (!res.ok) return ack(i, { content: res.error, ephemeral: true }, true);
      return ack(i, { content: `💡 Vorschlag **${res.suggestion.id}** wurde eingereicht!`, ephemeral: true }, true);
    }

    if (cd.startsWith('close:')) {
      const ticketId = cd.split(':')[1];
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: t(cfg, 'errors_no_ticket'), ephemeral: true }, true);
      const reason = i.fields.getTextInputValue('reason') || null;
      await closeTicket({ guild, ticket, actor: i.user, reason });
      return ack(i, { content: `🔒 Ticket **${ticket.id}** wurde geschlossen.${cfg.autoTranscripts ? ' (Transkript gespeichert)' : ''}`, ephemeral: true }, true);
    }

    if (cd.startsWith('add:')) {
      const ticketId = cd.split(':')[1];
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: t(cfg, 'errors_no_ticket'), ephemeral: true }, true);
      const raw = i.fields.getTextInputValue('user');
      const targetId = extractionId(raw);
      if (!targetId) return ack(i, { content: t(cfg, 'errors_user_not_found'), ephemeral: true }, true);
      const guildCh = guild;
      const target = await guildCh.members.fetch(targetId).catch(() => null);
      if (!target) return ack(i, { content: t(cfg, 'errors_user_not_found'), ephemeral: true }, true);
      const channel = guild.channels.cache.get(ticket.channelId);
      const res = await addParticipant({ guild, ticket, actor: i.user, target, channel });
      if (!res.ok) return ack(i, { content: res.error, ephemeral: true }, true);
      return ack(i, { content: `➕ <@${target.id}> wurde zum Ticket hinzugefügt.`, ephemeral: true }, true);
    }

    if (cd.startsWith('fbcomment:')) {
      const [, stars, ticketId] = cd.split(':');
      const ticket = store.getTicket(guild.id, ticketId);
      if (!ticket) return ack(i, { content: 'Ticket nicht gefunden.', ephemeral: true }, true);
      const comment = i.fields.getTextInputValue('comment') || null;
      const res = await giveFeedback({ guild, ticket, stars: Number(stars), comment, actor: i.user });
      if (!res.ok) return ack(i, { content: 'Feedback wurde bereits abgegeben.', ephemeral: true }, true);
      return ack(i, { content: `${'⭐'.repeat(Number(stars))} Danke für dein Feedback!`, ephemeral: true }, true);
    }
  }
}

async function refreshSuggestions(guild, cfg, s) {
  const ch = cfg.suggestions?.channelId ? guild.channels.cache.get(cfg.suggestions.channelId) : null;
  if (!ch || !s.messageId) return;
  const msg = await ch.messages.fetch(s.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [suggestionEmbed(cfg, s)], components: suggestionRow(s) }).catch(() => {});
}

async function ack(i, payload, ephemeral = true) {
  const opts = { ...payload, ephemeral };
  if (!i.deferred && !i.replied) {
    try {
      await i.reply(opts);
    } catch {
      return null;
    }
  }
  try {
    await i.editReply(payload);
  } catch {
    /* ignore */
  }
  return null;
}
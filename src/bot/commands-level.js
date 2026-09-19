import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { store, levelOf, xpForLevel, xpIntoLevel, xpToNext } from '../store.js';
import { isAdmin } from '../auth.js';

async function reply(i, payload) {
  const opts = { ...payload, ephemeral: true };
  if (!i.deferred && !i.replied) await i.reply(opts);
  else await i.editReply(opts);
}

function progressBar(cur, max, len = 12) {
  const p = max > 0 ? Math.min(1, cur / max) : 0;
  const filled = Math.round(p * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled) + ` ${Math.round(p * 100)}%`;
}

function rankEmoji(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

const levelCmd = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeigt dein Level (oder das eines anderen Mitglieds)')
    .addUserOption((o) => o.setName('user').setDescription('Mitglied (optional)')),
  async execute(i) {
    const target = i.options.getUser('user') || i.user;
    const guild = i.guild;
    const cfg = store.getConfig(guild.id);
    if (!cfg?.levels?.enabled) return reply(i, { content: '❌ Das Level-System ist auf diesem Server nicht aktiviert.' });
    const rec = store.getLevelData(guild.id, target.id);
    const level = levelOf(rec.xp);
    const into = xpIntoLevel(rec.xp);
    const next = xpToNext(level);
    const rank = store.rankOf(guild.id, target.id);
    const member = guild.members.cache.get(target.id);
    const voiceMin = Math.round((rec.voiceSeconds || 0) / 60);
    const e = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `${target.globalName || target.username}`, iconURL: target.displayAvatarURL?.() })
      .setDescription(`${rankEmoji(rank || 999)} **Level ${level}** · Rang #${rank || '–'}`)
      .addFields(
        { name: 'Fortschritt', value: progressBar(into, next), inline: false },
        { name: 'XP gesamt', value: `${rec.xp}`, inline: true },
        { name: 'Im Level', value: `${into}/${next}`, inline: true },
        { name: 'Voice-Zeit', value: voiceMin > 0 ? `${voiceMin} Min` : '–', inline: true }
      );
    if (level > 0) {
      const userRewards = (cfg.levels.rewards || []).filter((r) => Number(r.level) <= level && r.roleId && member?.roles.cache.has(r.roleId));
      if (userRewards.length) e.addFields({ name: 'Freigeschaltet', value: userRewards.map((r) => `<@&${r.roleId}>`).join(', '), inline: false });
    }
    return reply(i, { embeds: [e] });
  },
};

const leaderboardCmd = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt die Top-Spieler des Servers'),
  async execute(i) {
    const guild = i.guild;
    const cfg = store.getConfig(guild.id);
    if (!cfg?.levels?.enabled) return reply(i, { content: '❌ Das Level-System ist auf diesem Server nicht aktiviert.' });
    const top = store.leaderboard(guild.id, 10);
    const lines = top.length
      ? top.map((x) => {
          const m = guild.members.cache.get(x.userId);
          const name = m?.user?.globalName || m?.user?.username || `User ${x.userId.slice(0, 6)}`;
          const into = xpIntoLevel(x.xp);
          const next = xpToNext(x.level);
          return `${rankEmoji(x.rank)} **${name}** · Level ${x.level} · ${into}/${next} XP`;
        }).join('\n')
      : 'Noch keine Aktivität. Sende eine Nachricht oder sei im Sprachkanal, um XP zu sammeln.';
    const e = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏆 Level-Rangliste')
      .setDescription(lines)
      .setFooter({ text: 'XP für Nachrichten & Sprachzeit' })
      .setTimestamp();
    return reply(i, { embeds: [e] });
  },
};

const levelAdminCmd = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Admin: Level-System verwalten')
    .addSubcommand((s) => s.setName('info').setDescription('Zeigt die aktuellen Level-Einstellungen'))
    .addSubcommand((s) =>
      s.setName('set').setDescription('Setze das Level eines Mitglieds')
        .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
        .addIntegerOption((o) => o.setName('level').setDescription('Neues Level').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('add').setDescription('Füge XP hinzu')
        .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
        .addIntegerOption((o) => o.setName('xp').setDescription('XP-Anzahl').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('reset').setDescription('Setze XP zurück (alle oder ein Mitglied)')
        .addUserOption((o) => o.setName('user').setDescription('Mitglied (ohne Angabe = alle)'))
    )
    .addSubcommand((s) =>
      s.setName('toggle').setDescription('Aktiviere / deaktiviere das Level-System')
        .addBooleanOption((o) => o.setName('enabled').setDescription('an/aus').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('textxp').setDescription('XP pro Nachricht setzen')
        .addIntegerOption((o) => o.setName('xp').setDescription('XP pro Nachricht').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('voicexp').setDescription('XP pro Stunde im Sprachkanal setzen (empfohlen 50–120)')
        .addIntegerOption((o) => o.setName('xp').setDescription('XP pro Stunde').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('cooldown').setDescription('Cooldown zwischen Nachrichten-XP (Sekunden)')
        .addIntegerOption((o) => o.setName('seconds').setDescription('Sekunden').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('announce').setDescription('Kanal, in dem Level-Ups verkündet werden')
        .addChannelOption((o) => o.setName('channel').setDescription('Kanal (oder keine Auswahl = aus)'))
    )
    .addSubcommand((s) =>
      s.setName('reward').setDescription('Rolle, die bei einem Level vergeben wird')
        .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rolle').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('unreward').setDescription('Rolle von einem Level entfernen')
        .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true))
    ),
  async execute(i) {
    const guild = i.guild;
    const cfg = store.ensureConfig(guild.id);
    if (!isAdmin(i.member, cfg)) return reply(i, { content: '❌ Nur Admins können dieses Kommando nutzen.' });
    await i.deferReply({ ephemeral: true });
    const sub = i.options.getSubcommand(true);
    const lvl = cfg.levels || (cfg.levels = {});

    if (sub === 'info') {
      const e = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Level-Einstellungen')
        .addFields(
          { name: 'Aktiv', value: lvl.enabled ? '✅ Ja' : '❌ Nein', inline: true },
          { name: 'XP / Nachricht', value: String(lvl.textXp ?? 1), inline: true },
          { name: 'XP / Stunde Voice', value: String(lvl.voiceXp ?? 50), inline: true },
          { name: 'Cooldown', value: `${lvl.cooldownSeconds ?? 30}s`, inline: true },
          { name: 'Ankündigungs-Kanal', value: lvl.announceChannelId ? `<#${lvl.announceChannelId}>` : '–', inline: true },
          { name: 'Level-Rollen', value: (lvl.rewards || []).map((r) => `Level ${r.level}: <@&${r.roleId}>`).join('\n') || '–', inline: false }
        );
      return reply(i, { embeds: [e] });
    }

    if (sub === 'toggle') {
      lvl.enabled = !!i.options.getBoolean('enabled');
      const lv = store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ Level-System ${lv.levels.enabled ? 'aktiviert' : 'deaktiviert'}.` });
    }
    if (sub === 'textxp') {
      lvl.textXp = Math.max(1, i.options.getInteger('xp'));
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ ${lvl.textXp} XP pro Nachricht.` });
    }
    if (sub === 'voicexp') {
      lvl.voiceXp = Math.max(1, i.options.getInteger('xp'));
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ ${lvl.voiceXp} XP pro Stunde Sprachzeit.` });
    }
    if (sub === 'cooldown') {
      lvl.cooldownSeconds = Math.max(1, i.options.getInteger('seconds'));
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ Cooldown ${lvl.cooldownSeconds}s.` });
    }
    if (sub === 'announce') {
      const ch = i.options.getChannel('channel');
      lvl.announceChannelId = ch ? ch.id : null;
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: ch ? `✅ Level-Ups künftig in <#${ch.id}>.` : '✅ Level-Up-Nachrichten deaktiviert.' });
    }
    if (sub === 'reward') {
      const level = Math.max(1, i.options.getInteger('level'));
      const role = i.options.getRole('role');
      if (role?.managed || role?.id === guild.id) return reply(i, { content: '❌ Bitte eine normale Rolle wählen.' });
      lvl.rewards = [...(lvl.rewards || []).filter((r) => Number(r.level) !== level), { level, roleId: role.id }];
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ Level ${level} vergibt künftig <@&${role.id}>.` });
    }
    if (sub === 'unreward') {
      const level = Math.max(1, i.options.getInteger('level'));
      lvl.rewards = (lvl.rewards || []).filter((r) => Number(r.level) !== level);
      store.updateConfig(guild.id, { levels: lvl });
      return reply(i, { content: `✅ Belohnung für Level ${level} entfernt.` });
    }
    if (sub === 'set') {
      const target = i.options.getUser('user');
      const level = Math.max(0, i.options.getInteger('level'));
      const xp = xpForLevel(level);
      store.setLevelXp(guild.id, target.id, xp);
      return reply(i, { content: `<@${target.id}> ist jetzt **Level ${level}** (${xp} XP).` });
    }
    if (sub === 'add') {
      const target = i.options.getUser('user');
      const xp = i.options.getInteger('xp');
      const res = store.addLevelXp(guild.id, target.id, xp);
      return reply(i, { content: `<@${target.id}> hat **${xp} XP** erhalten (jetzt Level ${res.levelAfter}).` });
    }
    if (sub === 'reset') {
      const target = i.options.getUser('user');
      if (target) {
        store.resetLevel(guild.id, target.id);
        return reply(i, { content: `✅ XP von <@${target.id}> zurückgesetzt.` });
      }
      const cnt = Object.keys(store.allLevelData(guild.id)).length;
      store.resetLevels(guild.id);
      return reply(i, { content: `✅ Level-XP von ${cnt} Mitglied(ern) zurückgesetzt.` });
    }
    return reply(i, { content: 'Unbekanntes Unterkommando.' });
  },
};

export const levels = [levelCmd, leaderboardCmd, levelAdminCmd];
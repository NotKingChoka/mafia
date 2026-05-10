import { randomInt } from "node:crypto";

export const ROLE_META = {
  civilian: {
    title: "Мирный житель",
    team: "city",
    description: "Ищет мафию днем и голосует вместе с городом."
  },
  mafia: {
    title: "Мафия",
    team: "mafia",
    description: "Ночью выбирает жертву вместе с мафиозной командой."
  },
  don: {
    title: "Дон мафии",
    team: "mafia",
    description: "Главарь мафии. Считается частью мафиозной команды."
  },
  commissioner: {
    title: "Комиссар",
    team: "city",
    description: "Ночью проверяет одного игрока на принадлежность к мафии."
  },
  doctor: {
    title: "Доктор",
    team: "city",
    description: "Ночью лечит одного игрока и может спасти его от убийства."
  },
  maniac: {
    title: "Маньяк",
    team: "solo",
    description: "Одиночная роль. Ночью выбирает жертву и побеждает, если остается один."
  }
};

export function isMafiaRole(role) {
  return role === "mafia" || role === "don";
}

export function isHostileRole(role) {
  return isMafiaRole(role) || role === "maniac";
}

export function allocateRoles(playerCount, roleSettings = {}) {
  if (roleSettings.counts) return allocateRolesByCounts(playerCount, roleSettings.counts);

  const enabled = {
    don: roleSettings.don !== false,
    commissioner: roleSettings.commissioner !== false,
    doctor: roleSettings.doctor !== false
  };

  let mafiaTeamCount = 1;
  if (playerCount >= 7 && playerCount <= 9) mafiaTeamCount = 2;
  if (playerCount >= 10 && playerCount <= 12) mafiaTeamCount = 3;
  if (playerCount >= 13) mafiaTeamCount = 4;

  const roles = [];
  if (enabled.don && mafiaTeamCount >= 3) {
    roles.push("don");
    mafiaTeamCount -= 1;
  }

  for (let i = 0; i < mafiaTeamCount; i += 1) roles.push("mafia");
  if (enabled.commissioner) roles.push("commissioner");
  if (enabled.doctor) roles.push("doctor");
  while (roles.length < playerCount) roles.push("civilian");

  return shuffle(roles.slice(0, playerCount));
}

export function getRoleCounts(playerCount, roleSettings = {}) {
  return allocateRoles(playerCount, roleSettings).reduce((acc, role) => {
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
}

export function getRoleBalance(playerCount, roleSettings = {}) {
  const counts = normalizeRoleCounts(roleSettings.counts, playerCount);
  const specialTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    counts: {
      ...counts,
      civilian: Math.max(0, playerCount - specialTotal)
    },
    warning: getRoleBalanceWarning(playerCount, counts)
  };
}

function allocateRolesByCounts(playerCount, countsInput = {}) {
  const counts = normalizeRoleCounts(countsInput, playerCount);
  const roles = [];
  for (let i = 0; i < counts.mafia; i += 1) roles.push("mafia");
  for (let i = 0; i < counts.don; i += 1) roles.push("don");
  for (let i = 0; i < counts.commissioner; i += 1) roles.push("commissioner");
  for (let i = 0; i < counts.doctor; i += 1) roles.push("doctor");
  for (let i = 0; i < counts.maniac; i += 1) roles.push("maniac");
  while (roles.length < playerCount) roles.push("civilian");
  return shuffle(roles.slice(0, playerCount));
}

export function normalizeRoleCounts(countsInput = {}, playerCount = 10) {
  const counts = {
    mafia: clampCount(countsInput.mafia, 1, 5),
    don: clampCount(countsInput.don, 0, 1),
    commissioner: clampCount(countsInput.commissioner, 0, 2),
    doctor: clampCount(countsInput.doctor, 0, 2),
    maniac: clampCount(countsInput.maniac, 0, 1)
  };
  let total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const order = ["maniac", "doctor", "commissioner", "don", "mafia"];
  for (const role of order) {
    while (total > playerCount && counts[role] > (role === "mafia" ? 1 : 0)) {
      counts[role] -= 1;
      total -= 1;
    }
  }
  return counts;
}

export function getRoleBalanceWarning(playerCount, countsInput = {}) {
  const total = Object.values(countsInput).reduce((sum, value) => sum + Number(value || 0), 0);
  const mafiaTeam = Number(countsInput.mafia || 0) + Number(countsInput.don || 0);
  if (total > playerCount) return "Ролей больше, чем игроков. Лишние роли будут убраны автоматически.";
  if (mafiaTeam < 1) return "Нужна хотя бы одна роль мафии или дона.";
  if (mafiaTeam >= Math.ceil(playerCount / 2)) return "Мафии слишком много: партия может закончиться слишком быстро.";
  if (Number(countsInput.maniac || 0) > 0 && playerCount < 7) return "Маньяк лучше работает в партиях от 7 игроков.";
  return "";
}

function clampCount(value, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : min;
  return Math.max(min, Math.min(max, number));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

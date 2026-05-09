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
  }
};

export function isMafiaRole(role) {
  return role === "mafia" || role === "don";
}

export function allocateRoles(playerCount, enabledRoles = {}) {
  const enabled = {
    don: enabledRoles.don !== false,
    commissioner: enabledRoles.commissioner !== false,
    doctor: enabledRoles.doctor !== false
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

export function getRoleCounts(playerCount, enabledRoles = {}) {
  return allocateRoles(playerCount, enabledRoles).reduce((acc, role) => {
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

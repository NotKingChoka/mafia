import { randomUUID } from "node:crypto";
import { allocateRoles, getRoleCounts, isMafiaRole, ROLE_META } from "./roles.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_EVENTS = 120;
const MAX_CHAT = 160;

const PHASE_LABELS = {
  lobby: "Лобби",
  roles: "Раздача ролей",
  night: "Ночь",
  morning: "Утро",
  discussion: "Обсуждение",
  voting: "Голосование",
  finished: "Игра окончена"
};

const PHASE_DURATIONS = {
  roles: Number(process.env.ROLE_PHASE_SECONDS || 18),
  night: Number(process.env.NIGHT_PHASE_SECONDS || 80),
  morning: Number(process.env.MORNING_PHASE_SECONDS || 24),
  discussion: Number(process.env.DISCUSSION_PHASE_SECONDS || 120),
  voting: Number(process.env.VOTING_PHASE_SECONDS || 60)
};

const BOT_NAMES = [
  "Барон",
  "Соня",
  "Феликс",
  "Рокси",
  "Леон",
  "Валет",
  "Ирис",
  "Марсель",
  "Граф",
  "Ника",
  "Рубин",
  "Вега",
  "Север",
  "Ада",
  "Бруно"
];

export function createGameEngine(io) {
  const rooms = new Map();
  const socketLinks = new Map();

  function bindSocket(socket) {
    socket.on("createRoom", (payload = {}) => {
      try {
        const nickname = normalizeName(payload.nickname);
        const settings = sanitizeSettings(payload.settings);
        const room = createRoom({
          name: normalizeRoomName(payload.roomName),
          settings
        });
        const player = createPlayer({
          socketId: socket.id,
          nickname,
          avatar: payload.avatar,
          isCreator: true
        });

        room.creatorId = player.id;
        room.hostId = settings.autoHost ? null : player.id;
        room.players.push(player);
        rooms.set(room.code, room);
        socket.join(room.code);
        socketLinks.set(socket.id, { roomCode: room.code, playerId: player.id });
        addEvent(room, `${player.name} создал комнату.`);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("joinRoom", (payload = {}) => {
      try {
        const room = getRoom(payload.roomCode);
        if (room.phase !== "lobby") throw new Error("Игра уже началась.");
        const nickname = normalizeName(payload.nickname);
        const reconnected = reconnectKnownPlayer(room, payload.playerId, socket);
        if (reconnected) {
          addEvent(room, `${reconnected.name} вернулся в комнату.`);
          emitRoom(room);
          return;
        }

        if (room.players.length >= room.settings.capacity) {
          throw new Error("Комната заполнена.");
        }

        const player = createPlayer({
          socketId: socket.id,
          nickname,
          avatar: payload.avatar
        });
        room.players.push(player);
        socket.join(room.code);
        socketLinks.set(socket.id, { roomCode: room.code, playerId: player.id });
        addEvent(room, `${player.name} присоединился к комнате.`);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("rejoinRoom", (payload = {}) => {
      try {
        const room = getRoom(payload.roomCode);
        const player = reconnectKnownPlayer(room, payload.playerId, socket);
        if (!player) throw new Error("Не удалось восстановить игрока в комнате.");
        addEvent(room, `${player.name} восстановил соединение.`);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("toggleReady", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        ensureLobby(room);
        player.ready = !player.ready;
        addEvent(room, `${player.name} ${player.ready ? "готов" : "снял готовность"}.`);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("updateSettings", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        ensureLobby(room);
        ensureCreator(room, player);
        room.settings = sanitizeSettings({ ...room.settings, ...payload.settings });
        if (room.players.length > room.settings.capacity) {
          room.settings.capacity = room.players.length;
        }
        room.hostId = room.settings.autoHost ? null : room.creatorId;
        addEvent(room, "Настройки комнаты обновлены.");
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("addBot", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        ensureLobby(room);
        ensureCreator(room, player);
        const amount = clamp(Number(payload.count || 1), 1, 15);
        let added = 0;
        while (added < amount && room.players.length < room.settings.capacity) {
          room.players.push(createBot(room));
          added += 1;
        }
        if (!added) throw new Error("В комнате нет свободных мест.");
        addEvent(room, `Добавлены тренировочные игроки: ${added}.`);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("startGame", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        ensureLobby(room);
        ensureCreator(room, player);
        const blockers = getStartBlockers(room);
        if (blockers.length) throw new Error(blockers[0]);
        startGame(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("nightAction", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        handleNightAction(room, player, payload);
        emitRoom(room);
        tryResolveNight(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("castVote", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        handleVote(room, player, payload.targetId);
        emitRoom(room);
        tryResolveVoting(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("sendChat", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        const text = String(payload.text || "").trim().slice(0, 600);
        if (!text) return;
        const channel = player.alive || room.phase === "lobby" ? "alive" : "dead";
        addChat(room, {
          type: "player",
          channel,
          playerId: player.id,
          playerName: player.name,
          text
        });
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("voiceState", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        player.micOn = Boolean(payload.micOn);
        player.speaking = Boolean(payload.speaking) && player.micOn && player.alive;
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("advancePhase", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        ensureCreator(room, player);
        advanceRoomPhase(room, "manual");
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("leaveRoom", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        leaveRoom(room, player, socket.id);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("disconnect", () => {
      const link = socketLinks.get(socket.id);
      socketLinks.delete(socket.id);
      if (!link) return;
      const room = rooms.get(link.roomCode);
      if (!room) return;
      const player = room.players.find((item) => item.id === link.playerId);
      if (!player || player.isBot) return;
      if (player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      player.micOn = false;
      player.speaking = false;
      addEvent(room, `${player.name} потерял соединение.`);
      emitRoom(room);
    });
  }

  function createRoom({ name, settings }) {
    return {
      code: generateRoomCode(),
      name,
      settings,
      creatorId: null,
      hostId: null,
      players: [],
      phase: "lobby",
      round: 0,
      phaseStartedAt: Date.now(),
      phaseDuration: 0,
      activeSpeakerId: null,
      actions: createEmptyActions(),
      votes: {},
      events: [],
      chat: [],
      privateLog: {},
      lastNightResult: null,
      lastVoteResult: null,
      winner: null,
      timer: null,
      createdAt: Date.now()
    };
  }

  function startGame(room) {
    clearRoomTimer(room);
    const roles = allocateRoles(room.players.length, room.settings.roles);
    room.players.forEach((player, index) => {
      player.role = roles[index];
      player.alive = true;
      player.ready = false;
      player.voted = false;
      player.speaking = false;
      player.micOn = false;
    });
    room.round = 1;
    room.privateLog = {};
    room.chat = [];
    room.lastNightResult = null;
    room.lastVoteResult = null;
    room.winner = null;
    addEvent(room, "Игра началась. Роли розданы тайно.");
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text: "Игра началась. Проверьте свою роль."
    });
    startPhase(room, "roles");
  }

  function startPhase(room, phase) {
    clearRoomTimer(room);
    room.phase = phase;
    room.phaseStartedAt = Date.now();
    room.phaseDuration = room.settings.autoHost ? PHASE_DURATIONS[phase] || 0 : 0;

    if (phase === "night") {
      room.actions = createEmptyActions();
      room.activeSpeakerId = null;
      addEvent(room, `Раунд ${room.round}. Наступила ночь.`);
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: "Наступила ночь. Ночные роли выбирают цели."
      });
      runBotNightActions(room);
    }

    if (phase === "morning") {
      room.activeSpeakerId = getFirstAlive(room)?.id || null;
    }

    if (phase === "discussion") {
      room.activeSpeakerId = getFirstAlive(room)?.id || null;
      addEvent(room, "Началось обсуждение.");
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: "Началось обсуждение."
      });
    }

    if (phase === "voting") {
      room.votes = {};
      room.activeSpeakerId = null;
      addEvent(room, "Открыто голосование.");
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: "Открыто голосование. Каждый живой игрок голосует один раз."
      });
      runBotVotes(room);
    }

    if (phase === "roles") {
      addEvent(room, "Фаза раздачи ролей.");
    }

    scheduleAutoPhase(room);
    emitRoom(room);
  }

  function scheduleAutoPhase(room) {
    if (!room.settings.autoHost || !room.phaseDuration || room.phase === "finished") return;
    room.timer = setTimeout(() => {
      advanceRoomPhase(room, "timer");
    }, room.phaseDuration * 1000);
    room.timer.unref?.();
  }

  function advanceRoomPhase(room, reason) {
    if (room.phase === "finished") return;
    if (room.phase === "roles") {
      startPhase(room, "night");
      return;
    }
    if (room.phase === "night") {
      resolveNight(room);
      return;
    }
    if (room.phase === "morning") {
      startPhase(room, "discussion");
      return;
    }
    if (room.phase === "discussion") {
      startPhase(room, "voting");
      return;
    }
    if (room.phase === "voting") {
      resolveVoting(room);
      return;
    }
    if (reason === "manual") emitRoom(room);
  }

  function handleNightAction(room, player, payload) {
    if (room.phase !== "night") throw new Error("Сейчас не ночная фаза.");
    if (!player.alive) throw new Error("Мертвый игрок не может выполнять ночные действия.");
    const target = room.players.find((item) => item.id === payload.targetId);
    if (!target || !target.alive) throw new Error("Цель недоступна.");

    if (payload.action === "kill") {
      if (!isMafiaRole(player.role)) throw new Error("Убивать ночью может только мафия.");
      if (target.id === player.id) throw new Error("Нельзя выбрать себя жертвой мафии.");
      if (isMafiaRole(target.role)) throw new Error("Мафия не выбирает свою команду жертвой.");
      room.actions.mafia[player.id] = target.id;
      addPrivate(room, player.id, `Вы выбрали цель мафии: ${target.name}.`);
      addMafiaPrivate(room, `${player.name} выбрал цель: ${target.name}.`);
      return;
    }

    if (payload.action === "inspect") {
      if (player.role !== "commissioner") throw new Error("Проверять может только комиссар.");
      if (target.id === player.id) throw new Error("Комиссар не проверяет себя.");
      room.actions.commissioner[player.id] = target.id;
      const verdict = isMafiaRole(target.role) ? "относится к мафии" : "не относится к мафии";
      addPrivate(room, player.id, `Проверка: ${target.name} ${verdict}.`);
      return;
    }

    if (payload.action === "heal") {
      if (player.role !== "doctor") throw new Error("Лечить может только доктор.");
      room.actions.doctor[player.id] = target.id;
      addPrivate(room, player.id, `Вы лечите игрока: ${target.name}.`);
      return;
    }

    throw new Error("Неизвестное ночное действие.");
  }

  function handleVote(room, player, targetId) {
    if (room.phase !== "voting") throw new Error("Сейчас не идет голосование.");
    if (!player.alive) throw new Error("Мертвый игрок не может голосовать.");
    if (room.votes[player.id]) throw new Error("Вы уже проголосовали.");
    const target = room.players.find((item) => item.id === targetId);
    if (!target || !target.alive) throw new Error("Нельзя голосовать против этой цели.");
    if (target.id === player.id) throw new Error("Нельзя голосовать против себя.");
    room.votes[player.id] = target.id;
    addEvent(room, `${player.name} проголосовал.`);
  }

  function tryResolveNight(room) {
    if (room.phase !== "night") return;
    if (areNightActionsComplete(room)) resolveNight(room);
  }

  function tryResolveVoting(room) {
    if (room.phase !== "voting") return;
    const aliveCount = room.players.filter((player) => player.alive).length;
    if (Object.keys(room.votes).length >= aliveCount) resolveVoting(room);
  }

  function resolveNight(room) {
    if (room.phase !== "night") return;
    clearRoomTimer(room);
    const mafiaTargetId = getMajorityTarget(Object.values(room.actions.mafia));
    const doctorTargetId = Object.values(room.actions.doctor)[0] || null;
    const target = mafiaTargetId ? room.players.find((player) => player.id === mafiaTargetId) : null;

    let text = "Этой ночью никто не умер.";
    let killedId = null;
    if (target && target.alive) {
      if (doctorTargetId === target.id) {
        text = "Этой ночью никто не умер. Доктор успел спасти жертву.";
      } else {
        target.alive = false;
        target.speaking = false;
        killedId = target.id;
        text = `Этой ночью погиб ${target.name}.`;
      }
    }

    room.lastNightResult = { text, killedId };
    addEvent(room, text);
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text
    });

    if (checkVictory(room)) {
      emitRoom(room);
      return;
    }
    startPhase(room, "morning");
  }

  function resolveVoting(room) {
    if (room.phase !== "voting") return;
    clearRoomTimer(room);
    const targetId = getMajorityTarget(Object.values(room.votes), true);
    const target = targetId ? room.players.find((player) => player.id === targetId) : null;
    let text = "Голосование закончилось без изгнания.";

    if (target && target.alive) {
      target.alive = false;
      target.speaking = false;
      text = `${target.name} выбыл по итогам голосования.`;
    }

    room.lastVoteResult = {
      text,
      votes: { ...room.votes },
      eliminatedId: target?.id || null
    };
    addEvent(room, text);
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text
    });

    if (checkVictory(room)) {
      emitRoom(room);
      return;
    }
    room.round += 1;
    startPhase(room, "night");
  }

  function checkVictory(room) {
    const alive = room.players.filter((player) => player.alive);
    const mafiaAlive = alive.filter((player) => isMafiaRole(player.role)).length;
    const cityAlive = alive.length - mafiaAlive;
    if (mafiaAlive === 0) {
      finishRoom(room, {
        team: "city",
        title: "Мирные жители победили",
        text: "Вся мафия уничтожена."
      });
      return true;
    }
    if (mafiaAlive >= cityAlive) {
      finishRoom(room, {
        team: "mafia",
        title: "Мафия победила",
        text: "Мафия сравнялась с городом или получила численное преимущество."
      });
      return true;
    }
    return false;
  }

  function finishRoom(room, winner) {
    clearRoomTimer(room);
    room.phase = "finished";
    room.phaseStartedAt = Date.now();
    room.phaseDuration = 0;
    room.winner = winner;
    addEvent(room, `${winner.title}. ${winner.text}`);
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text: `${winner.title}. ${winner.text}`
    });
  }

  function leaveRoom(room, player, socketId) {
    socketLinks.delete(socketId);
    if (room.phase === "lobby") {
      room.players = room.players.filter((item) => item.id !== player.id);
      addEvent(room, `${player.name} вышел из комнаты.`);
    } else {
      player.connected = false;
      player.socketId = null;
      player.micOn = false;
      player.speaking = false;
      addEvent(room, `${player.name} вышел из партии. Его место сохранено для переподключения.`);
    }

    if (player.isCreator) transferCreator(room);
    if (!room.players.length) {
      clearRoomTimer(room);
      rooms.delete(room.code);
      return;
    }
    emitRoom(room);
  }

  function transferCreator(room) {
    const next = room.players.find((player) => !player.isBot) || room.players[0];
    if (!next) return;
    room.players.forEach((player) => {
      player.isCreator = player.id === next.id;
    });
    room.creatorId = next.id;
    room.hostId = room.settings.autoHost ? null : next.id;
    addEvent(room, `${next.name} теперь создатель комнаты.`);
  }

  function runBotNightActions(room) {
    for (const bot of room.players.filter((player) => player.isBot && player.alive)) {
      if (isMafiaRole(bot.role)) {
        const target = randomAlive(room, (player) => !isMafiaRole(player.role));
        if (target) room.actions.mafia[bot.id] = target.id;
      }
      if (bot.role === "commissioner") {
        const target = randomAlive(room, (player) => player.id !== bot.id);
        if (target) room.actions.commissioner[bot.id] = target.id;
      }
      if (bot.role === "doctor") {
        const target = randomAlive(room);
        if (target) room.actions.doctor[bot.id] = target.id;
      }
    }
  }

  function runBotVotes(room) {
    for (const bot of room.players.filter((player) => player.isBot && player.alive)) {
      const target = randomAlive(room, (player) => player.id !== bot.id);
      if (target) room.votes[bot.id] = target.id;
    }
  }

  function emitRoom(room) {
    for (const player of room.players) {
      if (!player.socketId || player.isBot) continue;
      io.to(player.socketId).emit("roomState", serializeRoom(room, player.id));
    }
  }

  function serializeRoom(room, viewerId) {
    const viewer = room.players.find((player) => player.id === viewerId);
    const revealAllRoles = viewer?.isCreator && !room.settings.autoHost;
    const filteredChat = room.chat.filter((message) => {
      if (message.channel !== "dead") return true;
      return !viewer?.alive || room.phase === "finished";
    });

    return {
      code: room.code,
      name: room.name,
      settings: room.settings,
      phase: room.phase,
      phaseLabel: PHASE_LABELS[room.phase],
      round: room.round,
      phaseStartedAt: room.phaseStartedAt,
      phaseDuration: room.phaseDuration,
      activeSpeakerId: room.activeSpeakerId,
      creatorId: room.creatorId,
      hostId: room.hostId,
      canStart: getStartBlockers(room).length === 0,
      startBlockers: getStartBlockers(room),
      players: room.players.map((player) => {
        const canSeeRole =
          revealAllRoles ||
          player.id === viewerId ||
          room.phase === "finished" ||
          (isMafiaRole(viewer?.role) && isMafiaRole(player.role));
        return {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          ready: player.ready,
          alive: player.alive,
          connected: player.connected,
          isCreator: player.isCreator,
          isHost: room.hostId === player.id,
          isBot: player.isBot,
          micOn: player.micOn,
          speaking: player.speaking,
          role: canSeeRole ? player.role : null
        };
      }),
      viewer: viewer
        ? {
            id: viewer.id,
            name: viewer.name,
            avatar: viewer.avatar,
            ready: viewer.ready,
            alive: viewer.alive,
            role: viewer.role,
            isCreator: viewer.isCreator,
            canManage: viewer.isCreator,
            micOn: viewer.micOn,
            speaking: viewer.speaking
          }
        : null,
      myRole: viewer?.role || null,
      roleMeta: ROLE_META,
      roleCounts: room.phase === "lobby" ? getRoleCounts(room.settings.capacity, room.settings.roles) : null,
      availableNightAction: getAvailableNightAction(room, viewer),
      voteState: getVoteState(room, viewer),
      events: room.events,
      privateLog: room.privateLog[viewerId] || [],
      chat: filteredChat,
      lastNightResult: room.lastNightResult,
      lastVoteResult: room.lastVoteResult,
      winner: room.winner,
      voice: {
        enabled: room.settings.communication === "voice",
        signaling: "Socket.IO signaling channel is reserved; WebRTC media can be attached here."
      }
    };
  }

  function getAvailableNightAction(room, viewer) {
    if (!viewer || room.phase !== "night" || !viewer.alive) return null;
    if (isMafiaRole(viewer.role)) {
      return {
        action: "kill",
        label: "Убить",
        selectedTargetId: room.actions.mafia[viewer.id] || null
      };
    }
    if (viewer.role === "commissioner") {
      return {
        action: "inspect",
        label: "Проверить",
        selectedTargetId: room.actions.commissioner[viewer.id] || null
      };
    }
    if (viewer.role === "doctor") {
      return {
        action: "heal",
        label: "Лечить",
        selectedTargetId: room.actions.doctor[viewer.id] || null
      };
    }
    return null;
  }

  function getVoteState(room, viewer) {
    if (!viewer || room.phase !== "voting") return null;
    const counts = Object.values(room.votes).reduce((acc, targetId) => {
      acc[targetId] = (acc[targetId] || 0) + 1;
      return acc;
    }, {});
    return {
      votedTargetId: room.votes[viewer.id] || null,
      counts
    };
  }

  function getStartBlockers(room) {
    const blockers = [];
    const playerCount = room.players.length;
    if (playerCount < 5) blockers.push("Нужно минимум 5 игроков.");
    if (playerCount > room.settings.capacity) blockers.push("Игроков больше, чем мест в комнате.");
    const notReady = room.players.filter((player) => !player.ready);
    if (notReady.length) blockers.push("Все игроки должны нажать «Готов».");
    return blockers;
  }

  function areNightActionsComplete(room) {
    const alive = room.players.filter((player) => player.alive);
    const mafia = alive.filter((player) => isMafiaRole(player.role));
    const commissioners = alive.filter((player) => player.role === "commissioner");
    const doctors = alive.filter((player) => player.role === "doctor");
    const mafiaDone = mafia.length === 0 || mafia.every((player) => room.actions.mafia[player.id]);
    const commissionerDone = commissioners.every((player) => room.actions.commissioner[player.id]);
    const doctorDone = doctors.every((player) => room.actions.doctor[player.id]);
    return mafiaDone && commissionerDone && doctorDone;
  }

  function addEvent(room, text) {
    room.events.push({
      id: randomUUID(),
      text,
      at: Date.now()
    });
    room.events = room.events.slice(-MAX_EVENTS);
  }

  function addChat(room, message) {
    room.chat.push({
      id: randomUUID(),
      at: Date.now(),
      ...message
    });
    room.chat = room.chat.slice(-MAX_CHAT);
  }

  function addPrivate(room, playerId, text) {
    if (!room.privateLog[playerId]) room.privateLog[playerId] = [];
    room.privateLog[playerId].push({
      id: randomUUID(),
      text,
      at: Date.now()
    });
    room.privateLog[playerId] = room.privateLog[playerId].slice(-60);
  }

  function addMafiaPrivate(room, text) {
    for (const player of room.players) {
      if (player.alive && isMafiaRole(player.role)) addPrivate(room, player.id, text);
    }
  }

  function getActor(payload, socket) {
    const room = getRoom(payload.roomCode);
    const link = socketLinks.get(socket.id);
    const playerId = payload.playerId || link?.playerId;
    const player = room.players.find((item) => item.id === playerId);
    if (!player) throw new Error("Игрок не найден в комнате.");
    if (player.socketId !== socket.id && !player.isBot) {
      player.socketId = socket.id;
      player.connected = true;
      socketLinks.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(room.code);
    }
    return { room, player };
  }

  function getRoom(roomCode) {
    const code = String(roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error("Комната не найдена.");
    return room;
  }

  function reconnectKnownPlayer(room, playerId, socket) {
    if (!playerId) return null;
    const player = room.players.find((item) => item.id === playerId && !item.isBot);
    if (!player) return null;
    player.socketId = socket.id;
    player.connected = true;
    player.speaking = false;
    socket.join(room.code);
    socketLinks.set(socket.id, { roomCode: room.code, playerId: player.id });
    return player;
  }

  function ensureCreator(room, player) {
    if (room.creatorId !== player.id) throw new Error("Это действие доступно только создателю комнаты.");
  }

  function ensureLobby(room) {
    if (room.phase !== "lobby") throw new Error("Настройки доступны только в лобби.");
  }

  function createEmptyActions() {
    return {
      mafia: {},
      commissioner: {},
      doctor: {}
    };
  }

  function createPlayer({ socketId, nickname, avatar, isCreator = false }) {
    return {
      id: randomUUID(),
      socketId,
      name: nickname,
      avatar: avatar || createAvatar(nickname),
      ready: false,
      alive: true,
      connected: true,
      isCreator,
      isBot: false,
      role: null,
      micOn: false,
      speaking: false
    };
  }

  function createBot(room) {
    const index = room.players.length;
    const name = BOT_NAMES[index % BOT_NAMES.length];
    return {
      id: `bot-${randomUUID()}`,
      socketId: null,
      name,
      avatar: createAvatar(name),
      ready: true,
      alive: true,
      connected: true,
      isCreator: false,
      isBot: true,
      role: null,
      micOn: false,
      speaking: false
    };
  }

  function createAvatar(seed) {
    const hue = Math.abs(hashString(seed)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},70%,42%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},80%,18%)"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><circle cx="48" cy="37" r="17" fill="#f7dba7"/><path d="M21 84c5-22 49-22 54 0" fill="#111"/><path d="M25 32c8-18 39-18 46 0-9-6-35-6-46 0Z" fill="#1b1112"/><text x="48" y="63" text-anchor="middle" font-size="20" font-family="Arial" font-weight="700" fill="#f7dba7">${safeInitial(seed)}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function sanitizeSettings(input = {}) {
    const capacity = clamp(Number(input.capacity || 10), 5, 15);
    return {
      capacity,
      autoHost: input.autoHost !== false,
      communication: input.communication === "voice" ? "voice" : "text",
      roles: {
        civilian: true,
        mafia: true,
        don: input.roles?.don !== false,
        commissioner: input.roles?.commissioner !== false,
        doctor: input.roles?.doctor !== false
      }
    };
  }

  function normalizeName(value) {
    const name = String(value || "").trim().slice(0, 24);
    if (!name) throw new Error("Введите никнейм.");
    return name;
  }

  function normalizeRoomName(value) {
    const name = String(value || "").trim().slice(0, 36);
    return name || "Закрытый клуб";
  }

  function generateRoomCode() {
    let code = "";
    do {
      code = "";
      for (let i = 0; i < 6; i += 1) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
    } while (rooms.has(code));
    return code;
  }

  function getMajorityTarget(targetIds, allowTie = false) {
    const counts = targetIds.filter(Boolean).reduce((acc, targetId) => {
      acc[targetId] = (acc[targetId] || 0) + 1;
      return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return null;
    if (!allowTie && entries[1] && entries[1][1] === entries[0][1]) return entries[0][0];
    if (allowTie && entries[1] && entries[1][1] === entries[0][1]) return null;
    return entries[0][0];
  }

  function randomAlive(room, predicate = () => true) {
    const candidates = room.players.filter((player) => player.alive && predicate(player));
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function getFirstAlive(room) {
    return room.players.find((player) => player.alive) || null;
  }

  function clearRoomTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }

  function emitError(socket, message) {
    socket.emit("roomError", { message });
  }

  return {
    bindSocket,
    getStats: () => ({
      rooms: rooms.size,
      players: [...rooms.values()].reduce((sum, room) => sum + room.players.length, 0)
    })
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value) {
  return String(value).split("").reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) | 0;
  }, 7);
}

function safeInitial(value) {
  return String(value || "?").trim().slice(0, 1).toUpperCase().replace(/[<>&]/g, "");
}

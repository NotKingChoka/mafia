import { randomUUID } from "node:crypto";
import { allocateRoles, getRoleBalance, getRoleCounts, isHostileRole, isMafiaRole, ROLE_META } from "./roles.js";
import { createBotReply } from "./botBrain.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_EVENTS = 120;
const MAX_CHAT = 160;

const PHASE_LABELS = {
  lobby: "Лобби",
  roles: "Раздача ролей",
  night_wait: "Ожидание ночи",
  night: "Ночь",
  morning: "Утро",
  discussion: "Обсуждение",
  voting: "Голосование",
  finished: "Игра окончена"
};

const PHASE_DURATIONS = {
  roles: 0,
  night_wait: 0,
  night: Number(process.env.NIGHT_PHASE_SECONDS || 45),
  morning: Number(process.env.MORNING_PHASE_SECONDS || 20),
  discussion: Number(process.env.DISCUSSION_PHASE_SECONDS || 180),
  voting: Number(process.env.VOTING_PHASE_SECONDS || 30)
};

const DEFAULT_PHASE_DURATIONS = {
  night: PHASE_DURATIONS.night,
  discussion: PHASE_DURATIONS.discussion,
  voting: PHASE_DURATIONS.voting,
  morning: PHASE_DURATIONS.morning
};
const DEFAULT_SPEAKER_DURATION = 90;
const ABSTAIN_VOTE = "__abstain__";
const TYPING_TTL_MS = 2600;

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

const BOT_AVATARS = Array.from({ length: 10 }, (_, index) => `/avatars/avatar-${String(index + 1).padStart(2, "0")}.png`);

const BOT_PHRASES = [
  "Я бы присмотрелся к {target}. Слишком спокойно сидит.",
  "{target} сейчас звучит подозрительно.",
  "Не спешите голосовать. Кто-то явно ведет город не туда.",
  "Мне кажется, мафия пытается спрятаться в тишине.",
  "{target}, объясни свою позицию подробнее.",
  "После этой ночи надо сравнить, кто как голосовал.",
  "Я пока не уверен, но один игрок явно меняет версию.",
  "Давайте без хаоса: сначала факты, потом обвинения."
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
        touchPlayer(player);
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
        touchPlayer(player);
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
        touchPlayer(player);
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
        touchPlayer(player);
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
        touchPlayer(player);
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
        touchPlayer(player);
        handleVote(room, player, payload.targetId);
        emitRoom(room);
        tryResolveVoting(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("abstainVote", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        handleAbstainVote(room, player);
        emitRoom(room);
        tryResolveVoting(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("skipVoting", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        ensureCreator(room, player);
        skipVoting(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("sendChat", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        const text = String(payload.text || "").trim().slice(0, 600);
        if (!text) return;
        const channel = normalizeChatChannel(room, player, payload.channel);
        clearTyping(player);
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

    socket.on("chatTyping", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        updateTyping(room, player, payload);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("voiceState", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
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
        touchPlayer(player);
        ensureCreator(room, player);
        advanceRoomPhase(room, "manual");
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("passSpeaker", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        passSpeaker(room, player, payload.targetId);
        emitRoom(room);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("finishSpeech", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        finishSpeech(room, player);
        emitRoom(room);
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

    socket.on("kickPlayer", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        ensureCreator(room, player);
        kickPlayer(room, player, payload.targetId);
      } catch (error) {
        emitError(socket, error.message);
      }
    });

    socket.on("replayGame", (payload = {}) => {
      try {
        const { room, player } = getActor(payload, socket);
        touchPlayer(player);
        ensureCreator(room, player);
        replayGame(room);
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
      clearTyping(player);
      clearTyping(player);
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
      activeSpeakerStartedAt: 0,
      activeSpeakerDuration: 0,
      speakerOrder: [],
      speakerIndex: 0,
      speakerTimer: null,
      actions: createEmptyActions(),
      votes: {},
      votingOrder: [],
      events: [],
      chat: [],
      privateLog: {},
      lastNightResult: null,
      lastVoteResult: null,
      winner: null,
      timer: null,
      botTalkTimer: null,
      botTalkStarter: null,
      botTalkInFlight: false,
      doctorLastHeals: {},
      doctorSelfHeals: {},
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
      player.kicked = false;
      clearTyping(player);
      touchPlayer(player);
    });
    room.round = 1;
    room.privateLog = {};
    room.chat = [];
    room.lastNightResult = null;
    room.lastVoteResult = null;
    room.winner = null;
    room.votes = {};
    room.votingOrder = [];
    room.doctorLastHeals = {};
    room.doctorSelfHeals = {};
    room.activeSpeakerId = null;
    room.activeSpeakerStartedAt = 0;
    room.activeSpeakerDuration = 0;
    room.speakerOrder = [];
    room.speakerIndex = 0;
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
    room.phaseDuration = getPhaseDuration(room, phase);
    if (phase !== "discussion") resetDiscussionQueue(room);

    if (phase === "night") {
      room.actions = createEmptyActions();
      room.activeSpeakerId = null;
      addEvent(room, `Раунд ${room.round}. Наступила ночь.`);
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text:
          room.round === 1
            ? "Наступила первая ночь. В эту ночь нет голосования мафии и убийств."
            : "Наступила ночь. Ночные роли выбирают цели."
      });
      if (room.round > 1) runBotNightActions(room);
    }

    if (phase === "night_wait") {
      room.activeSpeakerId = null;
      addEvent(room, "Создатель решает, когда начнется следующая ночь.");
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: "Город замер. Ночь начнется только по команде создателя комнаты."
      });
    }

    if (phase === "morning") {
      room.activeSpeakerId = getFirstAlive(room)?.id || null;
    }

    if (phase === "discussion") {
      addEvent(room, "Началось обсуждение.");
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: "Началось обсуждение."
      });
      startDiscussionQueue(room);
    }

    if (phase === "voting") {
      room.votes = {};
      room.votingOrder = [];
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
    if (room.phase === "roles" || room.phase === "night_wait") {
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
      finishDiscussion(room);
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

    if (payload.action === "maniackill") {
      if (player.role !== "maniac") throw new Error("Так действует только маньяк.");
      if (target.id === player.id) throw new Error("Нельзя выбрать себя.");
      room.actions.maniac[player.id] = target.id;
      addPrivate(room, player.id, `Вы выбрали жертву: ${target.name}.`);
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
      validateDoctorTarget(room, player, target);
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
    room.votingOrder.push({
      voterId: player.id,
      voterName: player.name,
      targetId: target.id,
      targetName: target.name,
      at: Date.now()
    });
    addEvent(room, `${player.name} проголосовал.`);
  }

  function handleAbstainVote(room, player) {
    if (room.phase !== "voting") throw new Error("Сейчас не идет голосование.");
    if (!player.alive) throw new Error("Мертвый игрок не может голосовать.");
    if (room.votes[player.id]) throw new Error("Вы уже проголосовали.");
    room.votes[player.id] = ABSTAIN_VOTE;
    room.votingOrder.push({
      voterId: player.id,
      voterName: player.name,
      targetId: null,
      targetName: "Воздержался",
      abstained: true,
      at: Date.now()
    });
    addEvent(room, `${player.name} воздержался от голосования.`);
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
    if (room.round === 1) {
      const text = "Первая ночь прошла без голосования мафии и убийств.";
      room.lastNightResult = { text, killedId: null };
      addEvent(room, text);
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text
      });
      startPhase(room, "morning");
      return;
    }

    const mafiaTargetId = getMajorityTarget(Object.values(room.actions.mafia));
    const maniacTargetIds = [...new Set(Object.values(room.actions.maniac).filter(Boolean))];
    const doctorTargetId = Object.values(room.actions.doctor)[0] || null;
    const target = mafiaTargetId ? room.players.find((player) => player.id === mafiaTargetId) : null;

    let text = "Этой ночью никто не умер.";
    let killedId = null;
    const killedIds = [];
    if (target && target.alive) {
      if (doctorTargetId === target.id) {
        text = "Этой ночью никто не умер. Доктор успел спасти жертву.";
      } else {
        target.alive = false;
        target.speaking = false;
        killedId = target.id;
        killedIds.push(target.id);
        text = formatEliminationText(room, target, "погиб этой ночью");
      }
    }

    for (const targetId of maniacTargetIds) {
      const maniacTarget = room.players.find((player) => player.id === targetId);
      if (!maniacTarget || !maniacTarget.alive || doctorTargetId === maniacTarget.id) continue;
      maniacTarget.alive = false;
      maniacTarget.speaking = false;
      killedIds.push(maniacTarget.id);
    }

    if (killedIds.length > 1) {
      const names = killedIds
        .map((id) => room.players.find((player) => player.id === id))
        .filter(Boolean)
        .map((player) => formatEliminationText(room, player, "погиб"))
        .join("; ");
      text = `Этой ночью: ${names}.`;
    }

    room.lastNightResult = { text, killedId, killedIds };
    rememberDoctorHeals(room);
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
    const targetId = getMajorityTarget(Object.values(room.votes).filter((targetId) => targetId !== ABSTAIN_VOTE), true);
    const target = targetId ? room.players.find((player) => player.id === targetId) : null;
    const rows = getVoteRows(room);
    let text = "Голосование закончилось без изгнания.";

    if (target && target.alive) {
      target.alive = false;
      target.speaking = false;
      text = formatEliminationText(room, target, "выбыл по итогам голосования");
    }

    room.lastVoteResult = {
      text,
      votes: { ...room.votes },
      rows,
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
    startPhase(room, "night_wait");
  }

  function skipVoting(room) {
    if (room.phase !== "voting") throw new Error("Пропустить можно только фазу голосования.");
    clearRoomTimer(room);
    room.votes = {};
    const text = "Создатель пропустил голосование. Никто не выбыл.";
    room.lastVoteResult = {
      text,
      votes: {},
      rows: getVoteRows(room),
      eliminatedId: null,
      skipped: true
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
    startPhase(room, "night_wait");
  }

  function finishDiscussion(room) {
    if (room.round <= 2) {
      clearRoomTimer(room);
      const text = `День ${room.round}: голосования нет. Город переходит к следующей ночи.`;
      room.lastVoteResult = {
        text,
        votes: {},
        rows: [],
        eliminatedId: null,
        skipped: true,
        earlyDay: true
      };
      addEvent(room, text);
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text
      });
      room.round += 1;
      startPhase(room, "night_wait");
      return;
    }
    startPhase(room, "voting");
  }

  function checkVictory(room) {
    const alive = room.players.filter((player) => player.alive);
    const maniacAlive = alive.filter((player) => player.role === "maniac").length;
    if (maniacAlive > 0 && alive.length === maniacAlive) {
      finishRoom(room, {
        team: "maniac",
        title: "Маньяк победил",
        text: "За столом не осталось никого, кроме маньяка."
      });
      return true;
    }
    const mafiaAlive = alive.filter((player) => isMafiaRole(player.role)).length;
    const cityAlive = alive.filter((player) => !isHostileRole(player.role)).length;
    if (mafiaAlive === 0 && maniacAlive === 0) {
      finishRoom(room, {
        team: "city",
        title: "Мирные жители победили",
        text: "Вся мафия уничтожена."
      });
      return true;
    }
    if (mafiaAlive >= cityAlive + maniacAlive) {
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
    resetDiscussionQueue(room);
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

  function replayGame(room) {
    clearRoomTimer(room);
    room.phase = "lobby";
    room.round = 0;
    room.phaseStartedAt = Date.now();
    room.phaseDuration = 0;
    room.activeSpeakerId = null;
    room.activeSpeakerStartedAt = 0;
    room.activeSpeakerDuration = 0;
    room.speakerOrder = [];
    room.speakerIndex = 0;
    room.actions = createEmptyActions();
    room.votes = {};
    room.votingOrder = [];
    room.events = [];
    room.chat = [];
    room.privateLog = {};
    room.doctorLastHeals = {};
    room.doctorSelfHeals = {};
    room.lastNightResult = null;
    room.lastVoteResult = null;
    room.winner = null;
    room.players = room.players.filter((player) => !player.kicked);
    room.players.forEach((player) => {
      player.role = null;
      player.alive = true;
      player.ready = player.isBot;
      player.speaking = false;
      player.micOn = false;
      clearTyping(player);
      touchPlayer(player);
    });
    addEvent(room, "Комната готова к новой партии с теми же игроками.");
    emitRoom(room);
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

  function kickPlayer(room, actor, targetId) {
    const target = room.players.find((player) => player.id === targetId);
    if (!target) throw new Error("Игрок не найден.");
    if (target.id === actor.id) throw new Error("Нельзя кикнуть себя.");
    target.kicked = true;
    target.connected = false;
    target.socketId = null;
    target.speaking = false;
    clearTyping(target);
    if (room.phase === "lobby") {
      room.players = room.players.filter((player) => player.id !== target.id);
      addEvent(room, `${target.name} кикнут из комнаты.`);
    } else {
      target.alive = false;
      addEvent(room, `${target.name} кикнут создателем и выбыл из партии.`);
      checkVictory(room);
      if (room.phase === "discussion" && room.activeSpeakerId === target.id) advanceSpeaker(room);
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

  function startDiscussionQueue(room) {
    room.speakerOrder = room.players.filter((player) => player.alive).map((player) => player.id);
    room.speakerIndex = 0;
    room.activeSpeakerDuration = getSpeakerDuration(room);
    activateSpeaker(room, 0);
  }

  function activateSpeaker(room, index) {
    if (room.phase !== "discussion") return;
    const aliveOrder = room.speakerOrder.filter((id) => room.players.some((player) => player.id === id && player.alive));
    room.speakerOrder = aliveOrder;
    if (!aliveOrder.length || index >= aliveOrder.length) {
      finishDiscussion(room);
      return;
    }

    room.speakerIndex = index;
    room.activeSpeakerId = aliveOrder[index];
    room.activeSpeakerStartedAt = Date.now();
    room.activeSpeakerDuration = getSpeakerDuration(room);
    for (const player of room.players) {
      player.speaking = player.id === room.activeSpeakerId;
    }

    const speaker = room.players.find((player) => player.id === room.activeSpeakerId);
    if (speaker) {
      addEvent(room, `Слово получает ${speaker.name}.`);
      addChat(room, {
        type: "system",
        channel: "alive",
        playerName: "Система",
        text: `Сейчас говорит ${speaker.name}.`
      });
      queueActiveBotTalk(room);
    }
    scheduleSpeakerTurn(room);
  }

  function scheduleSpeakerTurn(room) {
    clearSpeakerTimer(room);
    if (room.phase !== "discussion" || !room.activeSpeakerId || !room.activeSpeakerDuration) return;
    room.speakerTimer = setTimeout(() => {
      advanceSpeaker(room);
      emitRoom(room);
    }, room.activeSpeakerDuration * 1000);
    room.speakerTimer.unref?.();
  }

  function advanceSpeaker(room) {
    if (room.phase !== "discussion") return;
    clearBotTalkTimer(room);
    activateSpeaker(room, room.speakerIndex + 1);
  }

  function finishSpeech(room, actor) {
    if (room.phase !== "discussion") throw new Error("Закончить речь можно только во время обсуждения.");
    if (!actor.alive) throw new Error("Мертвый игрок не может заканчивать речь.");
    if (room.activeSpeakerId !== actor.id) throw new Error("Закончить речь может только текущий говорящий.");
    addEvent(room, `${actor.name} закончил речь.`);
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text: `${actor.name} закончил речь.`
    });
    advanceSpeaker(room);
  }

  function passSpeaker(room, actor, targetId) {
    if (room.phase !== "discussion") throw new Error("Передать слово можно только во время обсуждения.");
    if (!actor.alive) throw new Error("Мертвый игрок не может передавать слово.");
    if (room.activeSpeakerId !== actor.id) throw new Error("Передать слово может только текущий говорящий.");
    const target = room.players.find((player) => player.id === targetId);
    if (!target || !target.alive) throw new Error("Игрок для передачи слова недоступен.");
    if (target.id === actor.id) throw new Error("Нельзя передать слово себе.");

    const aliveOrder = room.speakerOrder.filter((id) => room.players.some((player) => player.id === id && player.alive));
    const currentIndex = aliveOrder.indexOf(actor.id);
    const targetIndex = aliveOrder.indexOf(target.id);
    if (currentIndex < 0 || targetIndex < 0) throw new Error("Очередь обсуждения уже изменилась.");
    if (targetIndex <= currentIndex) throw new Error("Этому игроку уже давали слово в этом круге.");

    const finished = aliveOrder.slice(0, currentIndex + 1);
    const remaining = aliveOrder.slice(currentIndex + 1).filter((id) => id !== target.id);
    room.speakerOrder = [...finished, target.id, ...remaining];
    addEvent(room, `${actor.name} передал слово игроку ${target.name}.`);
    addChat(room, {
      type: "system",
      channel: "alive",
      playerName: "Система",
      text: `${actor.name} передал слово игроку ${target.name}.`
    });
    activateSpeaker(room, finished.length);
  }

  function resetDiscussionQueue(room) {
    clearSpeakerTimer(room);
    room.activeSpeakerId = null;
    room.speakerOrder = [];
    room.speakerIndex = 0;
    room.activeSpeakerStartedAt = 0;
    room.activeSpeakerDuration = 0;
    for (const player of room.players) player.speaking = false;
  }

  function getSpeakerDuration(room) {
    return clamp(Number(room.settings.speakerDuration || DEFAULT_SPEAKER_DURATION), 15, 300);
  }

  function validateDoctorTarget(room, doctor, target) {
    const allowed = getDoctorHealCandidates(room, doctor).some((player) => player.id === target.id);
    if (!allowed) {
      if (target.id === doctor.id && room.doctorSelfHeals[doctor.id]) {
        throw new Error("Доктор уже лечил себя в этой игре.");
      }
      if (room.doctorLastHeals[doctor.id] === target.id) {
        throw new Error("Доктор не может лечить одного и того же игрока две ночи подряд.");
      }
      throw new Error("Доктор не может выбрать эту цель.");
    }
  }

  function getDoctorHealCandidates(room, doctor) {
    if (!doctor || doctor.role !== "doctor" || !doctor.alive) return [];
    return room.players.filter((player) => {
      if (!player.alive) return false;
      if (room.doctorLastHeals[doctor.id] === player.id) return false;
      if (player.id === doctor.id && room.doctorSelfHeals[doctor.id]) return false;
      return true;
    });
  }

  function rememberDoctorHeals(room) {
    for (const [doctorId, targetId] of Object.entries(room.actions.doctor || {})) {
      if (!targetId) continue;
      room.doctorLastHeals[doctorId] = targetId;
      if (doctorId === targetId) room.doctorSelfHeals[doctorId] = true;
    }
  }

  function runBotNightActions(room) {
    for (const bot of room.players.filter((player) => player.isBot && player.alive)) {
      if (isMafiaRole(bot.role)) {
        const target = randomAlive(room, (player) => !isMafiaRole(player.role));
        if (target) room.actions.mafia[bot.id] = target.id;
      }
      if (bot.role === "maniac") {
        const target = randomAlive(room, (player) => player.id !== bot.id);
        if (target) room.actions.maniac[bot.id] = target.id;
      }
      if (bot.role === "commissioner") {
        const target = randomAlive(room, (player) => player.id !== bot.id);
        if (target) room.actions.commissioner[bot.id] = target.id;
      }
      if (bot.role === "doctor") {
        const candidates = getDoctorHealCandidates(room, bot);
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        if (target) room.actions.doctor[bot.id] = target.id;
      }
    }
  }

  function runBotVotes(room) {
    for (const bot of room.players.filter((player) => player.isBot && player.alive)) {
      const target = randomAlive(room, (player) => player.id !== bot.id);
      if (target) {
        room.votes[bot.id] = target.id;
        room.votingOrder.push({
          voterId: bot.id,
          voterName: bot.name,
          targetId: target.id,
          targetName: target.name,
          at: Date.now()
        });
      }
    }
  }

  function queueActiveBotTalk(room) {
    clearBotTalkTimer(room);
    if (!room.settings.botTalk) return;
    const bot = room.players.find((player) => player.id === room.activeSpeakerId && player.isBot && player.alive);
    if (!bot) return;
    room.botTalkStarter = setTimeout(() => botTalkTick(room), 1600);
    room.botTalkStarter.unref?.();
  }

  async function botTalkTick(room) {
    if (room.phase !== "discussion" || !room.settings.botTalk) {
      clearBotTalkTimer(room);
      return;
    }
    if (room.botTalkInFlight) return;

    const bot = room.players.find((player) => player.id === room.activeSpeakerId && player.isBot && player.alive);
    if (!bot) {
      clearBotTalkTimer(room);
      return;
    }

    room.players.forEach((player) => {
      if (player.isBot) player.speaking = false;
    });
    bot.speaking = true;
    room.activeSpeakerId = bot.id;
    room.botTalkInFlight = true;
    emitRoom(room);

    const text = await createBotReply({
      room,
      bot,
      roleMeta: ROLE_META,
      fallbackText: createBotPhrase(room, bot)
    });

    if (room.phase !== "discussion" || room.activeSpeakerId !== bot.id) {
      bot.speaking = false;
      room.botTalkInFlight = false;
      return;
    }

    addChat(room, {
      type: "player",
      channel: "alive",
      playerId: bot.id,
      playerName: bot.name,
      text
    });
    room.botTalkInFlight = false;
    emitRoom(room);

    setTimeout(() => {
      if (room.phase !== "discussion" || room.activeSpeakerId !== bot.id) return;
      bot.speaking = false;
      emitRoom(room);
    }, 2600).unref?.();
  }

  function createBotPhrase(room, bot) {
    const target = randomAlive(room, (player) => player.id !== bot.id);
    const phrase = BOT_PHRASES[Math.floor(Math.random() * BOT_PHRASES.length)];
    return phrase.replace("{target}", target?.name || "кто-то");
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
    const filteredChat = room.chat.filter((message) => canReadChatMessage(room, viewer, message));

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
      discussionTurn: getDiscussionTurn(room, viewer),
      creatorId: room.creatorId,
      hostId: room.hostId,
      canStart: getStartBlockers(room).length === 0,
      startBlockers: getStartBlockers(room),
      players: room.players.map((player) => {
        const canSeeRole =
          revealAllRoles ||
          player.id === viewerId ||
          room.phase === "finished" ||
          (!player.alive && room.settings.revealRoleOnDeath) ||
          (isMafiaRole(viewer?.role) && isMafiaRole(player.role));
        return {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          ready: player.ready,
          alive: player.alive,
          connected: player.connected,
          afk: isAfk(player),
          lastActiveAt: player.lastActiveAt,
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
      roleBalance: room.phase === "lobby" ? getRoleBalance(room.settings.capacity, room.settings.roles) : null,
      availableNightAction: getAvailableNightAction(room, viewer),
      voteState: getVoteState(room, viewer),
      gameStats: getGameStats(room),
      events: room.events,
      privateLog: room.privateLog[viewerId] || [],
      chat: filteredChat,
      typing: getTypingUsers(room, viewer),
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
    if (room.round === 1) return null;
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
      const allowedTargets = getDoctorHealCandidates(room, viewer).map((player) => player.id);
      if (!allowedTargets.length) return null;
      return {
        action: "heal",
        label: "Лечить",
        allowedTargetIds: allowedTargets,
        selectedTargetId: room.actions.doctor[viewer.id] || null
      };
    }
    if (viewer.role === "maniac") {
      return {
        action: "maniackill",
        label: "Убить",
        selectedTargetId: room.actions.maniac[viewer.id] || null
      };
    }
    return null;
  }

  function getVoteState(room, viewer) {
    if (!viewer || room.phase !== "voting") return null;
    const counts = Object.values(room.votes).filter((targetId) => targetId !== ABSTAIN_VOTE).reduce((acc, targetId) => {
      acc[targetId] = (acc[targetId] || 0) + 1;
      return acc;
    }, {});
    return {
      votedTargetId: room.votes[viewer.id] === ABSTAIN_VOTE ? null : room.votes[viewer.id] || null,
      hasVoted: Boolean(room.votes[viewer.id]),
      abstained: room.votes[viewer.id] === ABSTAIN_VOTE,
      abstainCount: Object.values(room.votes).filter((targetId) => targetId === ABSTAIN_VOTE).length,
      counts,
      rows: getVoteRows(room)
    };
  }

  function getDiscussionTurn(room, viewer) {
    if (room.phase !== "discussion" || !room.activeSpeakerId) return null;
    const speaker = room.players.find((player) => player.id === room.activeSpeakerId);
    return {
      activeSpeakerId: room.activeSpeakerId,
      activeSpeakerName: speaker?.name || "",
      index: room.speakerIndex,
      total: room.speakerOrder.length,
      remainingSpeakerIds: room.speakerOrder.slice(room.speakerIndex + 1),
      canPassSpeaker: Boolean(viewer?.alive && viewer.id === room.activeSpeakerId),
      startedAt: room.activeSpeakerStartedAt,
      duration: room.activeSpeakerDuration
    };
  }

  function getStartBlockers(room) {
    const blockers = [];
    const playerCount = room.players.length;
    if (playerCount < 1) blockers.push("Нужен минимум 1 игрок.");
    if (playerCount > room.settings.capacity) blockers.push("Игроков больше, чем мест в комнате.");
    const notReady = room.players.filter((player) => !player.ready);
    if (notReady.length) blockers.push("Все игроки должны нажать «Готов».");
    return blockers;
  }

  function areNightActionsComplete(room) {
    const alive = room.players.filter((player) => player.alive);
    const mafia = alive.filter((player) => isMafiaRole(player.role));
    const maniacs = alive.filter((player) => player.role === "maniac");
    const commissioners = alive.filter((player) => player.role === "commissioner");
    const doctors = alive.filter((player) => player.role === "doctor");
    const mafiaDone = mafia.length === 0 || mafia.every((player) => room.actions.mafia[player.id]);
    const maniacDone = maniacs.every((player) => room.actions.maniac[player.id]);
    const commissionerDone = commissioners.every((player) => room.actions.commissioner[player.id]);
    const doctorDone = doctors.every((player) => room.actions.doctor[player.id] || getDoctorHealCandidates(room, player).length === 0);
    return mafiaDone && maniacDone && commissionerDone && doctorDone;
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

  function updateTyping(room, player, payload) {
    const isTyping = Boolean(payload.typing);
    if (!isTyping) {
      clearTyping(player);
      return;
    }
    const channel = normalizeChatChannel(room, player, payload.channel);
    player.typingChannel = channel;
    player.typingUntil = Date.now() + TYPING_TTL_MS;
    if (player.typingTimer) clearTimeout(player.typingTimer);
    player.typingTimer = setTimeout(() => {
      clearTyping(player);
      emitRoom(room);
    }, TYPING_TTL_MS + 100);
    player.typingTimer.unref?.();
  }

  function clearTyping(player) {
    if (!player) return;
    if (player.typingTimer) clearTimeout(player.typingTimer);
    player.typingTimer = null;
    player.typingUntil = 0;
    player.typingChannel = null;
  }

  function getTypingUsers(room, viewer) {
    const now = Date.now();
    return room.players
      .filter((player) => player.id !== viewer?.id && player.typingUntil > now)
      .filter((player) => canReadChatMessage(room, viewer, { channel: player.typingChannel || "alive" }))
      .map((player) => ({
        id: player.id,
        name: player.name,
        channel: player.typingChannel || "alive"
      }));
  }

  function normalizeChatChannel(room, player, requestedChannel) {
    if (requestedChannel === "mafia") {
      if (room.phase !== "night") throw new Error("Чат мафии доступен ночью.");
      if (!player.alive || !isMafiaRole(player.role)) throw new Error("Чат мафии доступен только мафии и дону.");
      return "mafia";
    }
    if (requestedChannel === "dead") {
      if (player.alive && room.phase !== "finished") throw new Error("Чат мертвых доступен только выбывшим.");
      return "dead";
    }
    if (!player.alive && room.phase !== "lobby" && room.phase !== "finished") return "dead";
    return "alive";
  }

  function canReadChatMessage(room, viewer, message) {
    if (!viewer) return message.channel === "alive";
    if (message.channel === "mafia") return room.phase === "finished" || isMafiaRole(viewer.role);
    if (message.channel === "dead") return room.phase === "finished" || !viewer.alive;
    return true;
  }

  function getVoteRows(room) {
    const rows = room.votingOrder.map((vote, index) => ({
      ...vote,
      index: index + 1
    }));
    if (room.phase === "voting" || room.lastVoteResult) {
      for (const player of room.players.filter((item) => item.alive)) {
        if (!room.votes[player.id] && !rows.some((row) => row.voterId === player.id)) {
          rows.push({
            voterId: player.id,
            voterName: player.name,
            targetId: null,
            targetName: "Пропуск",
            skipped: true,
            index: rows.length + 1
          });
        }
      }
    }
    return rows;
  }

  function getGameStats(room) {
    const deaths = room.players.filter((player) => !player.alive).length;
    return {
      rounds: room.round,
      deaths,
      alive: room.players.filter((player) => player.alive).length,
      totalVotes: Object.keys(room.votes || {}).length,
      winner: room.winner
    };
  }

  function getPhaseDuration(room, phase) {
    if (!room.settings.autoHost) return 0;
    if (phase === "discussion") {
      const aliveCount = room.players.filter((player) => player.alive).length;
      const queueDuration = aliveCount * getSpeakerDuration(room);
      const baseDuration = room.settings.phaseDurations?.discussion || PHASE_DURATIONS.discussion || 0;
      return Math.max(baseDuration, queueDuration);
    }
    if (phase === "night" || phase === "discussion" || phase === "voting" || phase === "morning") {
      return room.settings.phaseDurations?.[phase] || PHASE_DURATIONS[phase] || 0;
    }
    return PHASE_DURATIONS[phase] || 0;
  }

  function formatEliminationText(room, player, prefix) {
    if (!room.settings.revealRoleOnDeath) return `${player.name} ${prefix}. Его роль не раскрывается.`;
    return `${player.name} ${prefix}. Его роль: ${ROLE_META[player.role]?.title || "неизвестно"}.`;
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
      maniac: {},
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
      speaking: false,
      lastActiveAt: Date.now(),
      typingUntil: 0,
      typingChannel: null,
      typingTimer: null,
      kicked: false
    };
  }

  function createBot(room) {
    const index = room.players.length;
    const name = BOT_NAMES[index % BOT_NAMES.length];
    return {
      id: `bot-${randomUUID()}`,
      socketId: null,
      name,
      avatar: BOT_AVATARS[index % BOT_AVATARS.length] || createAvatar(name),
      ready: true,
      alive: true,
      connected: true,
      isCreator: false,
      isBot: true,
      role: null,
      micOn: false,
      speaking: false,
      lastActiveAt: Date.now(),
      typingUntil: 0,
      typingChannel: null,
      typingTimer: null,
      kicked: false
    };
  }

  function createAvatar(seed) {
    const hue = Math.abs(hashString(seed)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},70%,42%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},80%,18%)"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><circle cx="48" cy="37" r="17" fill="#f7dba7"/><path d="M21 84c5-22 49-22 54 0" fill="#111"/><path d="M25 32c8-18 39-18 46 0-9-6-35-6-46 0Z" fill="#1b1112"/><text x="48" y="63" text-anchor="middle" font-size="20" font-family="Arial" font-weight="700" fill="#f7dba7">${safeInitial(seed)}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function sanitizeSettings(input = {}) {
    const capacity = clamp(Number(input.capacity || 10), 1, 15);
    return {
      capacity,
      autoHost: input.autoHost !== false,
      communication: input.communication === "voice" ? "voice" : "text",
      botTalk: Boolean(input.botTalk),
      soundEnabled: input.soundEnabled !== false,
      revealRoleOnDeath: input.revealRoleOnDeath !== false,
      phaseDurations: sanitizePhaseDurations(input.phaseDurations),
      speakerDuration: clamp(Number(input.speakerDuration || DEFAULT_SPEAKER_DURATION), 15, 300),
      roles: {
        civilian: true,
        mafia: true,
        don: input.roles?.don !== false,
        commissioner: input.roles?.commissioner !== false,
        doctor: input.roles?.doctor !== false,
        maniac: input.roles?.maniac === true,
        counts: sanitizeRoleCounts(input.roles?.counts, capacity)
      }
    };
  }

  function sanitizePhaseDurations(input = {}) {
    return {
      night: clamp(Number(input.night || DEFAULT_PHASE_DURATIONS.night), 15, 180),
      discussion: clamp(Number(input.discussion || DEFAULT_PHASE_DURATIONS.discussion), 30, 600),
      voting: clamp(Number(input.voting || DEFAULT_PHASE_DURATIONS.voting), 10, 180),
      morning: clamp(Number(input.morning || DEFAULT_PHASE_DURATIONS.morning), 5, 90)
    };
  }

  function sanitizeRoleCounts(input = {}, capacity = 10) {
    const balance = getRoleBalance(capacity, { counts: input });
    return {
      mafia: balance.counts.mafia || 1,
      don: balance.counts.don || 0,
      doctor: balance.counts.doctor || 0,
      commissioner: balance.counts.commissioner || 0,
      maniac: balance.counts.maniac || 0
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
    clearSpeakerTimer(room);
    clearBotTalkTimer(room);
  }

  function clearSpeakerTimer(room) {
    if (room.speakerTimer) clearTimeout(room.speakerTimer);
    room.speakerTimer = null;
  }

  function clearBotTalkTimer(room) {
    if (room.botTalkTimer) clearInterval(room.botTalkTimer);
    if (room.botTalkStarter) clearTimeout(room.botTalkStarter);
    room.botTalkTimer = null;
    room.botTalkStarter = null;
    room.botTalkInFlight = false;
  }

  function touchPlayer(player) {
    if (player) player.lastActiveAt = Date.now();
  }

  function isAfk(player) {
    if (player.isBot || !player.connected) return false;
    return Date.now() - (player.lastActiveAt || 0) > 120000;
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

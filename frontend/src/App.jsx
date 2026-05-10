import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Bot,
  ChevronDown,
  Check,
  Copy,
  Crown,
  Dice5,
  DoorOpen,
  Eye,
  Gavel,
  HeartPulse,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Moon,
  Move,
  Play,
  Send,
  Settings,
  ShieldCheck,
  Skull,
  Sparkles,
  Sun,
  Timer,
  UserPlus,
  Users,
  Vote,
  Wifi,
  WifiOff
} from "lucide-react";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:4000"
    : window.location.origin);
const STORAGE_KEY = "mafia-online-session";
const AVATAR_OPTIONS = Array.from({ length: 21 }, (_, index) => `/avatars/avatar-${String(index + 1).padStart(2, "0")}.png`);

const defaultSettings = {
  capacity: 10,
  autoHost: true,
  communication: "text",
  botTalk: false,
  soundEnabled: true,
  revealRoleOnDeath: true,
  speakerDuration: 90,
  phaseDurations: {
    night: 45,
    discussion: 180,
    voting: 30,
    morning: 20
  },
  roles: {
    civilian: true,
    mafia: true,
    don: true,
    commissioner: true,
    doctor: true,
    maniac: false,
    counts: {
      mafia: 2,
      don: 1,
      doctor: 1,
      commissioner: 1,
      maniac: 0
    }
  }
};

const roleIcons = {
  civilian: Users,
  mafia: Skull,
  don: Crown,
  commissioner: ShieldCheck,
  doctor: HeartPulse,
  maniac: Skull
};

const roleTone = {
  civilian: "city",
  mafia: "mafia",
  don: "mafia",
  commissioner: "law",
  doctor: "heal",
  maniac: "solo"
};

function App() {
  const socketRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("room") || "";
  });

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const saved = readSession();
      const roomFromUrl = new URLSearchParams(window.location.search).get("room");
      if (saved?.playerId && (roomFromUrl || saved.roomCode)) {
        socket.emit("rejoinRoom", {
          roomCode: roomFromUrl || saved.roomCode,
          playerId: saved.playerId
        });
      }
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("roomState", (state) => {
      setRoom(state);
      setError("");
      if (state.viewer?.id) {
        writeSession({
          roomCode: state.code,
          playerId: state.viewer.id
        });
        const nextUrl = `${window.location.pathname}?room=${state.code}`;
        window.history.replaceState(null, "", nextUrl);
      }
    });

    socket.on("roomError", (payload) => {
      setError(payload.message || "Неизвестная ошибка.");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  function emit(event, payload = {}) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(event, {
      roomCode: room?.code,
      playerId: room?.viewer?.id,
      ...payload
    });
  }

  function handleLeave() {
    emit("leaveRoom");
    clearSession();
    setRoom(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  return (
    <main className="app-shell">
      <AmbientBackdrop />
      <ConnectionBadge connected={connected} />
      {error ? <Toast message={error} onClose={() => setError("")} /> : null}

      {!room ? (
        <HomeScreen
          connected={connected}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          socket={socketRef.current}
        />
      ) : room.phase === "lobby" ? (
        <LobbyView room={room} emit={emit} onLeave={handleLeave} />
      ) : (
        <GameView room={room} emit={emit} onLeave={handleLeave} />
      )}
    </main>
  );
}

function HomeScreen({ connected, joinCode, setJoinCode, socket }) {
  const [mode, setMode] = useState(joinCode ? "join" : "create");
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("Закрытый клуб");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_OPTIONS[0]);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const fallbackAvatar = useMemo(() => createAvatar(nickname || "player"), [nickname]);

  async function createRoom() {
    setSubmitting(true);
    socket?.emit("createRoom", {
      nickname,
      avatar: await renderAvatarDataUrl(selectedAvatar, avatarZoom, fallbackAvatar),
      roomName,
      settings
    });
    setSubmitting(false);
  }

  async function joinRoom() {
    setSubmitting(true);
    socket?.emit("joinRoom", {
      roomCode: joinCode,
      nickname,
      avatar: await renderAvatarDataUrl(selectedAvatar, avatarZoom, fallbackAvatar),
      playerId: readSession()?.playerId
    });
    setSubmitting(false);
  }

  const canSubmit = connected && nickname.trim().length > 0;

  return (
    <section className="home-grid fade-in">
      <div className="hero-copy">
        <p className="eyebrow">Онлайн партия</p>
        <h1>Мафия</h1>
        <p className="hero-lead">
          Комнаты, роли, ночные действия, голосование и живой игровой стол для партии с друзьями.
        </p>
        <div className="hero-table-preview" aria-hidden="true">
          <img src="/stol.png" alt="" />
        </div>
      </div>

      <div className="entry-panel">
        <div className="mode-tabs" role="tablist" aria-label="Режим входа">
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
            <Sparkles size={18} /> Создать
          </button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>
            <DoorOpen size={18} /> Войти
          </button>
        </div>

        <div className="profile-row">
          <div className="avatar-preview">
            <img
              className="avatar-large"
              src={selectedAvatar}
              alt="Аватар"
              style={{ transform: `scale(${avatarZoom})` }}
            />
          </div>
          <button
            className="icon-button"
            type="button"
            title="Случайный аватар"
            onClick={() => setSelectedAvatar(AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)])}
          >
            <Dice5 size={20} />
          </button>
        </div>

        <label className="range-field avatar-zoom">
          <span>Приближение аватарки: {Math.round(avatarZoom * 100)}%</span>
          <input
            type="range"
            min="1"
            max="1.8"
            step="0.05"
            value={avatarZoom}
            onChange={(event) => setAvatarZoom(Number(event.target.value))}
          />
        </label>

        <div className="avatar-picker" aria-label="Выбор аватарки">
          {AVATAR_OPTIONS.map((avatarPath, index) => (
            <button
              key={avatarPath}
              className={selectedAvatar === avatarPath ? "avatar-option active" : "avatar-option"}
              type="button"
              title={`Аватар ${index + 1}`}
              onClick={() => setSelectedAvatar(avatarPath)}
            >
              <img src={avatarPath} alt="" />
            </button>
          ))}
        </div>

        <label className="field">
          <span>Никнейм</span>
          <input
            value={nickname}
            maxLength={24}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Например, Дон"
          />
        </label>

        {mode === "create" ? (
          <>
            <label className="field">
              <span>Название комнаты</span>
              <input value={roomName} maxLength={36} onChange={(event) => setRoomName(event.target.value)} />
            </label>
            <RoomSettingsForm settings={settings} onChange={setSettings} />
            <button className="primary-action" disabled={!canSubmit || submitting} onClick={createRoom}>
              <Play size={20} /> Создать комнату
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Код комнаты</span>
              <input
                value={joinCode}
                maxLength={8}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
              />
            </label>
            <button className="primary-action" disabled={!canSubmit || !joinCode.trim() || submitting} onClick={joinRoom}>
              <DoorOpen size={20} /> Присоединиться
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function RoomSettingsForm({ settings, onChange, compact = false }) {
  function update(next) {
    onChange({ ...settings, ...next });
  }

  function updateRole(role, value) {
    onChange({
      ...settings,
      roles: {
        ...settings.roles,
        [role]: value
      }
    });
  }

  function updateRoleCount(role, value) {
    onChange({
      ...settings,
      roles: {
        ...settings.roles,
        counts: {
          ...settings.roles.counts,
          [role]: Number(value)
        }
      }
    });
  }

  function updateDuration(phase, value) {
    onChange({
      ...settings,
      phaseDurations: {
        ...settings.phaseDurations,
        [phase]: Number(value)
      }
    });
  }

  const roleCounts = settings.roles.counts || defaultSettings.roles.counts;
  const civilians = Math.max(0, settings.capacity - Object.values(roleCounts).reduce((sum, value) => sum + Number(value || 0), 0));
  const warning = getRoleBalanceWarning(settings.capacity, roleCounts);

  return (
    <div className={compact ? "settings-form compact" : "settings-form"}>
      <label className="range-field">
        <span>Мест: {settings.capacity}</span>
        <input
          type="range"
          min="5"
          max="15"
          value={settings.capacity}
          onChange={(event) => update({ capacity: Number(event.target.value) })}
        />
      </label>

      <div className="switch-row">
        <span>Без ведущего</span>
        <button
          className={settings.autoHost ? "switch on" : "switch"}
          type="button"
          aria-pressed={settings.autoHost}
          onClick={() => update({ autoHost: !settings.autoHost })}
        >
          <span />
        </button>
      </div>

      <div className="switch-row">
        <span>Боты разговаривают</span>
        <button
          className={settings.botTalk ? "switch on" : "switch"}
          type="button"
          aria-pressed={settings.botTalk}
          onClick={() => update({ botTalk: !settings.botTalk })}
        >
          <span />
        </button>
      </div>

      <div className="switch-row">
        <span>Звуки и музыка</span>
        <button
          className={settings.soundEnabled ? "switch on" : "switch"}
          type="button"
          aria-pressed={settings.soundEnabled}
          onClick={() => update({ soundEnabled: !settings.soundEnabled })}
        >
          <span />
        </button>
      </div>

      <div className="switch-row">
        <span>Раскрывать роль после смерти</span>
        <button
          className={settings.revealRoleOnDeath ? "switch on" : "switch"}
          type="button"
          aria-pressed={settings.revealRoleOnDeath}
          onClick={() => update({ revealRoleOnDeath: !settings.revealRoleOnDeath })}
        >
          <span />
        </button>
      </div>

      <div className="timer-grid">
        {[
          ["night", "Ночь", 15, 180],
          ["discussion", "Обсуждение", 30, 600],
          ["voting", "Голосование", 10, 180]
        ].map(([phase, title, min, max]) => (
          <label className="mini-number-field" key={phase}>
            <span>{title}, сек.</span>
            <input
              type="number"
              min={min}
              max={max}
              value={settings.phaseDurations?.[phase] || defaultSettings.phaseDurations[phase]}
              onChange={(event) => updateDuration(phase, event.target.value)}
            />
          </label>
        ))}
      </div>

      <label className="mini-number-field speaker-duration-field">
        <span>Время речи игрока, сек.</span>
        <input
          type="number"
          min="15"
          max="300"
          value={settings.speakerDuration || defaultSettings.speakerDuration}
          onChange={(event) => update({ speakerDuration: Number(event.target.value) })}
        />
      </label>

      <div className="segmented" role="group" aria-label="Тип общения">
        <button
          className={settings.communication === "text" ? "active" : ""}
          type="button"
          onClick={() => update({ communication: "text" })}
        >
          <MessageCircle size={16} /> Текст
        </button>
        <button
          className={settings.communication === "voice" ? "active" : ""}
          type="button"
          onClick={() => update({ communication: "voice" })}
        >
          <Mic size={16} /> Голос
        </button>
      </div>

      <div className="role-count-grid">
        {Object.entries({
          mafia: "Мафия",
          don: "Дон",
          doctor: "Доктор",
          commissioner: "Комиссар",
          maniac: "Маньяк"
        }).map(([role, title]) => {
          const Icon = roleIcons[role] || Users;
          return (
            <label className="role-count" key={role}>
              <span>
                <Icon size={15} />
                {title}
              </span>
              <input
                type="number"
                min={role === "mafia" ? 1 : 0}
                max={role === "don" || role === "maniac" ? 1 : 5}
                value={roleCounts[role] ?? 0}
                onChange={(event) => updateRoleCount(role, event.target.value)}
              />
            </label>
          );
        })}
        <div className="role-count civilian-count">
          <span>
            <Users size={15} />
            Мирные
          </span>
          <strong>{civilians}</strong>
        </div>
      </div>

      {warning ? <div className="status-line warn role-warning">{warning}</div> : null}

      <div className="role-toggle-grid legacy-toggles">
        {Object.entries({
          civilian: "Мирные",
          mafia: "Мафия"
        }).map(([role, title]) => {
          const Icon = roleIcons[role] || Users;
          return (
            <button key={role} type="button" className="role-toggle active locked" disabled>
              <Icon size={16} />
              <span>{title}</span>
              <Check size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LobbyView({ room, emit, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [draftSettings, setDraftSettings] = useState(room.settings);
  const inviteLink = `${window.location.origin}${window.location.pathname}?room=${room.code}`;

  useEffect(() => {
    setDraftSettings(room.settings);
  }, [room.settings]);

  function copyInvite() {
    navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function saveSettings(nextSettings) {
    setDraftSettings(nextSettings);
    emit("updateSettings", { settings: nextSettings });
  }

  const missingToFive = Math.max(0, 5 - room.players.length);

  return (
    <section className="lobby-layout fade-in">
      <header className="room-header">
        <div>
          <p className="eyebrow">Лобби</p>
          <h1>{room.name}</h1>
          <div className="room-code">
            <span>{room.code}</span>
            <button className="icon-button" type="button" title="Скопировать приглашение" onClick={copyInvite}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
        </div>
        <button className="ghost-action" onClick={onLeave}>
          <LogOut size={18} /> Выйти
        </button>
      </header>

      <div className="lobby-grid">
        <div className="players-panel">
          <div className="panel-title">
            <Users size={19} />
            <span>
              Игроки {room.players.length}/{room.settings.capacity}
            </span>
          </div>
          <div className="lobby-players">
            {room.players.map((player) => (
              <PlayerListItem key={player.id} player={player} room={room} emit={emit} roleMeta={room.roleMeta} />
            ))}
          </div>
        </div>

        <div className="lobby-actions">
          <div className="status-stack">
            {room.startBlockers.length ? (
              room.startBlockers.map((blocker) => (
                <div className="status-line warn" key={blocker}>
                  {blocker}
                </div>
              ))
            ) : (
              <div className="status-line ok">Комната готова к старту.</div>
            )}
          </div>

          <button className={room.viewer.ready ? "secondary-action active" : "secondary-action"} onClick={() => emit("toggleReady")}>
            <Check size={19} /> {room.viewer.ready ? "Готов" : "Нажать готов"}
          </button>

          {room.viewer.isCreator ? (
            <>
              <button className="primary-action" disabled={!room.canStart} onClick={() => emit("startGame")}>
                <Play size={20} /> Начать игру
              </button>
              <div className="bot-row">
                <button className="ghost-action" onClick={() => emit("addBot", { count: 1 })}>
                  <Bot size={18} /> Добавить бота
                </button>
                {missingToFive > 0 ? (
                  <button className="ghost-action" onClick={() => emit("addBot", { count: missingToFive })}>
                    <UserPlus size={18} /> До 5 игроков
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="settings-card">
            <div className="panel-title">
              <Settings size={19} />
              <span>Настройки партии</span>
            </div>
            {room.viewer.isCreator ? (
              <RoomSettingsForm settings={draftSettings} onChange={saveSettings} compact />
            ) : (
              <SettingsSummary room={room} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsSummary({ room }) {
  return (
    <div className="summary-list">
      <span>Мест: {room.settings.capacity}</span>
      <span>{room.settings.autoHost ? "Автоматический ведущий" : "Ведущий управляет фазами"}</span>
      <span>{room.settings.communication === "voice" ? "Голосовой чат" : "Текстовый чат"}</span>
      <span>{room.settings.botTalk ? "Боты участвуют в обсуждении" : "Боты молчат в обсуждении"}</span>
      <span>{room.settings.soundEnabled ? "Звуки включены" : "Звуки выключены"}</span>
      <span>{room.settings.revealRoleOnDeath ? "Роли раскрываются после смерти" : "Роли после смерти скрыты"}</span>
      <span>
        Таймеры: ночь {room.settings.phaseDurations?.night || 45}с, обсуждение{" "}
        {room.settings.phaseDurations?.discussion || 180}с, голосование {room.settings.phaseDurations?.voting || 30}с
      </span>
      <span>Речь игрока: {room.settings.speakerDuration || 90}с на человека</span>
      <span>Роли: {formatRoleCounts(room.roleCounts, room.roleMeta)}</span>
      {room.roleBalance?.warning ? <span className="summary-warning">{room.roleBalance.warning}</span> : null}
    </div>
  );
}

function GameView({ room, emit, onLeave }) {
  const [chatOpen, setChatOpen] = useState(false);
  useGameAudio(room);

  function toggleVoice() {
    const next = !room.viewer.micOn;
    emit("voiceState", { micOn: next, speaking: next });
  }

  return (
    <section className={`game-layout phase-${room.phase} fade-in`}>
      <header className="game-topbar">
        <div className="phase-pill">
          {room.phase === "night" ? <Moon size={18} /> : room.phase === "morning" ? <Sun size={18} /> : <Timer size={18} />}
          <span>{room.phaseLabel}</span>
          <PhaseTimer room={room} />
        </div>
        <div className="topbar-actions">
          <span className="mini-code">{room.code}</span>
          {room.voice.enabled ? (
            <button className={room.viewer.micOn ? "icon-button active" : "icon-button"} title="Микрофон" onClick={toggleVoice}>
              {room.viewer.micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
          ) : null}
          <button className="icon-button mobile-only" title="Чат" onClick={() => setChatOpen(true)}>
            <MessageCircle size={18} />
          </button>
          <button className="icon-button" title="Выйти" onClick={onLeave}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="game-main">
        <FloatingPanel id="left" title="Панели" className="left-side">
          <RolePanel room={room} />
          <ActionPanel room={room} emit={emit} />
          {room.viewer.canManage ? <HostPanel room={room} emit={emit} /> : null}
        </FloatingPanel>

        <GameTable room={room} emit={emit} />

        <FloatingPanel id="chat" title="Чат" className={`chat-side ${chatOpen ? "open" : ""}`} defaultCollapsed={false}>
          <button className="icon-button close-chat mobile-only" onClick={() => setChatOpen(false)} title="Закрыть чат">
            <LogOut size={18} />
          </button>
          <ChatPanel room={room} emit={emit} />
          <EventPanel room={room} />
        </FloatingPanel>
      </div>

      {room.winner ? <VictoryModal room={room} emit={emit} onLeave={onLeave} /> : null}
    </section>
  );
}

function FloatingPanel({ id, title, className = "", children, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  function startDrag(event) {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: position.x,
      y: position.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: clamp(drag.x + event.clientX - drag.startX, -420, 420),
      y: clamp(drag.y + event.clientY - drag.startY, -260, 420)
    });
  }

  function stopDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <aside
      className={`side-panel floating-panel ${className} ${collapsed ? "collapsed" : ""}`}
      style={{ "--panel-x": `${position.x}px`, "--panel-y": `${position.y}px` }}
    >
      <div className="panel-dragbar" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <Move size={16} />
        <span>{title}</span>
        <button
          className="panel-collapse"
          type="button"
          title={collapsed ? "Развернуть" : "Свернуть"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

function GameTable({ room, emit }) {
  const players = room.players;
  const total = players.length || 1;

  return (
    <div className="table-stage" aria-label="Игровой стол">
      <img className="table-image" src="/stol.png" alt="Стол для игры в мафию" />
      {players.map((player, index) => {
        const position = getSeatPosition(index, total);
        return (
          <SeatCard
            key={player.id}
            player={player}
            room={room}
            emit={emit}
            style={{
              left: `${position.x}%`,
              top: `${position.y}%`
            }}
          />
        );
      })}
    </div>
  );
}

function SeatCard({ player, room, emit, style }) {
  const isMe = player.id === room.viewer.id;
  const isActive = room.activeSpeakerId === player.id || player.speaking;
  const nightAction = getNightButton(room, player, emit);
  const voteAction = getVoteButton(room, player, emit);
  const passAction = getPassSpeakerButton(room, player, emit);
  const RoleIcon = player.role ? roleIcons[player.role] || Eye : Eye;
  const hasVotes = Boolean(room.voteState?.counts?.[player.id]);
  const canKick = room.viewer.canManage && player.id !== room.viewer.id;

  return (
    <div
      className={`seat-card ${!player.alive ? "dead" : ""} ${isActive ? "speaking" : ""} ${isMe ? "me" : ""} ${hasVotes ? "vote-target" : ""}`}
      style={style}
    >
      <div className="seat-avatar-wrap">
        <img className="seat-avatar" src={player.avatar} alt="" />
        {!player.connected ? <WifiOff className="seat-status-icon" size={16} /> : <Wifi className="seat-status-icon" size={16} />}
      </div>
      <div className="seat-name">{player.name}</div>
      <div className={player.alive ? "life-badge alive" : "life-badge dead"}>{player.alive ? "жив" : "мертв"}</div>
      {player.afk ? <div className="life-badge afk">AFK</div> : null}
      {player.role ? (
        <div className={`seat-role ${roleTone[player.role] || ""}`}>
          <RoleIcon size={13} />
          <span>{room.roleMeta[player.role]?.title}</span>
        </div>
      ) : null}
      {nightAction ? (
        <button className={nightAction.selected ? "seat-action selected" : "seat-action"} onClick={nightAction.onClick}>
          {nightAction.icon}
          <span>{nightAction.label}</span>
        </button>
      ) : null}
      {voteAction ? (
        <button className={voteAction.selected ? "seat-action selected" : "seat-action"} onClick={voteAction.onClick}>
          <Vote size={13} />
          <span>{voteAction.label}</span>
        </button>
      ) : null}
      {passAction ? (
        <button className="seat-action pass-action" onClick={passAction.onClick}>
          <Send size={13} />
          <span>{passAction.label}</span>
        </button>
      ) : null}
      {room.voteState?.counts?.[player.id] ? <div className="vote-count">{room.voteState.counts[player.id]}</div> : null}
      {canKick ? (
        <button className="kick-mini" title="Кикнуть игрока" onClick={() => emit("kickPlayer", { targetId: player.id })}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function RolePanel({ room }) {
  const role = room.myRole;
  const meta = role ? room.roleMeta[role] : null;
  const Icon = role ? roleIcons[role] || Eye : Eye;

  return (
    <section className="tool-panel">
      <div className="panel-title">
        <Icon size={19} />
        <span>Моя роль</span>
      </div>
      {meta ? (
        <div className={`role-card ${roleTone[role] || ""}`}>
          <strong>{meta.title}</strong>
          <p>{meta.description}</p>
        </div>
      ) : (
        <div className="muted-box">Роль появится после старта.</div>
      )}
      <div className="private-log">
        {room.privateLog.slice(-4).map((item) => (
          <div key={item.id}>{item.text}</div>
        ))}
      </div>
    </section>
  );
}

function ActionPanel({ room, emit }) {
  return (
    <section className="tool-panel">
      <div className="panel-title">
        <Gavel size={19} />
        <span>Ход партии</span>
      </div>
      <div className="phase-copy">
        {room.phase === "night" && room.round === 1 ? (
          <p>Первая ночь проходит без голосования мафии и убийств. Создатель завершит её вручную или по таймеру.</p>
        ) : room.phase === "night" && room.availableNightAction ? (
          <p>Выберите цель на игровом столе.</p>
        ) : room.phase === "night" ? (
          <p>Дождитесь действий ночных ролей.</p>
        ) : room.phase === "night_wait" || room.phase === "roles" ? (
          <p>Ночь начнется только когда создатель комнаты нажмет кнопку управления.</p>
        ) : room.phase === "voting" ? (
          <p>Голосование открыто. Голос можно отдать один раз.</p>
        ) : room.phase === "morning" && room.lastNightResult ? (
          <p>{room.lastNightResult.text}</p>
        ) : room.phase === "discussion" ? (
          <p>Обсуждение идет. Активный говорящий подсвечен за столом.</p>
        ) : (
          <p>Партия готовится к следующей фазе.</p>
        )}
      </div>
      {room.discussionTurn ? <SpeakerTurnCard room={room} emit={emit} /> : null}
      {room.lastVoteResult ? <div className="result-box">{room.lastVoteResult.text}</div> : null}
      {room.voteState?.rows?.length ? <VoteTable rows={room.voteState.rows} title="Ход голосования" /> : null}
      {room.lastVoteResult?.rows?.length ? <VoteTable rows={room.lastVoteResult.rows} title="Итоги голосования" /> : null}
      {room.voice.enabled ? (
        <div className="voice-note">
          <Mic size={16} />
          <span>Интерфейс готов под WebRTC-звонок. Сигналинг идет через Socket.IO.</span>
        </div>
      ) : null}
    </section>
  );
}

function SpeakerTurnCard({ room, emit }) {
  const turn = room.discussionTurn;
  if (!turn) return null;
  return (
    <div className="speaker-card">
      <span>
        Говорит {turn.activeSpeakerName} · {turn.index + 1}/{turn.total}
      </span>
      <div className="speaker-actions">
        <SpeakerTimer turn={turn} />
        {turn.canPassSpeaker ? (
          <button className="speaker-finish" type="button" onClick={() => emit("finishSpeech")}>
            Закончить речь
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SpeakerTimer({ turn }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, []);

  const endsAt = turn.startedAt + turn.duration * 1000;
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return <strong>{formatSeconds(seconds)}</strong>;
}

function VoteTable({ rows, title }) {
  return (
    <div className="vote-table">
      <strong>{title}</strong>
      {rows.map((row) => (
        <div className={row.skipped ? "vote-row skipped" : "vote-row"} key={`${row.voterId}-${row.index}`}>
          <span>{row.voterName}</span>
          <span>{row.targetName}</span>
        </div>
      ))}
    </div>
  );
}

function HostPanel({ room, emit }) {
  const labelByPhase = {
    roles: "Начать ночь",
    night_wait: "Начать ночь",
    night: "Завершить ночь",
    morning: "К обсуждению",
    discussion: "Скипнуть обсуждение",
    voting: "Завершить голосование"
  };
  const helperByPhase = {
    roles: "Игроки видят свои роли. Ночь начнется только по вашей команде.",
    night_wait: "Город ждет. Нажмите, когда пора начинать ночь.",
    discussion: "Можно досрочно завершить обсуждение и открыть голосование."
  };

  return (
    <section className="tool-panel">
      <div className="panel-title">
        <Crown size={19} />
        <span>Управление</span>
      </div>
      <button className="secondary-action" onClick={() => emit("advancePhase")}>
        <Play size={18} /> {labelByPhase[room.phase] || "Следующая фаза"}
      </button>
      {room.phase === "voting" ? (
        <button className="ghost-action host-skip" onClick={() => emit("skipVoting")}>
          <Vote size={18} /> Пропустить голосование
        </button>
      ) : null}
      {helperByPhase[room.phase] ? <div className="muted-box host-hint">{helperByPhase[room.phase]}</div> : null}
      {!room.settings.autoHost ? <div className="muted-box">В ручном режиме создатель видит роли игроков и двигает фазы.</div> : null}
    </section>
  );
}

function ChatPanel({ room, emit }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("alive");
  const scrollRef = useRef(null);
  const canUseMafia = room.phase === "night" && room.viewer.alive && isMafiaRoleClient(room.myRole);
  const canUseDead = !room.viewer.alive || room.phase === "finished";
  const channels = [
    { id: "alive", label: "Общий" },
    ...(canUseMafia ? [{ id: "mafia", label: "Мафия" }] : []),
    ...(canUseDead ? [{ id: "dead", label: "Мертвые" }] : [])
  ];
  const activeChannel = channels.some((item) => item.id === channel) ? channel : "alive";
  const messages = room.chat.filter((message) => (message.channel || "alive") === activeChannel || message.type === "system");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeChannel]);

  function send(event) {
    event.preventDefault();
    if (!text.trim()) return;
    emit("sendChat", { text, channel: activeChannel });
    setText("");
  }

  return (
    <section className="tool-panel chat-panel">
      <div className="panel-title">
        <MessageCircle size={19} />
        <span>{room.viewer.alive ? "Чат комнаты" : "Чат мертвых"}</span>
      </div>
      <div className="chat-tabs">
        {channels.map((item) => (
          <button className={activeChannel === item.id ? "chat-tab active" : "chat-tab"} key={item.id} type="button" onClick={() => setChannel(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.type === "system" ? "system" : ""} ${message.channel || "alive"}`}>
            <span>{message.playerName}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input value={text} maxLength={600} onChange={(event) => setText(event.target.value)} placeholder="Сообщение" />
        <button className="icon-button" title="Отправить">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function EventPanel({ room }) {
  return (
    <section className="tool-panel events-panel">
      <div className="panel-title">
        <Timer size={19} />
        <span>События</span>
      </div>
      <div className="event-list">
        {room.events.slice(-8).map((event) => (
          <div key={event.id}>{event.text}</div>
        ))}
      </div>
    </section>
  );
}

function VictoryModal({ room, emit, onLeave }) {
  return (
    <div className="modal-backdrop">
      <div className={`victory-modal ${room.winner.team}`}>
        <Sparkles size={34} />
        <h2>{room.winner.title}</h2>
        <p>{room.winner.text}</p>
        <div className="stat-grid">
          <span>Раундов: {room.gameStats?.rounds || room.round}</span>
          <span>Выбыло: {room.gameStats?.deaths || 0}</span>
          <span>Живы: {room.gameStats?.alive || 0}</span>
        </div>
        <div className="victory-actions">
          {room.viewer.canManage ? (
            <button className="secondary-action" onClick={() => emit("replayGame")}>
              <Play size={18} /> Играть еще раз
            </button>
          ) : null}
          <button className="primary-action victory-exit" onClick={onLeave}>
            <DoorOpen size={18} /> В главное меню
          </button>
        </div>
        <div className="reveal-grid">
          {room.players.map((player) => (
            <div key={player.id} className="reveal-item">
              <img src={player.avatar} alt="" />
              <span>{player.name}</span>
              <strong>{room.roleMeta[player.role]?.title}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerListItem({ player, room, emit, roleMeta }) {
  const canKick = room?.viewer?.canManage && player.id !== room.viewer.id;
  return (
    <div className="player-list-item">
      <img src={player.avatar} alt="" />
      <div>
        <strong>{player.name}</strong>
        <span>
          {player.isCreator ? "Создатель" : player.isBot ? "Тренировка" : player.connected ? "Онлайн" : "Нет связи"}
        </span>
      </div>
      {player.ready ? <Check className="ready-icon" size={18} /> : null}
      {player.afk ? <small className="afk-chip">AFK</small> : null}
      {player.role ? <small>{roleMeta[player.role]?.title}</small> : null}
      {canKick ? (
        <button className="kick-mini lobby-kick" title="Кикнуть игрока" onClick={() => emit("kickPlayer", { targetId: player.id })}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function PhaseTimer({ room }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  if (!room.phaseDuration) return <span className="timer-static">ручной режим</span>;
  const endsAt = room.phaseStartedAt + room.phaseDuration * 1000;
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return <span className="timer-static">{formatSeconds(seconds)}</span>;
}

function ConnectionBadge({ connected }) {
  return (
    <div className={connected ? "connection-badge online" : "connection-badge"}>
      {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
      <span>{connected ? "online" : "offline"}</span>
    </div>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => {
    const id = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(id);
  }, [message, onClose]);

  return (
    <button className="toast" onClick={onClose}>
      {message}
    </button>
  );
}

function AmbientBackdrop() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="curtain" />
      <div className="spotlight" />
    </div>
  );
}

function getNightButton(room, player, emit) {
  const action = room.availableNightAction;
  if (!action || !player.alive || player.id === room.viewer.id) return null;
  if (action.action === "kill" && player.role && (player.role === "mafia" || player.role === "don")) return null;
  const selected = action.selectedTargetId === player.id;
  const icons = {
    kill: <Skull size={13} />,
    maniackill: <Skull size={13} />,
    inspect: <Eye size={13} />,
    heal: <HeartPulse size={13} />
  };
  return {
    label: selected ? "Выбрано" : action.label,
    icon: icons[action.action],
    selected,
    onClick: () => {
      if (!room.viewer.alive || room.phase !== "night" || !room.availableNightAction) return;
      if (room.availableNightAction.selectedTargetId === player.id) return;
      emit("nightAction", { action: action.action, targetId: player.id });
    }
  };
}

function getVoteButton(room, player, emit) {
  if (room.phase !== "voting" || !room.viewer.alive || !player.alive || player.id === room.viewer.id) return null;
  const selected = room.voteState?.votedTargetId === player.id;
  if (room.voteState?.votedTargetId && !selected) return null;
  return {
    label: selected ? "Голос отдан" : "Голос",
    selected,
    onClick: () => {
      if (room.voteState?.votedTargetId) return;
      emit("castVote", { targetId: player.id });
    }
  };
}

function getPassSpeakerButton(room, player, emit) {
  const turn = room.discussionTurn;
  if (room.phase !== "discussion" || !turn?.canPassSpeaker) return null;
  if (!player.alive || player.id === room.viewer.id) return null;
  if (!turn.remainingSpeakerIds?.includes(player.id)) return null;
  return {
    label: "Передать",
    onClick: () => emit("passSpeaker", { targetId: player.id })
  };
}

function getSeatPosition(index, total) {
  const angle = -90 + (360 / total) * index;
  const rad = (angle * Math.PI) / 180;
  const rx = total > 12 ? 47 : 45;
  const ry = total > 12 ? 43 : 41;
  return {
    x: 50 + Math.cos(rad) * rx,
    y: 50 + Math.sin(rad) * ry
  };
}

function formatSeconds(value) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRoleCounts(counts, roleMeta) {
  if (!counts) return "";
  return Object.entries(counts)
    .map(([role, count]) => `${roleMeta[role]?.title || role}: ${count}`)
    .join(", ");
}

function getRoleBalanceWarning(playerCount, countsInput = {}) {
  const total = Object.values(countsInput).reduce((sum, value) => sum + Number(value || 0), 0);
  const mafiaTeam = Number(countsInput.mafia || 0) + Number(countsInput.don || 0);
  if (total > playerCount) return "Ролей больше, чем игроков. Лишние роли будут убраны автоматически.";
  if (mafiaTeam < 1) return "Нужна хотя бы одна роль мафии или дона.";
  if (mafiaTeam >= Math.ceil(playerCount / 2)) return "Мафии слишком много: партия может закончиться слишком быстро.";
  if (Number(countsInput.maniac || 0) > 0 && playerCount < 7) return "Маньяк лучше работает в партиях от 7 игроков.";
  return "";
}

function isMafiaRoleClient(role) {
  return role === "mafia" || role === "don";
}

function useGameAudio(room) {
  const audioRef = useRef({ ctx: null, phase: null, deathKey: "", winner: null, hum: null });

  useEffect(() => {
    const state = audioRef.current;
    if (!room.settings?.soundEnabled) {
      stopHum(state);
      state.phase = room.phase;
      state.deathKey = "";
      state.winner = null;
      return;
    }

    const ctx = getAudioContext(state);
    if (!ctx) return;
    ctx.resume?.().catch(() => {});

    if (state.phase !== room.phase) {
      if (room.phase === "night") {
        playTone(ctx, 190, 0.34, "sine", 0.055);
        startHum(state, ctx);
      } else {
        stopHum(state);
      }
      if (room.phase === "voting") playTone(ctx, 520, 0.22, "triangle", 0.07);
      state.phase = room.phase;
    }

    const deathKey = (room.lastNightResult?.killedIds || [room.lastNightResult?.killedId]).filter(Boolean).join(",");
    if (deathKey && state.deathKey !== deathKey) {
      playTone(ctx, 92, 0.42, "sawtooth", 0.05);
      state.deathKey = deathKey;
    }

    if (room.winner?.team && state.winner !== room.winner.team) {
      playTone(ctx, room.winner.team === "mafia" ? 240 : 680, 0.42, "triangle", 0.08);
      window.setTimeout(() => playTone(ctx, room.winner.team === "mafia" ? 180 : 820, 0.42, "triangle", 0.06), 180);
      state.winner = room.winner.team;
    }
  }, [room.phase, room.settings?.soundEnabled, room.lastNightResult?.killedId, room.lastNightResult?.text, room.winner?.team]);

  useEffect(() => () => stopHum(audioRef.current), []);
}

function getAudioContext(state) {
  if (state.ctx) return state.ctx;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  state.ctx = new AudioCtor();
  return state.ctx;
}

function playTone(ctx, frequency, duration, type = "sine", volume = 0.06) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.04);
}

function startHum(state, ctx) {
  if (state.hum) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 72;
  gain.gain.value = 0.012;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  state.hum = { osc, gain };
}

function stopHum(state) {
  if (!state.hum) return;
  try {
    state.hum.gain.gain.exponentialRampToValueAtTime(0.0001, state.ctx.currentTime + 0.18);
    state.hum.osc.stop(state.ctx.currentTime + 0.2);
  } catch {
    state.hum.osc.disconnect();
  }
  state.hum = null;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function createAvatar(seed) {
  const value = String(seed || "player");
  const hue = Math.abs(hashString(value)) % 360;
  const initial = (value.trim()[0] || "?").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},74%,42%)"/><stop offset="1" stop-color="hsl(${(hue + 44) % 360},82%,18%)"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><circle cx="48" cy="37" r="17" fill="#f6d7a1"/><path d="M21 84c5-22 49-22 54 0" fill="#151014"/><path d="M24 32c8-20 40-20 48 0-12-6-36-6-48 0Z" fill="#1a1011"/><text x="48" y="64" text-anchor="middle" font-size="21" font-family="Arial" font-weight="800" fill="#f6d7a1">${initial.replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function hashString(value) {
  return value.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 11);
}

function renderAvatarDataUrl(src, zoom = 1, fallback) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(src || fallback);
        return;
      }

      const safeZoom = clamp(Number(zoom) || 1, 1, 1.8);
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / safeZoom;
      const sx = (image.naturalWidth - sourceSize) / 2;
      const sy = (image.naturalHeight - sourceSize) / 2;
      context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => resolve(fallback);
    image.src = src || fallback;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default App;

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Bot,
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

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const STORAGE_KEY = "mafia-online-session";

const defaultSettings = {
  capacity: 10,
  autoHost: true,
  communication: "text",
  roles: {
    civilian: true,
    mafia: true,
    don: true,
    commissioner: true,
    doctor: true
  }
};

const roleIcons = {
  civilian: Users,
  mafia: Skull,
  don: Crown,
  commissioner: ShieldCheck,
  doctor: HeartPulse
};

const roleTone = {
  civilian: "city",
  mafia: "mafia",
  don: "mafia",
  commissioner: "law",
  doctor: "heal"
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
  const [avatarSeed, setAvatarSeed] = useState(() => `player-${Date.now()}`);
  const [settings, setSettings] = useState(defaultSettings);
  const avatar = useMemo(() => createAvatar(avatarSeed || nickname || "player"), [avatarSeed, nickname]);

  function createRoom() {
    socket?.emit("createRoom", {
      nickname,
      avatar,
      roomName,
      settings
    });
  }

  function joinRoom() {
    socket?.emit("joinRoom", {
      roomCode: joinCode,
      nickname,
      avatar,
      playerId: readSession()?.playerId
    });
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
          <img className="avatar-large" src={avatar} alt="Аватар" />
          <button
            className="icon-button"
            type="button"
            title="Случайный аватар"
            onClick={() => setAvatarSeed(`player-${Math.random()}-${Date.now()}`)}
          >
            <Dice5 size={20} />
          </button>
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
            <button className="primary-action" disabled={!canSubmit} onClick={createRoom}>
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
            <button className="primary-action" disabled={!canSubmit || !joinCode.trim()} onClick={joinRoom}>
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

      <div className="role-toggle-grid">
        {Object.entries({
          civilian: "Мирные",
          mafia: "Мафия",
          don: "Дон",
          commissioner: "Комиссар",
          doctor: "Доктор"
        }).map(([role, title]) => {
          const Icon = roleIcons[role];
          const locked = role === "civilian" || role === "mafia";
          return (
            <button
              key={role}
              type="button"
              className={`role-toggle ${settings.roles[role] ? "active" : ""} ${locked ? "locked" : ""}`}
              disabled={locked}
              onClick={() => updateRole(role, !settings.roles[role])}
            >
              <Icon size={16} />
              <span>{title}</span>
              {locked ? <Check size={14} /> : null}
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
              <PlayerListItem key={player.id} player={player} roleMeta={room.roleMeta} />
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
      <span>Роли: {formatRoleCounts(room.roleCounts, room.roleMeta)}</span>
    </div>
  );
}

function GameView({ room, emit, onLeave }) {
  const [chatOpen, setChatOpen] = useState(false);

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
        <aside className="side-panel left-side">
          <RolePanel room={room} />
          <ActionPanel room={room} emit={emit} />
          {room.viewer.canManage ? <HostPanel room={room} emit={emit} /> : null}
        </aside>

        <GameTable room={room} emit={emit} />

        <aside className={`side-panel chat-side ${chatOpen ? "open" : ""}`}>
          <button className="icon-button close-chat mobile-only" onClick={() => setChatOpen(false)} title="Закрыть чат">
            <LogOut size={18} />
          </button>
          <ChatPanel room={room} emit={emit} />
          <EventPanel room={room} />
        </aside>
      </div>

      {room.winner ? <VictoryModal room={room} /> : null}
    </section>
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
  const RoleIcon = player.role ? roleIcons[player.role] || Eye : Eye;

  return (
    <div
      className={`seat-card ${!player.alive ? "dead" : ""} ${isActive ? "speaking" : ""} ${isMe ? "me" : ""}`}
      style={style}
    >
      <div className="seat-avatar-wrap">
        <img className="seat-avatar" src={player.avatar} alt="" />
        {!player.connected ? <WifiOff className="seat-status-icon" size={16} /> : <Wifi className="seat-status-icon" size={16} />}
      </div>
      <div className="seat-name">{player.name}</div>
      <div className={player.alive ? "life-badge alive" : "life-badge dead"}>{player.alive ? "жив" : "мертв"}</div>
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
      {room.voteState?.counts?.[player.id] ? <div className="vote-count">{room.voteState.counts[player.id]}</div> : null}
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
        {room.phase === "night" && room.availableNightAction ? (
          <p>Выберите цель на игровом столе.</p>
        ) : room.phase === "night" ? (
          <p>Дождитесь действий ночных ролей.</p>
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
      {room.lastVoteResult ? <div className="result-box">{room.lastVoteResult.text}</div> : null}
      {room.voice.enabled ? (
        <div className="voice-note">
          <Mic size={16} />
          <span>Интерфейс готов под WebRTC-звонок. Сигналинг идет через Socket.IO.</span>
        </div>
      ) : null}
    </section>
  );
}

function HostPanel({ room, emit }) {
  return (
    <section className="tool-panel">
      <div className="panel-title">
        <Crown size={19} />
        <span>Управление</span>
      </div>
      <button className="secondary-action" onClick={() => emit("advancePhase")}>
        <Play size={18} /> Следующая фаза
      </button>
      {!room.settings.autoHost ? <div className="muted-box">В ручном режиме создатель видит роли игроков и двигает фазы.</div> : null}
    </section>
  );
}

function ChatPanel({ room, emit }) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [room.chat.length]);

  function send(event) {
    event.preventDefault();
    if (!text.trim()) return;
    emit("sendChat", { text });
    setText("");
  }

  return (
    <section className="tool-panel chat-panel">
      <div className="panel-title">
        <MessageCircle size={19} />
        <span>{room.viewer.alive ? "Чат комнаты" : "Чат мертвых"}</span>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {room.chat.map((message) => (
          <div key={message.id} className={`chat-message ${message.type === "system" ? "system" : ""}`}>
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

function VictoryModal({ room }) {
  return (
    <div className="modal-backdrop">
      <div className={`victory-modal ${room.winner.team}`}>
        <Sparkles size={34} />
        <h2>{room.winner.title}</h2>
        <p>{room.winner.text}</p>
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

function PlayerListItem({ player, roleMeta }) {
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
      {player.role ? <small>{roleMeta[player.role]?.title}</small> : null}
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

export default App;

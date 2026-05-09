# Мафия Онлайн

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NotKingChoka/mafia)

Полноценный сайт для онлайн-игры «Мафия»: комнаты, игроки, роли, фазы партии, ночные действия, голосование, текстовый чат и интерфейс игрового стола сверху. Проект можно деплоить двумя способами: одним Node-сервисом на Render/Railway/Fly.io/VPS или раздельно как Vercel frontend + отдельный Socket.IO backend.

## Структура

- `frontend` - React/Vite интерфейс.
- `backend` - Node.js/Express + Socket.IO сервер комнат.
- `frontend/public/stol.png` - изображение стола, которое используется в партии.
- `render.yaml`, `railway.json`, `Dockerfile` - готовые конфиги для production-деплоя.

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать env-файлы:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

На Windows можно просто создать файлы вручную и перенести значения из `.env.example`.

3. Запустить frontend и backend вместе:

```bash
npm run dev
```

По умолчанию:

- frontend: `http://localhost:5173`
- backend: `http://localhost:4000`
- health-check backend: `http://localhost:4000/api/health`

## Переменные окружения

Root/backend:

```env
PORT=4000
CORS_ORIGIN=http://localhost:5173
WEBRTC_STUN_URL=stun:stun.l.google.com:19302
BOT_AI_ENABLED=false
BOT_AI_API_URL=https://api.openai.com/v1/chat/completions
BOT_AI_MODEL=gpt-4o-mini
BOT_AI_API_KEY=
BOT_AI_TIMEOUT_MS=4500
```

Frontend:

```env
VITE_SOCKET_URL=http://localhost:4000
```

После деплоя замените `VITE_SOCKET_URL` на публичный URL backend-сервера, например `https://mafia-backend.onrender.com`.

## GitHub

```bash
git init
git add .
git commit -m "Initial Mafia online game"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Деплой frontend на Vercel

1. Загрузите проект на GitHub.
2. В Vercel создайте новый проект из репозитория.
3. В качестве root directory выберите `frontend`.
4. Добавьте переменную окружения:

```env
VITE_SOCKET_URL=https://your-backend-url
```

5. Build command: `npm run build`.
6. Output directory: `dist`.

После деплоя frontend получит постоянную ссылку вида `https://project-name.vercel.app`.

## Деплой одним сервисом

Самый простой вариант для рабочей онлайн-игры: деплоить весь проект одним Node-сервисом. Тогда backend отдает собранный frontend и Socket.IO работает на том же постоянном домене.

### Render

1. Подключите GitHub-репозиторий в Render.
2. Выберите Blueprint или Web Service из репозитория.
3. Render прочитает `render.yaml`.
4. После деплоя сайт будет доступен по адресу вида `https://mafia-online.onrender.com`.

Render настройки вручную:

```bash
Build Command: npm install && npm run build
Start Command: npm start
```

Env:

```env
NODE_ENV=production
CORS_ORIGIN=*
WEBRTC_STUN_URL=stun:stun.l.google.com:19302
BOT_AI_ENABLED=false
BOT_AI_API_URL=https://api.openai.com/v1/chat/completions
BOT_AI_MODEL=gpt-4o-mini
BOT_AI_TIMEOUT_MS=4500
```

Если хотите, чтобы боты отвечали через нейросеть, добавьте на Render секретную переменную `BOT_AI_API_KEY` и поставьте `BOT_AI_ENABLED=true`. Код использует OpenAI-compatible Chat Completions endpoint, поэтому можно подставить другой совместимый URL в `BOT_AI_API_URL`. Боты читают последние сообщения игроков и других ботов, но не получают чужие скрытые роли.

### Railway

Railway прочитает `railway.json`.

```bash
Build Command: npm install && npm run build
Start Command: npm start
```

### Docker / VPS / Fly.io

Можно использовать `Dockerfile`:

```bash
docker build -t mafia-online .
docker run -p 4000:4000 mafia-online
```

## Раздельный деплой backend

Socket.IO держит постоянное соединение, поэтому обычные Vercel Serverless Functions не подходят для постоянного WebSocket-сервера. Backend лучше деплоить отдельно:

- Render Web Service
- Railway Service
- Fly.io app
- отдельный VPS

Команды для backend:

```bash
npm install
npm run start -w backend
```

Для сервиса укажите:

- root: весь репозиторий или папка `backend`, в зависимости от платформы;
- start command из корня: `npm run start -w backend`;
- start command из папки `backend`: `npm start`;
- env: `PORT`, `CORS_ORIGIN`, `WEBRTC_STUN_URL`.

`CORS_ORIGIN` должен быть равен URL frontend на Vercel, например:

```env
CORS_ORIGIN=https://project-name.vercel.app
```

## Что реализовано

- создание и подключение к комнатам по коду или invite-ссылке;
- лобби с готовностью игроков, создателем, настройками и тренировочными игроками;
- роли: мирный житель, мафия, дон, комиссар, доктор;
- автоматическое распределение ролей от 5 до 15 игроков;
- приватная выдача роли каждому игроку;
- ручной режим ведущего, где создатель видит роли и двигает фазы;
- автоматический режим с таймерами фаз;
- ночь, утро, обсуждение, голосование и проверка победы;
- текстовый чат, системные события и чат мертвых;
- AI-ready разговоры ботов через env-переменные с fallback-репликами без ключа;
- выбор аватарок из папки `frontend/public/avatars` и favicon из `frontend/public/site-avatar.png`;
- подготовка интерфейса и `/api/voice-config` под WebRTC;
- адаптивный игровой стол с местами игроков вокруг изображения `стол`;
- затемнение мертвых игроков, подсветка говорящего, окно победы.

## Важно про хранение данных

Комнаты сейчас хранятся в памяти backend-процесса. Для полноценного production с восстановлением после рестарта можно добавить Redis или Postgres. Для игры с друзьями на одном активном backend-сервере текущая версия уже работает.

# Мафия Онлайн

Полноценный сайт для онлайн-игры «Мафия»: комнаты, игроки, роли, фазы партии, ночные действия, голосование, текстовый чат и интерфейс игрового стола сверху. Frontend подготовлен под Vercel, backend с Socket.IO подготовлен под отдельный деплой на Render, Railway, Fly.io или VPS.

## Структура

- `frontend` - React/Vite интерфейс.
- `backend` - Node.js/Express + Socket.IO сервер комнат.
- `frontend/public/stol.png` - изображение стола, которое используется в партии.

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

## Деплой backend

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
- подготовка интерфейса и `/api/voice-config` под WebRTC;
- адаптивный игровой стол с местами игроков вокруг изображения `стол`;
- затемнение мертвых игроков, подсветка говорящего, окно победы.

## Важно про хранение данных

Комнаты сейчас хранятся в памяти backend-процесса. Для полноценного production с восстановлением после рестарта можно добавить Redis или Postgres. Для игры с друзьями на одном активном backend-сервере текущая версия уже работает.

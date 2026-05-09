import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createGameEngine } from "./domain/gameEngine.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin,
    credentials: true
  })
);
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin === "*" ? true : corsOrigin,
    credentials: true
  }
});

const engine = createGameEngine(io);

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "mafia-online-backend",
    stats: engine.getStats()
  });
});

app.get("/api/voice-config", (_request, response) => {
  response.json({
    enabled: true,
    status: "prepared",
    iceServers: [
      {
        urls: process.env.WEBRTC_STUN_URL || "stun:stun.l.google.com:19302"
      }
    ],
    note: "Socket.IO is already used for room signaling. Attach WebRTC offers/answers here when real voice media is added."
  });
});

io.on("connection", (socket) => {
  engine.bindSocket(socket);
});

server.listen(port, () => {
  console.log(`Mafia backend listening on http://localhost:${port}`);
});

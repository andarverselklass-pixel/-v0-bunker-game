// ============================================================
//  СЕРВЕР «БУНКЕР» — Socket.io + Express
//  Деплой: Render.com (бесплатно)
//  Переменные окружения: MONGODB_URI (опционально), PORT
// ============================================================

import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import { initDB, loadAllRooms, saveRoom, deleteRoom } from "./store.js"
import {
  createRoom, makePlayer, viewFor,
  startGame, revealCard, useSpecial, triggerEvent,
  goVote, castVote, resolveVote, nextRound, finishGame, resetRoom,
} from "./gameEngine.js"

const app = express()
app.use(cors({ origin: "*" }))
app.use(express.json())

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Комнаты в памяти: code → roomObj
const rooms = new Map()

// ---------- REST health-check ----------
app.get("/health", (req, res) => res.json({ ok: true, rooms: rooms.size }))

// ============================================================
//  SOCKET.IO
// ============================================================

function broadcast(code, event, data) {
  io.to(code).emit(event, data)
}

// Отправить актуальное состояние всем игрокам комнаты
function pushState(room) {
  for (const player of room.players) {
    const sid = player.socketId
    if (sid) {
      io.to(sid).emit("state", viewFor(room, player.id))
    }
  }
  saveRoom(room)
}

// Найти игрока по socketId
function findPlayerBySocket(socketId) {
  for (const room of rooms.values()) {
    const player = room.players.find((p) => p.socketId === socketId)
    if (player) return { room, player }
  }
  return null
}

io.on("connection", (socket) => {
  console.log("[ws] connect", socket.id)

  // ── Создать комнату ──────────────────────────────────────
  socket.on("createRoom", ({ name, maxPlayers = 20, cardsPerRound = 2 }, cb) => {
    try {
      const room = createRoom(name, socket.id)
      room.maxPlayers = maxPlayers
      room.cardsPerRound = cardsPerRound
      rooms.set(room.code, room)
      socket.join(room.code)
      saveRoom(room)
      cb({ ok: true, code: room.code, playerId: room.players[0].id })
    } catch (e) {
      cb({ error: e.message })
    }
  })

  // ── Войти в комнату ──────────────────────────────────────
  socket.on("joinRoom", ({ code, name }, cb) => {
    const room = rooms.get(code?.toUpperCase())
    if (!room) return cb({ error: "Комната не найдена." })
    if (room.screen !== "lobby") return cb({ error: "Игра уже началась." })
    if (room.players.length >= (room.maxPlayers || 20)) return cb({ error: "Комната заполнена." })

    const player = makePlayer(name, socket.id)
    room.players.push(player)
    socket.join(room.code)
    saveRoom(room)
    pushState(room)
    cb({ ok: true, code: room.code, playerId: player.id })
  })

  // ── Переподключение (например после обновления страницы) ─
  socket.on("reconnectRoom", ({ code, playerId }, cb) => {
    const room = rooms.get(code?.toUpperCase())
    if (!room) return cb({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player) return cb({ error: "Игрок не найден." })
    player.socketId = socket.id
    player.connected = true
    socket.join(room.code)
    pushState(room)
    cb({ ok: true })
  })

  // ── Настройка лобби ──────────────────────────────────────
  socket.on("setCardsPerRound", ({ code, playerId, n }) => {
    const room = rooms.get(code)
    if (!room) return
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return
    room.cardsPerRound = Math.max(1, Math.min(3, n))
    pushState(room)
  })

  socket.on("kickPlayer", ({ code, playerId, targetId }) => {
    const room = rooms.get(code)
    if (!room) return
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return
    room.players = room.players.filter((p) => p.id !== targetId)
    pushState(room)
  })

  // ── Старт игры ───────────────────────────────────────────
  socket.on("startGame", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий может начать." })
    const result = startGame(room)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Раскрыть карту ───────────────────────────────────────
  socket.on("revealCard", ({ code, playerId, cardKey }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const result = revealCard(room, playerId, cardKey)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Применить спецкарту ──────────────────────────────────
  socket.on("useSpecial", ({ code, playerId, targetId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const result = useSpecial(room, playerId, targetId)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Завершить раунд → событие ────────────────────────────
  socket.on("triggerEvent", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    const result = triggerEvent(room)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── К голосованию ────────────────────────────────────────
  socket.on("goVote", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    goVote(room)
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Проголосовать ────────────────────────────────────────
  socket.on("castVote", ({ code, playerId, targetId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const result = castVote(room, playerId, targetId)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Подвести итог голосования ────────────────────────────
  socket.on("resolveVote", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    const result = resolveVote(room)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Следующий раунд ──────────────────────────────────────
  socket.on("nextRound", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    nextRound(room)
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Завершить игру ───────────────────────────────────────
  socket.on("finishGame", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    const result = finishGame(room)
    if (result.error) return cb?.({ error: result.error })
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Новая игра ───────────────────────────────────────────
  socket.on("resetRoom", ({ code, playerId }, cb) => {
    const room = rooms.get(code)
    if (!room) return cb?.({ error: "Комната не найдена." })
    const player = room.players.find((p) => p.id === playerId)
    if (!player?.isHost) return cb?.({ error: "Только ведущий." })
    resetRoom(room)
    pushState(room)
    cb?.({ ok: true })
  })

  // ── Чат ─────────────────────────────────────────────────
  socket.on("chatMsg", ({ code, playerId, text }) => {
    const room = rooms.get(code)
    if (!room || !text?.trim()) return
    const player = room.players.find((p) => p.id === playerId)
    if (!player) return
    const msg = {
      id: Date.now().toString(),
      name: player.name,
      text: text.trim().slice(0, 200),
      t: Date.now(),
    }
    broadcast(code, "chatMsg", msg)
  })

  // ── Отключение ───────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("[ws] disconnect", socket.id)
    const found = findPlayerBySocket(socket.id)
    if (!found) return
    const { room, player } = found
    player.connected = false
    player.socketId = null
    pushState(room)

    // Через 5 минут удалить если не переподключился
    setTimeout(() => {
      const r = rooms.get(room.code)
      if (!r) return
      const p = r.players.find((x) => x.id === player.id)
      if (p && !p.connected) {
        // Если все отключились — удалить комнату
        if (r.players.every((x) => !x.connected)) {
          rooms.delete(r.code)
          deleteRoom(r.code)
          console.log("[room] удалена", r.code)
        }
      }
    }, 5 * 60 * 1000)
  })
})

// ============================================================
//  СТАРТ
// ============================================================
const PORT = process.env.PORT || 3001

async function main() {
  await initDB()
  // Загрузить активные комнаты из БД
  const saved = await loadAllRooms()
  for (const room of saved) {
    // Все игроки офлайн после перезапуска
    room.players.forEach((p) => { p.connected = false; p.socketId = null })
    rooms.set(room.code, room)
  }
  console.log(`[db] Загружено комнат: ${saved.length}`)

  httpServer.listen(PORT, () => {
    console.log(`[server] Бункер запущен на порту ${PORT}`)
  })
}

main().catch(console.error)

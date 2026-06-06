// ============================================================
//  ХРАНИЛИЩЕ КОМНАТ (MongoDB Atlas)
//  Хранит только АКТИВНЫЕ комнаты, чтобы восстановить их после
//  перезапуска сервера (бесплатный Render усыпляет инстанс).
//  Если MONGODB_URI не задан — работаем чисто в памяти.
// ============================================================

import mongoose from "mongoose"

const RoomSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed }, // весь объект комнаты
    updatedAt: { type: Date, default: Date.now, index: true },
  },
  { minimize: false }
)

// автоудаление неактивных комнат через 12 часов
RoomSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 12 })

let RoomModel = null
let connected = false

export async function initDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.log("[db] MONGODB_URI не задан — работаем только в памяти.")
    return false
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
    RoomModel = mongoose.models.Room || mongoose.model("Room", RoomSchema)
    connected = true
    console.log("[db] MongoDB Atlas подключена.")
    return true
  } catch (err) {
    console.error("[db] Ошибка подключения к MongoDB:", err.message)
    connected = false
    return false
  }
}

export function dbReady() {
  return connected
}

// Загрузить все активные комнаты в память при старте
export async function loadAllRooms() {
  if (!connected) return []
  try {
    const docs = await RoomModel.find({}).lean()
    return docs.map((d) => d.data).filter(Boolean)
  } catch (err) {
    console.error("[db] loadAllRooms:", err.message)
    return []
  }
}

// Сохранить/обновить комнату
export async function saveRoom(room) {
  if (!connected) return
  try {
    room.updatedAt = Date.now()
    await RoomModel.updateOne(
      { code: room.code },
      { $set: { code: room.code, data: room, updatedAt: new Date() } },
      { upsert: true }
    )
  } catch (err) {
    console.error("[db] saveRoom:", err.message)
  }
}

export async function deleteRoom(code) {
  if (!connected) return
  try {
    await RoomModel.deleteOne({ code })
  } catch (err) {
    console.error("[db] deleteRoom:", err.message)
  }
}

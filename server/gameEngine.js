// ============================================================
//  ИГРОВОЙ ДВИЖОК «БУНКЕР» — авторитетная логика комнаты
//  Состояние комнаты живёт в памяти сервера, MongoDB используется
//  только для восстановления активных комнат после перезапуска.
// ============================================================

import {
  DISASTERS, EVENTS, SPECIAL_CARDS, CARD_TYPES, RESOURCE_KEYS,
  rnd, uid, clamp, genCode, makeCards, makeBunker, applyEffect,
} from "./gameData.js"

const TYPE_LABEL = Object.fromEntries(CARD_TYPES.map((c) => [c.key, c.label]))

function logEntry(text, kind = "info") {
  return { id: uid(), text, kind, t: Date.now() }
}

// ---------- создание комнаты ----------
export function createRoom(hostName, hostSocketId) {
  const code = genCode()
  const host = makePlayer(hostName, hostSocketId)
  host.isHost = true
  return {
    code,
    screen: "lobby",
    hostId: host.id,
    players: [host],
    bunker: null,
    disaster: null,
    cardsPerRound: 2,
    round: 0,
    log: [],
    currentEvent: null,
    votes: {},
    history: [],
    result: null,
    updatedAt: Date.now(),
  }
}

export function makePlayer(name, socketId) {
  return {
    id: uid(),
    socketId: socketId || null,
    name: (name || "Игрок").trim().slice(0, 16) || "Игрок",
    connected: true,
    isHost: false,
    cards: makeCards(),
    special: rnd(SPECIAL_CARDS),
    specialUsed: false,
    immune: false,
    eliminated: false,
  }
}

// ============================================================
//  САНИТАЙЗ: что именно видит конкретный игрок
//  Свои карты — целиком, чужие — только раскрытые.
// ============================================================
export function viewFor(room, playerId) {
  const players = room.players.map((p) => {
    const isSelf = p.id === playerId
    const cards = {}
    for (const ct of CARD_TYPES) {
      const c = p.cards[ct.key]
      if (isSelf || c.revealed) {
        cards[ct.key] = { value: c.value, icon: c.icon || null, revealed: c.revealed }
      } else {
        cards[ct.key] = { value: null, icon: null, revealed: false }
      }
    }
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.isHost,
      isSelf,
      eliminated: p.eliminated,
      immune: p.immune,
      specialUsed: p.specialUsed,
      // спецкарту видит только владелец
      special: isSelf ? p.special : null,
      cards,
    }
  })

  return {
    code: room.code,
    screen: room.screen,
    hostId: room.hostId,
    youAreHost: room.hostId === playerId,
    cardsPerRound: room.cardsPerRound,
    round: room.round,
    bunker: room.bunker,
    disaster: room.disaster,
    currentEvent: room.currentEvent,
    log: room.log,
    history: room.history,
    result: room.result,
    // кто уже проголосовал (без раскрытия за кого)
    votedIds: Object.keys(room.votes),
    players,
    yourId: playerId,
  }
}

// ============================================================
//  ДЕЙСТВИЯ (мутируют room на месте)
// ============================================================

export function startGame(room) {
  if (room.players.length < 2) return { error: "Нужно минимум 2 игрока." }
  const bunker = makeBunker()
  const disaster = rnd(DISASTERS)
  let res = { ...bunker.resources }
  room.players.forEach((p) => {
    res = applyEffect(res, p.cards.profession.bonus || {})
  })
  room.bunker = { ...bunker, resources: res, seats: disaster.seats }
  room.disaster = disaster
  room.round = 1
  room.screen = "game"
  room.log = [
    logEntry(`☢ Катастрофа: ${disaster.name}. ${disaster.desc}`, "disaster"),
    logEntry(`🏠 Бункер: ${bunker.size}. Особенность: ${bunker.feature}. Мест: ${disaster.seats}.`, "system"),
    logEntry(`🎮 Игра началась! Игроков: ${room.players.length}.`, "system"),
  ]
  room.history = [{ kind: "start", text: `Партия началась. Катастрофа: ${disaster.name}.` }]
  return { ok: true }
}

export function revealCard(room, playerId, cardKey) {
  const player = room.players.find((p) => p.id === playerId)
  if (!player || player.eliminated) return { error: "Нельзя раскрыть." }
  const c = player.cards[cardKey]
  if (!c || c.revealed) return { error: "Уже раскрыто." }
  c.revealed = true
  room.log.push(logEntry(`${player.name} раскрыл «${TYPE_LABEL[cardKey]}»: ${c.value}`, "reveal"))
  return { ok: true }
}

export function useSpecial(room, playerId, targetId) {
  const player = room.players.find((p) => p.id === playerId)
  if (!player || player.specialUsed || player.eliminated) return { error: "Нельзя использовать." }
  const card = player.special
  const target = targetId ? room.players.find((p) => p.id === targetId) : null
  player.specialUsed = true

  switch (card.id) {
    case "immunity":
      player.immune = true
      room.log.push(logEntry(`🛡 ${player.name} получил иммунитет от голосования.`, "special"))
      break
    case "reveal_other":
      if (target) {
        const hidden = CARD_TYPES.map((c) => c.key).filter((k) => !target.cards[k].revealed)
        const key = hidden.length ? rnd(hidden) : "hobby"
        target.cards[key].revealed = true
        room.log.push(logEntry(`🔍 ${player.name} вскрыл «${TYPE_LABEL[key]}» у ${target.name}: ${target.cards[key].value}`, "special"))
      }
      break
    case "swap_prof":
      if (target) {
        const tmp = player.cards.profession
        player.cards.profession = target.cards.profession
        target.cards.profession = tmp
        room.log.push(logEntry(`🔄 ${player.name} и ${target.name} обменялись профессиями.`, "special"))
      }
      break
    case "swap_health":
      if (target) {
        const tmp = player.cards.bio
        player.cards.bio = target.cards.bio
        target.cards.bio = tmp
        room.log.push(logEntry(`❤ ${player.name} и ${target.name} обменялись биоособенностями.`, "special"))
      }
      break
    case "add_seat":
      room.bunker.seats += 1
      room.log.push(logEntry(`➕ ${player.name} добавил место в бункере (теперь ${room.bunker.seats}).`, "special"))
      break
    case "remove_seat":
      room.bunker.seats = Math.max(1, room.bunker.seats - 1)
      room.log.push(logEntry(`➖ ${player.name} убрал место в бункере (теперь ${room.bunker.seats}).`, "special"))
      break
    case "revote":
      room.votes = {}
      room.screen = "vote"
      room.log.push(logEntry(`🔁 ${player.name} объявил повторное голосование.`, "special"))
      break
    case "revive": {
      const dead = room.players.filter((p) => p.eliminated)
      if (dead.length) {
        const back = rnd(dead)
        back.eliminated = false
        room.log.push(logEntry(`✨ ${player.name} воскресил игрока ${back.name}.`, "special"))
      } else {
        room.log.push(logEntry(`✨ ${player.name} попытался воскресить, но некого.`, "special"))
      }
      break
    }
    case "steal_item":
      if (target) {
        const stolen = target.cards.item.value
        player.cards.item = { ...target.cards.item }
        target.cards.item = { value: "—", revealed: true }
        room.log.push(logEntry(`🤏 ${player.name} украл предмет «${stolen}» у ${target.name}.`, "special"))
      }
      break
    case "secret_reveal":
      room.log.push(logEntry(`👁 ${player.name} тайно изучил карту другого игрока.`, "special"))
      break
    default:
      break
  }
  room.history.push({ kind: "special", text: `${player.name} использовал «${card.name}».` })
  return { ok: true }
}

export function triggerEvent(room) {
  const ev = rnd(EVENTS)
  room.currentEvent = ev
  room.bunker.resources = applyEffect(room.bunker.resources, ev.effect)
  room.screen = "event"
  room.log.push(logEntry(`${ev.icon} Событие: ${ev.name}. ${ev.desc}`, "event"))
  room.history.push({ kind: "event", text: `Раунд ${room.round}: ${ev.name}.` })
  return { ok: true }
}

export function goVote(room) {
  room.screen = "vote"
  room.votes = {}
  return { ok: true }
}

export function castVote(room, voterId, targetId) {
  const voter = room.players.find((p) => p.id === voterId)
  if (!voter || voter.eliminated) return { error: "Нельзя голосовать." }
  room.votes[voterId] = targetId
  return { ok: true }
}

export function resolveVote(room) {
  const tally = {}
  Object.values(room.votes).forEach((tid) => {
    if (tid) tally[tid] = (tally[tid] || 0) + 1
  })
  let maxId = null
  let maxN = -1
  Object.entries(tally).forEach(([id, n]) => {
    if (n > maxN) { maxN = n; maxId = id }
  })
  const target = room.players.find((p) => p.id === maxId)

  if (!target) {
    room.log.push(logEntry("🗳 Голосование не дало результата — никто не исключён.", "vote"))
  } else if (target.immune) {
    target.immune = false
    room.log.push(logEntry(`🛡 ${target.name} имел иммунитет — исключение отменено.`, "vote"))
    room.history.push({ kind: "vote", text: `Раунд ${room.round}: ${target.name} спасён иммунитетом.` })
  } else {
    target.eliminated = true
    room.log.push(logEntry(`☠ ${target.name} исключён из бункера (${maxN} голос(ов)).`, "vote"))
    room.history.push({ kind: "vote", text: `Раунд ${room.round}: исключён ${target.name}.` })
  }
  room.players.forEach((p) => (p.immune = false))
  room.votes = {}
  room.screen = "voteResult"
  return { ok: true }
}

export function nextRound(room) {
  room.screen = "game"
  room.round += 1
  room.currentEvent = null
  return { ok: true }
}

export function finishGame(room) {
  const alive = room.players.filter((p) => !p.eliminated)
  const res = room.bunker.resources
  const sum = RESOURCE_KEYS.reduce((a, k) => a + res[k], 0)
  const base = sum / 6

  const bonusProfs = alive.filter((p) => Object.keys(p.cards.profession.bonus || {}).length > 0)
  const profMult = 1 + bonusProfs.length * 0.04

  const negEvents = room.history.filter((h) => h.kind === "event").length
  const eventMult = Math.max(0.6, 1 - negEvents * 0.03)

  const coef = room.disaster.coef
  let chance = Math.round(clamp(base * coef * profMult * eventMult))
  const survived = chance > 60

  const reasons = []
  const keyProfs = ["Врач", "Инженер", "Военный", "Фермер"]
  alive.forEach((p) => {
    if (keyProfs.includes(p.cards.profession.value)) {
      reasons.push(`В бункере был ${p.cards.profession.value.toLowerCase()} (${p.name}) — большой плюс.`)
    }
  })
  const RES_LABEL = { food: "еда", water: "вода", power: "электро", medicine: "медицина", defense: "защита", morale: "мораль" }
  RESOURCE_KEYS.forEach((k) => {
    if (res[k] < 30) reasons.push(`Критически не хватало: ${RES_LABEL[k]} (${res[k]}%).`)
    if (res[k] > 80) reasons.push(`Отличный запас: ${RES_LABEL[k]} (${res[k]}%).`)
  })
  if (alive.length > room.bunker.seats) reasons.push(`Людей больше, чем мест (${alive.length}/${room.bunker.seats}) — перенаселение.`)
  else reasons.push(`Все выжившие поместились в бункер (${alive.length}/${room.bunker.seats}).`)
  if (negEvents >= 3) reasons.push("Слишком много разрушительных событий подорвало запасы.")

  const finalReasons = reasons.slice(0, 5)
  if (finalReasons.length < 3) finalReasons.push(`Итоговый уровень ресурсов: ${Math.round(base)}%.`)

  room.screen = "results"
  room.result = { chance, survived, reasons: finalReasons, base: Math.round(base) }
  room.log.push(logEntry(`🏁 Партия завершена. Вероятность выживания: ${chance}%.`, "system"))
  return { ok: true }
}

export function resetRoom(room) {
  // вернуть в лобби с новыми картами, сохранив игроков
  room.screen = "lobby"
  room.round = 0
  room.bunker = null
  room.disaster = null
  room.currentEvent = null
  room.votes = {}
  room.log = []
  room.history = []
  room.result = null
  room.players.forEach((p) => {
    p.cards = makeCards()
    p.special = rnd(SPECIAL_CARDS)
    p.specialUsed = false
    p.immune = false
    p.eliminated = false
  })
  return { ok: true }
}

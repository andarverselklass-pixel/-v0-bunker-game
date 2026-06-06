import { useState, useEffect, useRef, useCallback } from "react"
import { io } from "socket.io-client"
import { Analytics } from "@vercel/analytics/react"

// ── Адрес сервера ────────────────────────────────────────────
// При деплое замените на URL вашего Render сервера:
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001"

// ── Хранилище сессии ────────────────────────────────────────
const SS = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)) } catch { return null } },
  set: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)),
  del: (k) => sessionStorage.removeItem(k),
}

const RESOURCE_META = {
  food:     { label: "Еда",      icon: "🍞", color: "#e9c46a" },
  water:    { label: "Вода",     icon: "💧", color: "#48cae4" },
  power:    { label: "Электро",  icon: "⚡", color: "#f4a261" },
  medicine: { label: "Медицина", icon: "✚", color: "#90be6d" },
  defense:  { label: "Защита",   icon: "🛡", color: "#457b9d" },
  morale:   { label: "Мораль",   icon: "☯", color: "#e63946" },
}
const RESOURCE_KEYS = ["food","water","power","medicine","defense","morale"]

const CARD_ICONS = {
  profession:"💼", hobby:"🎯", phobia:"😱", trait:"🧠",
  bio:"🩺", item:"🎒", baggage:"📦",
}
const CARD_LABELS = {
  profession:"Профессия", hobby:"Хобби", phobia:"Фобия", trait:"Черта",
  bio:"Биоособенность", item:"Предмет", baggage:"Багаж",
}
const CARD_KEYS = Object.keys(CARD_ICONS)

// ── Хук Socket.io ───────────────────────────────────────────
function useSocket() {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ["websocket","polling"] })
    s.on("connect", () => setConnected(true))
    s.on("disconnect", () => setConnected(false))
    setSocket(s)
    return () => s.disconnect()
  }, [])

  return { socket, connected }
}

// ── Главный компонент ───────────────────────────────────────
export default function App() {
  const { socket, connected } = useSocket()
  const [screen, setScreen] = useState("home") // home | lobby | game | event | vote | voteResult | results
  const [gameState, setGameState] = useState(null)
  const [session, setSession] = useState(null) // { code, playerId }
  const [chatMsgs, setChatMsgs] = useState([])
  const [error, setError] = useState("")

  // Восстановить сессию после перезагрузки
  useEffect(() => {
    if (!socket) return
    const saved = SS.get("bunker_session")
    if (saved?.code && saved?.playerId) {
      socket.emit("reconnectRoom", saved, (res) => {
        if (res.error) { SS.del("bunker_session"); return }
        setSession(saved)
      })
    }
  }, [socket])

  // Слушать обновления состояния
  useEffect(() => {
    if (!socket) return
    socket.on("state", (state) => {
      setGameState(state)
      setScreen(state.screen === "voteResult" ? "voteResult" : state.screen)
    })
    socket.on("chatMsg", (msg) => {
      setChatMsgs((prev) => [...prev.slice(-100), msg])
    })
    return () => {
      socket.off("state")
      socket.off("chatMsg")
    }
  }, [socket])

  const emit = useCallback((event, data, cb) => {
    if (!socket) return
    socket.emit(event, { ...data, ...session }, cb || (() => {}))
  }, [socket, session])

  const handleError = (res, onOk) => {
    if (res?.error) { setError(res.error); setTimeout(() => setError(""), 3000) }
    else if (onOk) onOk(res)
  }

  if (!connected) return <Loading />

  if (!session || screen === "home") {
    return <HomeScreen socket={socket} setSession={setSession} setError={setError} error={error} />
  }

  const me = gameState?.players?.find((p) => p.isSelf)

  const props = { gameState, session, emit, me, error, chatMsgs, handleError }

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="bg-grid" />
      <main className="container">
        {error && <div className="toast">{error}</div>}
        {screen === "lobby"      && <LobbyScreen {...props} />}
        {screen === "game"       && <GameScreen {...props} />}
        {screen === "event"      && <EventScreen {...props} />}
        {screen === "vote"       && <VoteScreen {...props} />}
        {screen === "voteResult" && <VoteResultScreen {...props} />}
        {screen === "results"    && <ResultsScreen {...props} />}
      </main>
      <Analytics />
    </div>
  )
}

// ── Загрузка ─────────────────────────────────────────────────
function Loading() {
  return (
    <div className="app" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
      <style>{CSS}</style>
      <div className="panel" style={{ textAlign:"center", padding:"40px" }}>
        <div style={{ fontSize:48, marginBottom:16 }} className="pulse">☢</div>
        <p style={{ color:"var(--muted)" }}>Подключение к серверу…</p>
      </div>
    </div>
  )
}

// ── Домашний экран ───────────────────────────────────────────
function HomeScreen({ socket, setSession, setError, error }) {
  const [name, setName] = useState(() => localStorage.getItem("bunker_name") || "")
  const [code, setCode] = useState("")
  const [view, setView] = useState("menu") // menu | create | join
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [cardsPerRound, setCardsPerRound] = useState(2)
  const [loading, setLoading] = useState(false)

  const saveName = () => { if (name.trim()) localStorage.setItem("bunker_name", name.trim()) }

  const create = () => {
    if (!name.trim()) return setError("Введите имя")
    setLoading(true); saveName()
    socket.emit("createRoom", { name: name.trim(), maxPlayers, cardsPerRound }, (res) => {
      setLoading(false)
      if (res.error) return setError(res.error)
      const sess = { code: res.code, playerId: res.playerId }
      SS.set("bunker_session", sess)
      setSession(sess)
    })
  }

  const join = () => {
    if (!name.trim()) return setError("Введите имя")
    if (code.trim().length < 4) return setError("Введите код комнаты")
    setLoading(true); saveName()
    socket.emit("joinRoom", { name: name.trim(), code: code.trim().toUpperCase() }, (res) => {
      setLoading(false)
      if (res.error) return setError(res.error)
      const sess = { code: res.code, playerId: res.playerId }
      SS.set("bunker_session", sess)
      setSession(sess)
    })
  }

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="bg-grid" />
      <main className="container">
        {error && <div className="toast">{error}</div>}
        <div className="screen fade">
          <div className="hero">
            <div className="hero-icon pulse">☢</div>
            <h1 className="title">БУНКЕР</h1>
            <p className="subtitle">Социальная игра на выживание · онлайн</p>
          </div>
          <div className="panel slide">
            <label className="field-label">Ваше имя</label>
            <input className="input" placeholder="Введите имя" value={name}
              onChange={e => setName(e.target.value)} maxLength={16} />

            {view === "menu" && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <button className="btn btn-primary" onClick={() => { setView("create"); setError("") }}>
                  Создать комнату ▶
                </button>
                <button className="btn btn-secondary" onClick={() => { setView("join"); setError("") }}>
                  Войти по коду ▶
                </button>
              </div>
            )}

            {view === "create" && (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <label className="field-label">Максимум игроков: <b style={{color:"var(--red)"}}>{maxPlayers}</b></label>
                <input type="range" min={4} max={20} value={maxPlayers}
                  onChange={e => setMaxPlayers(+e.target.value)} style={{ width:"100%" }} />
                <label className="field-label">Раскрытий за раунд: <b style={{color:"var(--red)"}}>{cardsPerRound}</b></label>
                <input type="range" min={1} max={3} value={cardsPerRound}
                  onChange={e => setCardsPerRound(+e.target.value)} style={{ width:"100%" }} />
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => setView("menu")}>← Назад</button>
                  <button className="btn btn-primary" style={{ flex:2 }} onClick={create} disabled={loading}>
                    {loading ? "…" : "Создать"}
                  </button>
                </div>
              </div>
            )}

            {view === "join" && (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <label className="field-label">Код комнаты</label>
                <input className="input" placeholder="ABCD" value={code} maxLength={6}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  style={{ textAlign:"center", letterSpacing:"0.3em", fontSize:24, fontWeight:800 }} />
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => setView("menu")}>← Назад</button>
                  <button className="btn btn-primary" style={{ flex:2 }} onClick={join} disabled={loading}>
                    {loading ? "…" : "Войти"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="hint" style={{ textAlign:"center" }}>Без регистрации. Просто введи имя и играй.</p>
        </div>
      </main>
    </div>
  )
}

// ── Лобби ───────────────────────────────────────────────────
function LobbyScreen({ gameState, emit, me, handleError }) {
  if (!gameState) return null
  const { players, code, cardsPerRound, youAreHost } = gameState

  return (
    <div className="screen fade">
      <div className="topbar">
        <h2 className="h2">Лобби</h2>
        <div className="code-chip">Код: <b>{code}</b></div>
      </div>

      <div className="panel slide">
        <p className="hint">Поделитесь кодом <b>{code}</b> с друзьями — они введут его на главной странице.</p>
        <div className="players-grid" style={{ marginTop:12 }}>
          {players.map((p, i) => (
            <div key={p.id} className={`player-chip ${p.connected ? "" : "dead"}`}>
              <span className="player-num">{i+1}</span>
              <span className="player-name">{p.name}</span>
              {p.isHost && <span className="host-badge">★ ведущий</span>}
              {!p.connected && <span style={{ fontSize:11, color:"var(--muted)" }}>офлайн</span>}
              {youAreHost && !p.isHost && (
                <button className="x-btn" onClick={() =>
                  emit("kickPlayer", { targetId: p.id })}>✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {youAreHost && (
        <div className="panel slide">
          <label className="field-label">Раскрытий за раунд</label>
          <div className="seg">
            {[1,2,3].map(n => (
              <button key={n} className={`seg-btn ${cardsPerRound === n ? "active" : ""}`}
                onClick={() => emit("setCardsPerRound", { n })}>
                {n}
              </button>
            ))}
          </div>
          <button className="btn btn-primary big" disabled={players.length < 2}
            onClick={() => emit("startGame", {}, (r) => handleError(r))}>
            {players.length < 2 ? "Нужно ещё игроков" : "Начать игру ☢"}
          </button>
        </div>
      )}
      {!youAreHost && (
        <div className="panel slide" style={{ textAlign:"center", color:"var(--muted)" }}>
          Ожидаем, когда ведущий начнёт игру…
        </div>
      )}
    </div>
  )
}

// ── Игровой экран ───────────────────────────────────────────
function GameScreen({ gameState, emit, me, chatMsgs, handleError }) {
  if (!gameState || !me) return null
  const { players, bunker, disaster, round, log, youAreHost, cardsPerRound } = gameState
  const [viewPlayer, setViewPlayer] = useState(me.id)
  const [tab, setTab] = useState("cards")
  const [specialTarget, setSpecialTarget] = useState("")
  const [chatText, setChatText] = useState("")
  const chatRef = useRef(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chatMsgs])

  const player = players.find(p => p.id === viewPlayer) || players.find(p => p.isSelf)
  const alivePlayers = players.filter(p => !p.eliminated)
  const needsTarget = player?.isSelf && ["reveal_other","swap_prof","swap_health","steal_item","secret_reveal"].includes(player?.special?.id)

  const sendChat = () => {
    if (!chatText.trim()) return
    emit("chatMsg", { text: chatText })
    setChatText("")
  }

  return (
    <div className="screen fade">
      <div className="topbar">
        <div>
          <h2 className="h2">Раунд {round}</h2>
          <span className="mini">{disaster?.icon} {disaster?.name} · мест: {bunker?.seats}</span>
        </div>
        <Timer key={round} seconds={120} />
      </div>

      {/* Ресурсы */}
      <div className="res-grid panel slide">
        {RESOURCE_KEYS.map(k => (
          <ResourceBar key={k} k={k} value={bunker?.resources?.[k] ?? 0} />
        ))}
      </div>

      {/* Вкладки игроков */}
      <div className="player-tabs">
        {players.map(p => (
          <button key={p.id} onClick={() => setViewPlayer(p.id)}
            className={`ptab ${p.id === viewPlayer ? "active" : ""} ${p.eliminated ? "dead" : ""} ${!p.connected ? "offline" : ""}`}>
            {p.eliminated ? "☠ " : !p.connected ? "📵 " : ""}{p.name}
            {p.isSelf ? " (я)" : ""}
          </button>
        ))}
      </div>

      {player && (
        <>
          <div className="seg full">
            <button className={`seg-btn ${tab==="cards"?"active":""}`} onClick={() => setTab("cards")}>Карточки</button>
            <button className={`seg-btn ${tab==="log"?"active":""}`} onClick={() => setTab("log")}>Лог ({log?.length})</button>
            <button className={`seg-btn ${tab==="chat"?"active":""}`} onClick={() => setTab("chat")}>Чат ({chatMsgs.length})</button>
          </div>

          {tab === "cards" && (
            <div className="cards-grid">
              {CARD_KEYS.map(k => {
                const c = player.cards[k]
                return (
                  <div key={k} className={`card slide ${c?.revealed ? "revealed" : ""}`}>
                    <div className="card-icon">{CARD_ICONS[k]}</div>
                    <div className="card-type">{CARD_LABELS[k]}</div>
                    <div className="card-value">
                      {c?.revealed ? <>{c.icon ? c.icon+" " : ""}{c.value}</> : (player.isSelf ? <span style={{color:"var(--muted)"}}>скрыто</span> : "•••")}
                    </div>
                    {player.isSelf && !c?.revealed && !player.eliminated && (
                      <button className="btn btn-mini"
                        onClick={() => emit("revealCard", { cardKey: k }, r => handleError(r))}>
                        Раскрыть всем
                      </button>
                    )}
                    {c?.revealed && <span className="revealed-tag">✓ открыто</span>}
                  </div>
                )
              })}

              {/* Спецкарта — только своя */}
              {player.isSelf && player.special && (
                <div className="card special slide">
                  <div className="card-icon">{player.special.icon}</div>
                  <div className="card-type">Спецкарта</div>
                  <div className="card-value">{player.special.name}</div>
                  <div className="card-desc">{player.special.desc}</div>
                  {needsTarget && !player.specialUsed && (
                    <select className="input mini-select" value={specialTarget}
                      onChange={e => setSpecialTarget(e.target.value)}>
                      <option value="">Выберите цель…</option>
                      {alivePlayers.filter(p => !p.isSelf).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  {!player.specialUsed && !player.eliminated ? (
                    <button className="btn btn-mini accent"
                      disabled={needsTarget && !specialTarget}
                      onClick={() => emit("useSpecial", { targetId: specialTarget || null }, r => handleError(r))}>
                      Применить
                    </button>
                  ) : (
                    <span className="revealed-tag">{player.specialUsed ? "✓ использовано" : "—"}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "log" && <LogList log={log} />}

          {tab === "chat" && (
            <div className="panel slide" style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div ref={chatRef} className="log" style={{ maxHeight:260 }}>
                {chatMsgs.length === 0 && <p className="hint">Чат пуст.</p>}
                {chatMsgs.map(m => (
                  <div key={m.id} className="log-line info">
                    <b>{m.name}:</b> {m.text}
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <input className="input" style={{ marginBottom:0 }} placeholder="Сообщение…"
                  value={chatText} onChange={e => setChatText(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && sendChat()} maxLength={200} />
                <button className="btn btn-secondary compact" onClick={sendChat}>↑</button>
              </div>
            </div>
          )}
        </>
      )}

      {youAreHost && (
        <div className="action-bar">
          <button className="btn btn-secondary"
            onClick={() => emit("triggerEvent", {}, r => handleError(r))}>
            Завершить раунд →
          </button>
          <button className="btn btn-danger"
            onClick={() => emit("finishGame", {}, r => handleError(r))}>
            Финал 🏁
          </button>
        </div>
      )}
    </div>
  )
}

// ── Экран события ────────────────────────────────────────────
function EventScreen({ gameState, emit, handleError }) {
  if (!gameState) return null
  const { currentEvent: ev, bunker, round, youAreHost } = gameState
  if (!ev) return null

  return (
    <div className="screen fade center-screen">
      <div className="panel event-panel slide">
        <div className="event-icon pulse">{ev.icon}</div>
        <h2 className="h2">Событие раунда {round}</h2>
        <h3 className="event-name">{ev.name}</h3>
        <p className="event-desc">{ev.desc}</p>
        <div className="effects">
          {Object.entries(ev.effect).map(([k, v]) => (
            <span key={k} className={`effect-chip ${v < 0 ? "neg" : "pos"}`}>
              {RESOURCE_META[k]?.icon} {RESOURCE_META[k]?.label} {v > 0 ? "+" : ""}{v}
            </span>
          ))}
        </div>
        <div className="res-grid mini-res">
          {RESOURCE_KEYS.map(k => (
            <ResourceBar key={k} k={k} value={bunker?.resources?.[k] ?? 0} />
          ))}
        </div>
        {youAreHost ? (
          <button className="btn btn-primary big"
            onClick={() => emit("goVote", {}, r => handleError(r))}>
            К голосованию 🗳
          </button>
        ) : (
          <p className="hint" style={{ textAlign:"center", marginTop:16 }}>Ожидаем ведущего…</p>
        )}
      </div>
    </div>
  )
}

// ── Голосование ──────────────────────────────────────────────
function VoteScreen({ gameState, emit, me, handleError }) {
  if (!gameState || !me) return null
  const { players, votedIds } = gameState
  const alivePlayers = players.filter(p => !p.eliminated)
  const alreadyVoted = votedIds?.includes(me.id)

  return (
    <div className="screen fade center-screen">
      <div className="panel slide">
        <h2 className="h2">🗳 Голосование</h2>
        <p className="hint">Каждый голосует за того, кого хочет исключить из бункера.</p>
        {alreadyVoted ? (
          <p style={{ color:"#90be6d", marginTop:16, textAlign:"center" }}>✓ Вы проголосовали. Ждём остальных…</p>
        ) : (
          <>
            <p className="vote-turn">Голосуете вы: <b>{me.name}</b></p>
            <div className="vote-grid">
              {alivePlayers.filter(p => !p.isSelf).map(p => (
                <button key={p.id} className="vote-card"
                  onClick={() => emit("castVote", { targetId: p.id }, r => handleError(r))}>
                  <span className="vote-name">{p.name}</span>
                  {p.immune && <span className="immune-tag">🛡 иммунитет</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="hint" style={{ marginTop:12 }}>
          Проголосовало: {votedIds?.length || 0} / {alivePlayers.length}
        </p>
        {gameState.youAreHost && (
          <button className="btn btn-danger" style={{ marginTop:12 }}
            onClick={() => emit("resolveVote", {}, r => handleError(r))}>
            Подвести итог голосования
          </button>
        )}
      </div>
    </div>
  )
}

// ── Итог голосования ─────────────────────────────────────────
function VoteResultScreen({ gameState, emit, handleError }) {
  if (!gameState) return null
  const { log, youAreHost } = gameState
  const lastVote = [...(log || [])].reverse().find(l => l.kind === "vote")

  return (
    <div className="screen fade center-screen">
      <div className="panel slide">
        <h2 className="h2">Итог голосования</h2>
        {lastVote && <div className="log-line vote" style={{ marginTop:12 }}>{lastVote.text}</div>}
        {youAreHost ? (
          <div className="action-bar" style={{ marginTop:16 }}>
            <button className="btn btn-secondary"
              onClick={() => emit("nextRound", {}, r => handleError(r))}>
              Следующий раунд →
            </button>
            <button className="btn btn-danger"
              onClick={() => emit("finishGame", {}, r => handleError(r))}>
              Завершить игру 🏁
            </button>
          </div>
        ) : (
          <p className="hint" style={{ textAlign:"center", marginTop:16 }}>Ожидаем ведущего…</p>
        )}
      </div>
    </div>
  )
}

// ── Результаты ───────────────────────────────────────────────
function ResultsScreen({ gameState, emit, handleError }) {
  if (!gameState) return null
  const { result: r, players, bunker, disaster, history, youAreHost } = gameState
  if (!r) return null
  const alive = players.filter(p => !p.eliminated)
  const dead = players.filter(p => p.eliminated)

  return (
    <div className="screen fade">
      <div className={`result-hero panel slide ${r.survived ? "win" : "lose"}`}>
        <div className="result-icon pulse">{r.survived ? "🌅" : "💀"}</div>
        <div className="big-percent">{r.chance}%</div>
        <h2 className="result-title">{r.survived ? "ВЫ ВЫЖИЛИ" : "ВЫ НЕ ВЫЖИЛИ"}</h2>
        <p className="subtitle">{disaster?.icon} {disaster?.name}</p>
        <div className="prob-track">
          <div className="prob-fill" style={{ width:`${r.chance}%`, background: r.survived ? "#90be6d" : "#e63946" }} />
          <div className="prob-mark" style={{ left:"60%" }} />
        </div>
        <p className="hint">Порог выживания: 60%</p>
      </div>

      <div className="panel slide">
        <h3 className="h3">📋 Причины</h3>
        <ul className="reasons">{r.reasons.map((re, i) => <li key={i}>{re}</li>)}</ul>
      </div>

      <div className="panel slide">
        <h3 className="h3">🧮 Итоговые ресурсы</h3>
        <div className="res-grid">
          {RESOURCE_KEYS.map(k => <ResourceBar key={k} k={k} value={bunker?.resources?.[k] ?? 0} />)}
        </div>
      </div>

      <div className="panel slide">
        <h3 className="h3">👥 Игроки</h3>
        <div className="players-grid">
          {alive.map(p => (
            <div key={p.id} className="player-chip alive">
              <span className="player-name">{p.name}</span>
              <span className="mini">{p.cards?.profession?.value || ""}</span>
            </div>
          ))}
          {dead.map(p => (
            <div key={p.id} className="player-chip dead">
              <span className="player-name">☠ {p.name}</span>
              <span className="mini">исключён</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel slide">
        <h3 className="h3">📜 История партии</h3>
        <div className="history">
          {(history || []).map((h, i) => (
            <div key={i} className={`hist-line ${h.kind}`}>{h.text}</div>
          ))}
        </div>
      </div>

      {youAreHost && (
        <button className="btn btn-primary big"
          onClick={() => emit("resetRoom", {}, r => handleError(r))}>
          ↺ Новая игра
        </button>
      )}
    </div>
  )
}

// ── Утилиты ──────────────────────────────────────────────────
function ResourceBar({ k, value }) {
  const m = RESOURCE_META[k]
  return (
    <div className="res">
      <div className="res-head">
        <span>{m.icon} {m.label}</span>
        <span className="res-val">{value}</span>
      </div>
      <div className="res-track">
        <div className="res-fill" style={{ width:`${value}%`, background:m.color }} />
      </div>
    </div>
  )
}

function LogList({ log }) {
  return (
    <div className="log panel">
      {!log?.length && <p className="hint">Лог пуст.</p>}
      {[...(log||[])].reverse().map(l => (
        <div key={l.id} className={`log-line ${l.kind}`}>{l.text}</div>
      ))}
    </div>
  )
}

function Timer({ seconds }) {
  const [left, setLeft] = useState(seconds)
  const ref = useRef(null)
  useEffect(() => {
    ref.current = setInterval(() => setLeft(l => l > 0 ? l-1 : 0), 1000)
    return () => clearInterval(ref.current)
  }, [])
  const m = String(Math.floor(left/60)).padStart(2,"0")
  const s = String(left%60).padStart(2,"0")
  return (
    <div className={`timer ${left <= 10 ? "danger pulse" : ""}`}>
      ⏱ {m}:{s}
    </div>
  )
}

// ── CSS ──────────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#0a0a0f; --red:#e63946; --blue:#457b9d;
  --glass:rgba(255,255,255,0.05); --glass-br:rgba(255,255,255,0.12);
  --txt:#f1f3f5; --muted:#9aa0a6;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{margin:0;padding:0;min-height:100%;}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.app{position:relative;min-height:100vh;min-height:100dvh;overflow-x:hidden;}
.bg-grid{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(circle at 20% 10%,rgba(230,57,70,.14),transparent 40%),
  radial-gradient(circle at 80% 90%,rgba(69,123,157,.16),transparent 42%),
  linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),
  linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:100% 100%,100% 100%,38px 38px,38px 38px;}
.container{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:20px 16px 80px;}
.screen{display:flex;flex-direction:column;gap:16px;}
.center-screen{min-height:80vh;justify-content:center;}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
.fade{animation:fadeIn .4s ease}
.slide{animation:slideUp .45s ease both}
.pulse{animation:pulse 1.8s ease-in-out infinite}
.title{font-size:clamp(40px,12vw,72px);letter-spacing:.18em;margin:8px 0 4px;font-weight:800;
  background:linear-gradient(90deg,var(--red),#ff8a93);-webkit-background-clip:text;background-clip:text;color:transparent;}
.subtitle{color:var(--muted);margin:0;font-size:14px;text-align:center;}
.h2{font-size:22px;margin:0;font-weight:700;}
.h3{font-size:16px;margin:0 0 12px;font-weight:700;}
.mini{font-size:12px;color:var(--muted);}
.hero{text-align:center;padding:18px 0 4px;}
.hero-icon{font-size:64px;filter:drop-shadow(0 0 24px rgba(230,57,70,.5));}
.panel{background:var(--glass);border:1px solid var(--glass-br);border-radius:18px;padding:18px;
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 8px 30px rgba(0,0,0,.3);}
.field-label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em;}
.input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--glass-br);
  background:rgba(0,0,0,.25);color:var(--txt);font-size:16px;outline:none;margin-bottom:14px;}
.input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(69,123,157,.25);}
.mini-select{margin:8px 0;padding:9px;font-size:14px;}
.hint{font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.5;}
.toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999;
  background:var(--red);color:#fff;padding:12px 20px;border-radius:12px;font-weight:700;
  animation:slideUp .3s ease;}
.btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:700;
  cursor:pointer;transition:transform .12s,filter .2s,opacity .2s;color:#fff;}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-primary{background:linear-gradient(135deg,var(--red),#c1121f)}
.btn-primary:hover:not(:disabled){filter:brightness(1.1)}
.btn-secondary{background:linear-gradient(135deg,var(--blue),#1d3557)}
.btn-danger{background:rgba(230,57,70,.18);border:1px solid var(--red);color:#ff9aa2}
.btn.big{padding:16px;font-size:16px;margin-top:14px}
.btn.compact{width:54px;padding:13px;font-size:22px;flex:0 0 auto}
.btn-mini{padding:8px;font-size:13px;background:rgba(69,123,157,.25);border:1px solid var(--blue);margin-top:8px}
.btn-mini.accent{background:rgba(230,57,70,.22);border-color:var(--red)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px}
.code-chip{background:rgba(69,123,157,.2);border:1px solid var(--blue);padding:8px 12px;border-radius:10px;font-size:14px}
.players-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.player-chip{display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:12px;
  background:var(--glass);border:1px solid var(--glass-br);position:relative;}
.player-chip.alive{border-color:rgba(144,190,109,.4)}
.player-chip.dead{opacity:.55;border-color:rgba(230,57,70,.4)}
.player-num{font-size:11px;color:var(--muted)}
.player-name{font-weight:700;font-size:15px}
.host-badge{font-size:11px;color:#e9c46a}
.x-btn{position:absolute;top:8px;right:8px;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px}
.x-btn:hover{color:var(--red)}
.seg{display:flex;gap:6px;margin-bottom:8px}
.seg.full{width:100%}
.seg-btn{flex:1;padding:11px;border-radius:10px;border:1px solid var(--glass-br);
  background:rgba(0,0,0,.2);color:var(--muted);font-weight:700;cursor:pointer;font-size:14px;transition:.2s}
.seg-btn.active{background:rgba(230,57,70,.2);border-color:var(--red);color:#fff}
.res-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.mini-res{margin:14px 0}
.res-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px}
.res-val{font-weight:800}
.res-track{height:9px;border-radius:6px;background:rgba(0,0,0,.35);overflow:hidden}
.res-fill{height:100%;border-radius:6px;transition:width .6s ease}
.player-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.ptab{flex:0 0 auto;padding:9px 14px;border-radius:20px;border:1px solid var(--glass-br);
  background:rgba(0,0,0,.2);color:var(--muted);font-weight:700;cursor:pointer;font-size:13px;white-space:nowrap}
.ptab.active{background:rgba(69,123,157,.3);border-color:var(--blue);color:#fff}
.ptab.dead{opacity:.5;text-decoration:line-through}
.ptab.offline{opacity:.4}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{background:var(--glass);border:1px solid var(--glass-br);border-radius:14px;padding:14px;
  text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px;transition:.3s}
.card.revealed{border-color:rgba(144,190,109,.45);background:rgba(144,190,109,.07)}
.card.special{border-color:rgba(230,57,70,.4);background:rgba(230,57,70,.07);grid-column:1/-1}
.card-icon{font-size:30px}
.card-type{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.card-value{font-weight:800;font-size:15px;min-height:20px}
.card-desc{font-size:12px;color:var(--muted);line-height:1.4}
.revealed-tag{font-size:11px;color:#90be6d;margin-top:6px}
.action-bar{display:flex;gap:10px;margin-top:6px}
.action-bar .btn{margin-top:0}
.log{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto}
.log-line{font-size:13px;padding:9px 11px;border-radius:9px;background:rgba(0,0,0,.22);
  border-left:3px solid var(--muted);line-height:1.4}
.log-line.reveal{border-left-color:#90be6d}
.log-line.event{border-left-color:#e9c46a}
.log-line.vote{border-left-color:var(--red)}
.log-line.special{border-left-color:var(--blue)}
.log-line.disaster{border-left-color:var(--red);background:rgba(230,57,70,.1)}
.log-line.system{border-left-color:var(--blue)}
.log-line.info{border-left-color:var(--muted)}
.event-panel{text-align:center}
.event-icon{font-size:60px;margin-bottom:6px}
.event-name{font-size:24px;margin:6px 0;color:var(--red)}
.event-desc{color:var(--muted);margin:0 0 14px}
.effects{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:8px}
.effect-chip{padding:7px 11px;border-radius:20px;font-size:13px;font-weight:700}
.effect-chip.neg{background:rgba(230,57,70,.18);color:#ff9aa2}
.effect-chip.pos{background:rgba(144,190,109,.18);color:#b5e48c}
.vote-turn{font-size:18px;margin:6px 0}
.vote-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin:14px 0}
.vote-card{padding:16px 10px;border-radius:12px;border:1px solid var(--glass-br);
  background:rgba(0,0,0,.2);color:var(--txt);cursor:pointer;font-weight:700;
  display:flex;flex-direction:column;gap:4px;transition:.2s}
.vote-card:hover{background:rgba(230,57,70,.25);border-color:var(--red)}
.vote-name{font-size:15px}
.immune-tag{font-size:11px;color:#e9c46a}
.result-hero{text-align:center}
.result-hero.win{border-color:rgba(144,190,109,.5);background:rgba(144,190,109,.08)}
.result-hero.lose{border-color:rgba(230,57,70,.5);background:rgba(230,57,70,.08)}
.result-icon{font-size:64px}
.big-percent{font-size:64px;font-weight:900;line-height:1;margin:6px 0}
.result-title{font-size:26px;letter-spacing:.08em;margin:4px 0}
.prob-track{position:relative;height:14px;border-radius:8px;background:rgba(0,0,0,.4);margin:14px 0 4px;overflow:hidden}
.prob-fill{height:100%;border-radius:8px;transition:width 1s ease}
.prob-mark{position:absolute;top:-3px;width:2px;height:20px;background:#fff;opacity:.7}
.reasons{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px}
.reasons li{font-size:14px;line-height:1.5}
.history{display:flex;flex-direction:column;gap:7px;max-height:260px;overflow-y:auto}
.hist-line{font-size:13px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.22);border-left:3px solid var(--blue)}
.hist-line.event{border-left-color:#e9c46a}
.hist-line.vote{border-left-color:var(--red)}
.hist-line.special{border-left-color:var(--blue)}
.hist-line.start{border-left-color:#90be6d}
.timer{background:rgba(0,0,0,.3);border:1px solid var(--glass-br);padding:9px 14px;
  border-radius:12px;font-weight:800;font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap}
.timer.danger{border-color:var(--red);color:#ff9aa2}
@media(max-width:480px){
  .res-grid{grid-template-columns:1fr}
  .cards-grid{grid-template-columns:repeat(2,1fr)}
  .container{padding:16px 12px 80px}
}
`

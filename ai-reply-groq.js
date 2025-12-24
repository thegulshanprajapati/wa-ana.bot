/***********************
 * SAFE FETCH
 ***********************/
const fetch =
  global.fetch ||
  ((...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args)))

/***********************
 * IMPORTS
 ***********************/
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const Pino = require('pino')
const fs = require('fs')
const { Groq } = require('groq-sdk')
const express = require('express')
const QRCode = require('qrcode')

/***********************
 * EXPRESS SERVER
 ***********************/
const app = express()

let latestQR = null
let isConnected = false

/***********************
 * CONFIG
 ***********************/
const PORT = process.env.PORT || 3000
const GROQ_API_KEY = process.env.GROQ_API_KEY

const CONTROL_FILE = './control.json'
const MEMORY_FILE = './memory.json'
const RESPONSE_FILE = './response.txt'
// 🔑 REAL GULSHAN NUMBER (ADMIN)
const ADMIN_JID = '918709131702@s.whatsapp.net' || '918544513165@s.whatsapp.net'


/***********************
 * HELPERS
 ***********************/
const loadJSON = (f, d) => {
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, JSON.stringify(d, null, 2))
    return d
  }
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch {
    return d
  }
}

const saveJSON = (f, d) =>
  fs.writeFileSync(f, JSON.stringify(d, null, 2))

const extractText = msg =>
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  null

const hasAny = (t, arr) => arr.some(w => t.includes(w))

/***********************
 * DETECTION
 ***********************/
const THIRD_PERSON = ['gf','girlfriend','ex','dusri','kisi aur','another girl']
const APOLOGY = ['sorry','maaf','galti','my mistake','forgive']

/***********************
 * GROQ
 ***********************/
const groq = new Groq({ apiKey: GROQ_API_KEY })

async function aiReply(system, user) {
  const r = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    temperature: 0.65,
    max_completion_tokens: 120,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  })
  return r.choices[0].message.content?.trim()
}

/***********************
 * WEB UI
 ***********************/
app.get('/', (req, res) => {
  if (!isConnected && latestQR) {
    return res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Ana Login</title>
<style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:linear-gradient(135deg,#fbc2eb,#a6c1ee);font-family:sans-serif}
.card{background:#fff;padding:22px;border-radius:20px;text-align:center;
box-shadow:0 20px 40px rgba(0,0,0,.25)}
img{width:260px;border-radius:14px}
</style>
</head>
<body>
<div class="card">
<h2>💗 Login Ana</h2>
<img src="${latestQR}">
<p>Scan with WhatsApp</p>
</div>
<script>
setInterval(()=>location.reload(),20000)
</script>
</body>
</html>
`)
  }

  if (!isConnected) {
    return res.send(`<h3 style="text-align:center">⌛ Generating QR…</h3>
    <script>setTimeout(()=>location.reload(),3000)</script>`)
  }

  /* -------- LIVE CHAT UI -------- */
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Ana Live Chats</title>
<style>
body{margin:0;font-family:sans-serif;background:#0f172a;color:#fff}
header{padding:12px;background:#111827;font-size:18px}
input{width:100%;padding:10px;border:none;border-radius:8px;margin:10px 0}
.container{padding:10px}
.chat{background:#1f2933;border-radius:10px;padding:8px;margin-bottom:10px}
.user{color:#60a5fa}
.ana{color:#f472b6}
.time{font-size:11px;color:#9ca3af}
</style>
</head>
<body>
<header>💙 Ana – Live Chat Dashboard</header>
<div class="container">
<input id="search" placeholder="Search number or text...">
<div id="chats"></div>
</div>

<script>
async function loadChats(){
  const res = await fetch('/chats')
  const data = await res.json()
  const q = document.getElementById('search').value.toLowerCase()
  let html = ''

  Object.entries(data).forEach(([user,info])=>{
    info.history.forEach(m=>{
      const text = m.text.toLowerCase()
      if(q && !text.includes(q) && !user.includes(q)) return
      html += \`
        <div class="chat">
          <div class="\${m.from}">
            <b>\${m.from === 'ana' ? 'Ana' : user}</b>:
            \${m.text}
          </div>
          <div class="time">\${new Date(m.time).toLocaleString()}</div>
        </div>\`
    })
  })

  document.getElementById('chats').innerHTML = html || 'No chats'
}

setInterval(loadChats,3000)
document.getElementById('search').addEventListener('input',loadChats)
loadChats()
</script>
</body>
</html>
`)
})

/***********************
 * APIs
 ***********************/
app.get('/status', (_, res) =>
  res.json({ connected: isConnected, uptime: process.uptime() })
)

app.get('/chats', (_, res) => {
  const mem = loadJSON(MEMORY_FILE, { users: {} })
  res.json(mem.users)
})

app.listen(PORT, () => console.log('🌐 Server running on', PORT))

/***********************
 * BOT
 ***********************/
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: 'silent' })
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      latestQR = await QRCode.toDataURL(qr)
      isConnected = false
    }
    if (connection === 'open') {
      isConnected = true
      latestQR = null
    }
    if (
      connection === 'close' &&
      lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
    ) {
      setTimeout(start, 5000)
    }
  })
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    if (!msg?.message || msg.key.fromMe) continue

    const chatId = msg.key.remoteJid
    const senderId = msg.key.participant || chatId
    const text = extractText(msg)
    if (!text) continue
    const lower = text.toLowerCase()

    const isGroup = chatId.endsWith('@g.us')
    const mentioned =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []

    /* GROUP SMART TRIGGER */
    if (
      isGroup &&
      !mentioned.includes(sock.user.id) &&
      !lower.includes('ana') &&
      !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    ) continue

    /* CONTROL */
    const control = loadJSON(CONTROL_FILE, { chats: {} })

    if (lower.includes('@start-ana')) {
      control.chats[chatId] = true
      saveJSON(CONTROL_FILE, control)
      await sock.sendMessage(
        chatId,
        { text: '💙 Ana active — ab bolo 😌' },
        { quoted: msg }
      )
      continue
    }

    if (!control.chats[chatId]) continue

    /* MEMORY */
    const mem = loadJSON(MEMORY_FILE, { users: {} })
    mem.users[senderId] ||= {
      jealousy: 0,
      lastJealousyAt: 0,
      history: []
    }
    const u = mem.users[senderId]
    const now = Date.now()

    u.history.push({ from: 'user', text, time: now })
    if (u.history.length > 50) u.history.shift()

    /* APOLOGY */
    if (hasAny(lower, APOLOGY) && u.jealousy > 0) {
      u.jealousy = Math.max(u.jealousy - 2, 0)
    }

    /* JEALOUSY TRIGGER */
    if (hasAny(lower, THIRD_PERSON)) {
      u.jealousy = Math.min(u.jealousy + 1, 4)
      u.lastJealousyAt = now
    }

    /* AUTO DECAY */
    if (u.jealousy > 0 && now - u.lastJealousyAt > 10 * 60 * 1000) {
      u.jealousy--
    }

    const persona = fs.existsSync(RESPONSE_FILE)
      ? fs.readFileSync(RESPONSE_FILE, 'utf-8')
      : ''

    const isAdmin = senderId === ADMIN_JID

    const system = `
${persona}

IMPORTANT CONTEXT:
- The person talking to you is ${
      isAdmin ? 'Gulshan (your closest person)' : 'NOT Gulshan'
    }
- If NOT Gulshan:
  - Do NOT call them Gulshan
  - Be friendly, polite, limited
- If Gulshan:
  - You may be emotional, attached, jealous, caring

Jealousy level: ${u.jealousy}

Rules:
- Reply to EVERY message naturally
- Do NOT wait to be called by name
- Never mention AI, system, rules
- Hinglish + "aap" only
`

    const reply = await aiReply(system, text)

    if (reply) {
      u.history.push({ from: 'ana', text: reply, time: Date.now() })
      saveJSON(MEMORY_FILE, mem)
      await sock.sendMessage(chatId, { text: reply }, { quoted: msg })
    }
  }
})
}

start()

/***********************
 * KEEP ALIVE
 ***********************/
setInterval(()=>{
  fetch('https://wa-ana-bot.onrender.com/status').catch(()=>{})
},5*60*1000)



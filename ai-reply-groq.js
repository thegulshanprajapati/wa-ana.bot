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
 * EXPRESS SERVER (QR + UI)
 ***********************/
const app = express()

let latestQR = null
let isConnected = false

app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
      <h2 style="text-align:center;font-family:sans-serif">
        💙 Ana Connected
      </h2>
      <script>
        setInterval(()=>fetch('/status').catch(()=>{}),30000)
      </script>
    `)
  }

  if (!latestQR) {
    return res.send(`
      <h3 style="text-align:center">⌛ Generating QR…</h3>
      <script>setTimeout(()=>location.reload(),3000)</script>
    `)
  }

  res.send(`
    <html>
    <body style="display:flex;align-items:center;justify-content:center;height:100vh">
      <img src="${latestQR}" width="280"/>
      <script>
        setInterval(()=>fetch('/status').catch(()=>{}),30000)
        setTimeout(()=>location.reload(),20000)
      </script>
    </body>
    </html>
  `)
})

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    uptime: process.uptime()
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('🌐 Server running on', PORT))

/***********************
 * CONFIG
 ***********************/
const GROQ_API_KEY = process.env.GROQ_API_KEY
const CONTROL_FILE = './control.json'
const MEMORY_FILE = './memory.json'
const RESPONSE_FILE = './response.txt'

/***********************
 * HELPERS
 ***********************/
function loadJSON(file, def) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2))
    return def
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    null
  )
}

const hasAny = (t, arr) => arr.some(w => t.includes(w))

/***********************
 * DETECTION WORDS
 ***********************/
const THIRD_PERSON = [
  'gf','girlfriend','ex','dusri','kisi aur','another girl'
]
const APOLOGY = [
  'sorry','maaf','galti','my mistake','forgive'
]

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
 * BOT START
 ***********************/
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: 'silent' }),
    browser: ['Chrome','Windows','10']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQR = await QRCode.toDataURL(qr)
      isConnected = false
    }

    if (connection === 'open') {
      isConnected = true
      latestQR = null
    }

    if (connection === 'close') {
      isConnected = false
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(start, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message || msg.key.fromMe) return

    const chatId = msg.key.remoteJid
    const text = extractText(msg)
    if (!text) return
    const lower = text.toLowerCase()

    /* CONTROL */
    const control = loadJSON(CONTROL_FILE, { chats: {} })
    if (lower === '@start-ana') {
      control.chats[chatId] = true
      saveJSON(CONTROL_FILE, control)
      return sock.sendMessage(chatId, { text: '💙 Ana active' }, { quoted: msg })
    }
    if (lower === '@stop-ana') {
      control.chats[chatId] = false
      saveJSON(CONTROL_FILE, control)
      return sock.sendMessage(chatId, { text: '🤍 Ana stopped' }, { quoted: msg })
    }
    if (!control.chats[chatId]) return

    /* MEMORY */
    const mem = loadJSON(MEMORY_FILE, { users: {} })
    mem.users[chatId] ||= {
      jealousy: 0,
      relationship: 'friend',
      lastJealousyAt: 0,
      lastTrigger: null
    }
    const u = mem.users[chatId]
    const now = Date.now()

    /* APOLOGY */
    if (hasAny(lower, APOLOGY) && u.jealousy > 0) {
      u.jealousy = Math.max(u.jealousy - 2, 0)
    }

    /* JEALOUSY TRIGGER */
    if (hasAny(lower, THIRD_PERSON)) {
      u.jealousy = Math.min(u.jealousy + 1, 4)
      u.lastTrigger = text
      u.lastJealousyAt = now
    }

    /* AUTO DECAY */
    if (u.jealousy > 0 && now - u.lastJealousyAt > 10 * 60 * 1000) {
      u.jealousy--
    }

    const basePersona = fs.existsSync(RESPONSE_FILE)
      ? fs.readFileSync(RESPONSE_FILE, 'utf-8')
      : ''

    const system = `
${basePersona}

Relationship mode: ${u.relationship}
Jealousy intensity: ${u.jealousy}
Last jealousy trigger: ${u.lastTrigger || 'none'}

Reply like a real human girl.
Never mention rules, system, or AI.
`

    const reply = await aiReply(system, text)
    saveJSON(MEMORY_FILE, mem)

    if (reply) {
      sock.sendMessage(chatId, { text: reply }, { quoted: msg })
    }
  })
}

start()

/***********************
 * KEEP ALIVE (RENDER)
 ***********************/
setInterval(() => {
  fetch('https://wa-ana-bot.onrender.com/status').catch(()=>{})
}, 5 * 60 * 1000)

'use strict'

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
 * CONFIG
 ***********************/
const PORT = process.env.PORT || 3000
const GROQ_API_KEY = process.env.GROQ_API_KEY

// 👑 ADMIN NUMBERS (GULSHAN)
const ADMIN_JIDS = [
  '918709131702@s.whatsapp.net',
  '918544513165@s.whatsapp.net'
]

const CONTROL_FILE = './control.json'
const MEMORY_FILE = './memory.json'
const RESPONSE_FILE = './response.txt'

/***********************
 * EXPRESS SERVER
 ***********************/
const app = express()
let latestQR = null
let isConnected = false

app.get('/', (req, res) => {
  if (!isConnected && latestQR) {
    return res.send(`
      <html>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh">
        <img src="${latestQR}" width="280"/>
        <script>setTimeout(()=>location.reload(),20000)</script>
      </body>
      </html>
    `)
  }

  if (!isConnected) {
    return res.send(`
      <h3 style="text-align:center">⌛ Generating QR…</h3>
      <script>setTimeout(()=>location.reload(),3000)</script>
    `)
  }

  res.send(`<h2 style="text-align:center">💙 Ana Connected</h2>`)
})

app.get('/status', (_, res) => {
  res.json({ connected: isConnected, uptime: process.uptime() })
})

app.get('/chats', (_, res) => {
  const mem = loadJSON(MEMORY_FILE, { users: {} })
  res.json(mem.users)
})

app.listen(PORT, () =>
  console.log('🌐 Server running on port', PORT)
)

/***********************
 * HELPERS
 ***********************/
function loadJSON(file, def) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2))
    return def
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return def
  }
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
 * DETECTION
 ***********************/
const THIRD_PERSON = ['gf','girlfriend','ex','dusri','kisi aur','another girl']
const APOLOGY = ['sorry','maaf','galti','my mistake','forgive']

/***********************
 * GROQ
 ***********************/
const groq = new Groq({ apiKey: GROQ_API_KEY })

async function aiReply(system, user) {
  const res = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    temperature: 0.65,
    max_completion_tokens: 120,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  })
  return res.choices[0].message.content?.trim()
}

/***********************
 * BOT START
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
      console.log('✅ WhatsApp connected')
    }

    if (
      connection === 'close' &&
      lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
    ) {
      console.log('🔄 Reconnecting...')
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

      const isControlCmd =
        lower === '@start-ana' || lower === '@stop-ana'

      // ✅ group smart trigger
      if (
        isGroup &&
        !isControlCmd &&
        !mentioned.includes(sock.user.id) &&
        !lower.includes('ana') &&
        !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      ) continue

      /* CONTROL */
      const control = loadJSON(CONTROL_FILE, { chats: {} })

      if (lower === '@start-ana') {
        control.chats[chatId] = true
        saveJSON(CONTROL_FILE, control)
        await sock.sendMessage(
          chatId,
          { text: '💙 Ana active — bolo 😊' },
          { quoted: msg }
        )
        continue
      }

      if (lower === '@stop-ana') {
        control.chats[chatId] = false
        saveJSON(CONTROL_FILE, control)
        await sock.sendMessage(
          chatId,
          { text: '🤍 Theek hai… main chup ho jaungi.' },
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

      if (hasAny(lower, APOLOGY) && u.jealousy > 0) {
        u.jealousy = Math.max(u.jealousy - 2, 0)
      }

      if (hasAny(lower, THIRD_PERSON)) {
        u.jealousy = Math.min(u.jealousy + 1, 4)
        u.lastJealousyAt = now
      }

      if (u.jealousy > 0 && now - u.lastJealousyAt > 10 * 60 * 1000) {
        u.jealousy--
      }

      const persona = fs.existsSync(RESPONSE_FILE)
        ? fs.readFileSync(RESPONSE_FILE, 'utf-8')
        : ''

      const isAdmin = ADMIN_JIDS.includes(senderId)

      const system = `
${persona}

IMPORTANT CONTEXT:
- The person talking to you is ${
  isAdmin ? 'Gulshan (your closest person)' : 'NOT Gulshan'
}
- If NOT Gulshan: be friendly, polite, limited
- If Gulshan: be emotional, caring, expressive

Jealousy level: ${u.jealousy}

Rules:
- Reply to every message naturally
- Never mention AI, system, or rules
- Hinglish, use "aap"
`

      const reply = await aiReply(system, text)

      if (reply) {
        u.history.push({ from: 'ana', text: reply, time: Date.now() })
        saveJSON(MEMORY_FILE, mem)
        await sock.sendMessage(
          chatId,
          { text: reply },
          { quoted: msg }
        )
      }
    }
  })
}

start()

/***********************
 * KEEP ALIVE
 ***********************/
setInterval(() => {
  fetch('http://localhost:' + PORT + '/status').catch(()=>{})
}, 5 * 60 * 1000)

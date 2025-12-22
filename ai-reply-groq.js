const fetch = global.fetch || ((...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args)))

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const Pino = require('pino')
const fs = require('fs')
const { Groq } = require('groq-sdk')

const express = require('express')
const app = express()

app.get('/', (req, res) => {
  res.send('Ana bot alive 💙')
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log('🌐 Keep-alive server running on', PORT)
})


/* ================= CONFIG ================= */
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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'
const BOT_NAME = 'ana'

const CONTROL_FILE = './control.json'
const MEMORY_FILE = './memory.json'
const RESPONSE_FILE = './response.txt'

/* ================= BASIC STATE ================= */
const processed = new Set()
const cooldown = new Map()

/* ================= FILE HELPERS ================= */
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

function loadResponseRules() {
  if (!fs.existsSync(RESPONSE_FILE)) return ''
  return fs.readFileSync(RESPONSE_FILE, 'utf-8')
}

/* ================= TEXT EXTRACT ================= */
function extractText(msg) {
  if (!msg.message) return null
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    null
  )
}

/* ================= GROQ ================= */
const groq = new Groq({ apiKey: GROQ_API_KEY })

async function aiReply(userText, history) {
  const rules = loadResponseRules()

  const systemPrompt = `
${rules}

Rules you must follow strictly:
- Never mention AI, bot, system
- Reply like a real human
- WhatsApp-style reply only
- Use Hinglish
- Always use "aap"

Recent chat:
${history.join('\n')}

Now reply naturally.
`

  const res = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    temperature: 0.6,
    max_completion_tokens: 100,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ]
  })

  return res.choices[0].message.content?.trim() || null
}

/* ================= BOT ================= */
let sock
let connecting = false

async function start() {
  if (connecting) return
  connecting = true

  console.log('🚀 Ana starting...')

  const { state, saveCreds } = await useMultiFileAuthState('auth')

  sock = makeWASocket({
    auth: state,
    logger: Pino({ level: 'silent' }),
    browser: ['Chrome', 'Windows', '10']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('✅ Connected')
      connecting = false
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code && code !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting in 5s...')
        connecting = false
        setTimeout(start, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message) return
    if (msg.key.fromMe) return

    if (
      msg.message.reactionMessage ||
      msg.message.protocolMessage
    ) return

    if (processed.has(msg.key.id)) return
    processed.add(msg.key.id)
    setTimeout(() => processed.delete(msg.key.id), 60000)

    const chatId = msg.key.remoteJid
    const senderId = msg.key.participant || chatId

    const text = extractText(msg)
    if (!text) return

    const lower = text.toLowerCase()

    /* ===== START / STOP CONTROL ===== */
    const control = loadJSON(CONTROL_FILE, { chats: {} })

    if (lower.includes('@start-ana')) {
      control.chats[chatId] = true
      saveJSON(CONTROL_FILE, control)
      await sock.sendMessage(chatId, {
        text: '✅ Ana activated in this chat.'
      })
      return
    }

    if (lower.includes('@stop-ana')) {
      control.chats[chatId] = false
      saveJSON(CONTROL_FILE, control)
      await sock.sendMessage(chatId, {
        text: '⛔ Ana stopped in this chat.'
      })
      return
    }

    if (!control.chats[chatId]) return
    /* ================================ */

    const now = Date.now()
    if (now - (cooldown.get(senderId) || 0) < 4000) return
    cooldown.set(senderId, now)

    const memory = loadJSON(MEMORY_FILE, { users: {} })
    memory.users[senderId] ||= { history: [] }
    const user = memory.users[senderId]

    user.history.push(`User: ${text}`)
    if (user.history.length > 6) user.history.shift()

    const reply = await aiReply(text, user.history)
    if (!reply) return

    user.history.push(`Ana: ${reply}`)
    saveJSON(MEMORY_FILE, memory)

    await sock.sendPresenceUpdate('composing', chatId)
    await new Promise(r => setTimeout(r, 1200))
    await sock.sendMessage(chatId, { text: reply })
  })
}

start()

setInterval(() => {
  fetch('https://wa-ana-bot.onrender.com')
    .then(() => console.log('💓 Keep-alive ping sent'))
    .catch(() => console.log('⚠️ Ping failed'))
}, 10 * 60 * 1000)


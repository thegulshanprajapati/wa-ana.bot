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
let qrGeneratedAt = null

/* ================= ROOT PAGE ================= */
app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Ana Connected</title>
<style>
body{
  height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:linear-gradient(135deg,#fbc2eb,#a6c1ee);
  font-family:sans-serif;
}
.card{
  background:#fff;
  padding:26px;
  border-radius:22px;
  box-shadow:0 20px 40px rgba(0,0,0,.25);
  text-align:center;
}
</style>
</head>
<body>
<div class="card">
  <h2>💙 Ana Connected</h2>
  <p>WhatsApp login successful</p>
</div>

<script>
  // 🔁 heartbeat so Render doesn't sleep
  setInterval(()=>fetch('/status').catch(()=>{}),30000)
</script>
</body>
</html>
`)
  }

  if (!latestQR) {
    return res.send(`
<h3 style="text-align:center;font-family:sans-serif">
⌛ Generating QR…<br/>Please wait
</h3>

<script>
setTimeout(()=>location.reload(),4000)
</script>
`)
  }

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Ana Login</title>
<style>
body{
  margin:0;
  height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:linear-gradient(135deg,#fbc2eb,#a6c1ee);
  font-family:sans-serif;
}
.card{
  background:white;
  padding:20px;
  border-radius:22px;
  width:90%;
  max-width:330px;
  text-align:center;
  box-shadow:0 20px 40px rgba(0,0,0,.25);
}
img{
  width:260px;
  border-radius:16px;
  box-shadow:0 0 30px #f472b6;
}
.count{
  margin-top:10px;
  color:#555;
}
</style>
</head>
<body>
<div class="card">
  <h2>💗 Login Ana</h2>
  <p>Scan with WhatsApp</p>
  <img src="${latestQR}">
  <div class="count">
    QR expires in <span id="sec">20</span>s
  </div>
</div>

<script>
let s = 20
const el = document.getElementById('sec')

// ⏱ QR expiry refresh
setInterval(()=>{
  s--
  if(s<=0) location.reload()
  el.innerText=s
},1000)

// 💓 heartbeat (anti-sleep)
setInterval(()=>{
  fetch('/status').catch(()=>{})
},30000)
</script>
</body>
</html>
`)
})

/* ================= STATUS API ================= */
app.get('/status', (req, res) => {
  res.json({
    bot: 'Ana',
    connected: isConnected,
    qrAvailable: !!latestQR,
    uptime: process.uptime(),
    timestamp: Date.now()
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('🌐 Server running on', PORT)
})

/***********************
 * CONFIG
 ***********************/
const GROQ_API_KEY =
  process.env.GROQ_API_KEY || 'PUT_YOUR_GROQ_KEY'

const CONTROL_FILE = './control.json'
const RESPONSE_FILE = './response.txt'

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

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    null
  )
}

/***********************
 * GROQ
 ***********************/
const groq = new Groq({ apiKey: GROQ_API_KEY })

async function aiReply(text) {
  const rules = fs.existsSync(RESPONSE_FILE)
    ? fs.readFileSync(RESPONSE_FILE, 'utf-8')
    : ''

  const res = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    temperature: 0.6,
    max_completion_tokens: 100,
    messages: [
      { role: 'system', content: rules },
      { role: 'user', content: text }
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
    logger: Pino({ level: 'silent' }),
    browser: ['Chrome', 'Windows', '10']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQR = await QRCode.toDataURL(qr)
      qrGeneratedAt = Date.now()
      isConnected = false
      console.log('📸 QR generated')
    }

    if (connection === 'open') {
      isConnected = true
      latestQR = null
      qrGeneratedAt = null
      console.log('✅ WhatsApp connected')
    }

    if (connection === 'close') {
      isConnected = false
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(start, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message) return

    const chatId = msg.key.remoteJid
    const text = extractText(msg)
    if (!text) return

    const control = loadJSON(CONTROL_FILE, { chats: {} })
    const lower = text.toLowerCase()

    if (lower === '@startana') {
      control.chats[chatId] = true
      fs.writeFileSync(CONTROL_FILE, JSON.stringify(control,null,2))
      return sock.sendMessage(chatId, { text: '✅ Ana activated' })
    }

    if (lower === '@stopana') {
      control.chats[chatId] = false
      fs.writeFileSync(CONTROL_FILE, JSON.stringify(control,null,2))
      return sock.sendMessage(chatId, { text: '⛔ Ana stopped' })
    }

    if (!control.chats[chatId]) return

    const reply = await aiReply(text)
    if (reply) await sock.sendMessage(chatId, { text: reply })
  })
}

start()

/***********************
 * SERVER SELF PING (ANTI-SLEEP)
 ***********************/
setInterval(() => {
  fetch('https://wa-ana-bot.onrender.com/status')
    .then(() => console.log('💓 Keep-alive ping'))
    .catch(() => {})
}, 5 * 60 * 1000)

// safety
process.on('unhandledRejection', () => {})
process.on('uncaughtException', () => {})


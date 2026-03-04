const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const Pino = require('pino')
const qrcodeTerminal = require('qrcode-terminal')
const QRCode = require('qrcode')
const express = require('express')
const path = require('path')

// simple web server so you can open http://localhost:3000 and scan
// the QR with your phone if you prefer not to use the terminal
const app = express()
let latestQR = null
let isConnected = false

app.use(express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => {
  if (!isConnected && latestQR) {
    return res.send(`
      <html>
      <head><title>WhatsApp QR</title><link rel="stylesheet" href="/style.css" /></head>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh">
        <img src="${latestQR}" width="280" />
        <script>setTimeout(()=>location.reload(),20000)</script>
      </body>
      </html>
    `)
  }
  if (!isConnected) {
    return res.send(`<h3 style="text-align:center">⌛ Waiting for QR…</h3>`)
  }
  res.send(`<h3 style="text-align:center">✅ Connected</h3>`)
})
app.listen(process.env.PORT || 3000, () => console.log('web UI listening'))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    logger: Pino({ level: 'silent' }),
    auth: state
  })

  // store reference for other routes if needed
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    console.log('connection.update', { connection, hasQr: !!qr })

    if (qr) {
      // show in terminal and also convert to data URL for web UI
      console.log('📱 Scan this QR with WhatsApp:')
      qrcodeTerminal.generate(qr, { small: true })
      latestQR = await QRCode.toDataURL(qr)
      isConnected = false
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully')
      isConnected = true
      latestQR = null
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      console.log('❌ Connection closed. Reason:', reason)
    }
  })

  sock.ev.on('messages.upsert', ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return

    console.log('📩 Chat ID:', msg.key.remoteJid)
    if (msg.key.participant) {
      console.log('👤 Sender:', msg.key.participant)
    }
  })
}

start()

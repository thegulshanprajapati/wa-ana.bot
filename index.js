const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const Pino = require('pino')
const qrcode = require('qrcode-terminal')

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    logger: Pino({ level: 'silent' }),
    auth: state
  })

  // 🔐 SAVE SESSION
  sock.ev.on('creds.update', saveCreds)

  // 📡 CONNECTION UPDATES (QR + STATUS)
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('📱 Scan this QR with WhatsApp:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully')
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      console.log('❌ Connection closed. Reason:', reason)
    }
  })

  // 🔍 MESSAGE ID LOGGER
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

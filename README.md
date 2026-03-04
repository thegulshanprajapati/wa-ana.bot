# 🤖 Ana WhatsApp Bot

**Ana** is a smart, Hinglish-speaking WhatsApp bot built using **Baileys** and **Groq AI**, featuring a **cute web-based QR login UI**, auto-refresh, anti-sleep mechanism for Render, and a health monitoring API.

🌐 **Live URL:**  
https://wa-ana-bot.onrender.com

---

## ✨ Features

- 📱 WhatsApp bot using **@whiskeysockets/baileys**
- 🧠 AI-powered replies via **Groq**
- 💬 Hinglish + WhatsApp-style conversation
- 🖥️ **Web-based QR Login**
  - Cute & mobile responsive UI (available from both `ai-reply-groq.js` and the simpler `index.js` entrypoints)
  - Auto-refresh QR
  - QR expiry countdown
- 🟢 `/status` API for bot health
- 🔁 Anti-sleep system for **Render free hosting**
- 🧾 Chat control using commands
- 🔐 Multi-file authentication (Baileys)

---

## 🛠 Tech Stack

- **Node.js**
- **Baileys (WhatsApp Web API)**
- **Groq SDK**
- **Express.js**
- **QRCode**
- **Render (Hosting)**

---

## 📂 Project Structure

```
wa-bot/
│
├── ai-reply-groq.js     # Main bot + Express server
├── package.json
├── response.txt        # AI reply rules
├── control.json        # Chat activation control
├── auth/               # WhatsApp session files
└── README.md
```

---

## 🚀 Getting Started (Local Setup)

### 1️⃣ Clone the repository
```bash
git clone https://github.com/your-username/wa-bot.git
cd wa-bot
````

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Set environment variable

Create a `.env` file:

```env
GROQ_API_KEY=your_groq_api_key_here
```

### 4️⃣ Start the bot

```bash
npm start
```

Open in browser:

```
http://localhost:3000
```

Scan QR with WhatsApp → Bot connected ✅

---

## 🌐 Deploy on Render

### Render Configuration

* **Build Command**

```bash
npm install
```

* **Start Command**

```bash
npm start
```

* **Environment Variables**

```
GROQ_API_KEY = your_groq_api_key
```

---

## 🚀 Deploy on Vercel

This repository is also configured for deployment to [Vercel](https://vercel.com) using a serverless function.

1. Install the CLI if you haven't already:
   ```bash
   npm install -g vercel
   ```
2. Log in and link the project:
   ```bash
   vercel login
   vercel
   ```
3. Set your environment variables (e.g. `GROQ_API_KEY`) via the Vercel dashboard or CLI.
4. Deploy:
   ```bash
   vercel --prod
   ```

### Vercel Notes

* The `vercel.json` in the repo ensures all routes are handled by `ai-reply-groq.js`.
* A time‑based code (HHMM) protects the UI; enter the current Indian time (IST) to unlock the page. The code is private and never shown on the page.
* The web UI has been upgraded with a clean, responsive layout and custom CSS. All pages now load a stylesheet from `/public/style.css` and include strong Content Security Policy headers to block unsafe scripts.
* **Warning:** Vercel serverless functions are ephemeral. The WhatsApp socket connection may
not persist across invocations, so the bot might disconnect over time. For continuous
operation, consider a dedicated server/VM.

---

## 🧪 Health Check API

Check bot status using:

```
GET /status
```

Example response:

```json
{
  "bot": "Ana",
  "connected": true,
  "qrAvailable": false,
  "uptime": 12034,
  "timestamp": 1720000000000
}
```

---

## 💬 Bot Commands

| Command      | Description              |
| ------------ | ------------------------ |
| `@start-ana` | Activate Ana in the chat |
| `@stop-ana`  | Stop Ana in the chat     |

---

## 🛡 Render Anti-Sleep Strategy

To reduce sleeping on Render free tier:

* Internal self-ping every 5 minutes
* Browser heartbeat hitting `/status`
* Auto page refresh on QR screen
* Optional external monitoring (UptimeRobot)

---

## ⚠️ Troubleshooting

* **QR not appearing?**

  * Wait a few seconds; there’s sometimes a delay while WhatsApp issues the QR. A spinner is shown during this period.
  * Check the server logs for a “Received QR” message; if nothing appears the socket may not be starting.
  * If the page still says “Generating QR…” after a long time, delete the `auth/` folder and restart/redeploy the service.
* **Service sleeps sometimes?**

  * Normal for free tier hosting

---

## 📌 Future Enhancements

* Admin dashboard
* Dark mode UI
* Sound alert on QR refresh
* Analytics panel
* Multi-user roles

---

## 👤 Author

**Gulshan Prajapati**
Engineering Student | Web & AI Developer

---

## 💙 License

This project is for **learning and personal use**.
Feel free to fork, modify, and improve 🚀

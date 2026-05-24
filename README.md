# 👑 YID PLUS

Jewish Entertainment & Social Media Platform

---

## 🚀 Deploy to Vercel — Step by Step

### Vercel Dashboard Settings
| Setting | Value |
|---|---|
| **Framework Preset** | `Vite` |
| **Root Directory** | `.` (leave blank) |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |

---

## 📁 GitHub Repo Structure

```
yidplus/
├── index.html              ← main entry (DO NOT MOVE)
├── package.json
├── vite.config.js
├── vercel.json             ← route rules (DO NOT MOVE)
├── .gitignore
├── src/
│   ├── firebase/
│   │   └── config.js      ← ADD YOUR FIREBASE CONFIG HERE
│   └── pages/
│       ├── settings.html
│       └── channel.html
└── standalone/
    ├── yidplus-login.html
    ├── yidplus-dashboard.html
    ├── yidplus-shorts.html
    ├── yidplus-chat.html
    ├── yidplus-music.html
    └── yidplus-admin.html
```

---

## 🔥 Firebase Setup

Edit `src/firebase/config.js`:

```js
export const firebaseConfig = {
  apiKey:            "paste-your-key-here",
  authDomain:        "your-app.firebaseapp.com",
  projectId:         "your-app-id",
  storageBucket:     "your-app.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000:web:abc123",
}
```

Get this from:
**Firebase Console → Project Settings → Your Apps → Web App → Config**

---

## 🔑 Owner & Admin

- **Owner email (hardcoded):** `avrumy5872877@gmail.com`
- **Admin panel:** `/admin`
- **Default PIN:** `1234` (change in admin settings)

---

## 📱 Routes after deploy

| Route | Page |
|---|---|
| `/` | Main App (Home) |
| `/login` | Login / Register |
| `/shorts` | Shorts Feed |
| `/chat` | Chat & Groups |
| `/music` | Music Player |
| `/admin` | Admin Dashboard |

---

## 🖥️ Local Development

```bash
npm install
npm run dev
# → opens at http://localhost:3000
```

---

© 2024 YID PLUS · Built for the Jewish community

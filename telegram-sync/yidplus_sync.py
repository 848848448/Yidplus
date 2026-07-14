#!/usr/bin/env python3
"""
YID PLUS — Telegram channel sync
--------------------------------
Watches the PUBLIC Telegram channels you list below (using YOUR Telegram
account) and pushes every new post to your YID PLUS website, where it shows up
in the Channels tab.

You only need to fill in the CONFIG section. Everything else is automatic.

Setup (once):
  1. Go to https://my.telegram.org  ->  "API development tools"
     Create an app; copy the api_id and api_hash.
  2. Fill in API_ID, API_HASH, PHONE below.
  3. Set INGEST_URL to  https://yidplus.com/api/telegram-ingest
     and INGEST_SECRET to the same secret you set in Cloudflare
     (env var TELEGRAM_INGEST_SECRET).
  4. List your public channels in CHANNELS (just the @username, no https).
  5. Run:  pip install telethon requests   then   python yidplus_sync.py
     The first run asks for the code Telegram sends you (one time).
"""

import asyncio
import requests
from telethon import TelegramClient, events

# ============ CONFIG — fill these in ============
API_ID       = 123456                 # from my.telegram.org
API_HASH     = "your_api_hash_here"   # from my.telegram.org
PHONE        = "+1XXXXXXXXXX"          # your Telegram phone number

INGEST_URL    = "https://yidplus.com/api/telegram-ingest"
INGEST_SECRET = "paste-the-same-secret-as-in-cloudflare"

CHANNELS = [
    "allsingersinone",     # <- your public channels, one per line, no @ needed
    # "anotherchannel",
]

BACKFILL = 20   # how many recent posts to pull on first run, per channel
# ================================================


def push(username, msg):
    """Send one message to YID PLUS. Best-effort; never crashes the loop."""
    text = msg.message or ""
    media_url, media_type = "", ""
    # (v1) media stays on Telegram; we send text + a link. Captions are included.
    payload = {
        "secret": INGEST_SECRET,
        "username": username,
        "tg_msg_id": msg.id,
        "text": text,
        "media_url": media_url,
        "media_type": media_type,
        "link": f"https://t.me/{username}/{msg.id}",
        "posted_at": msg.date.isoformat() if msg.date else "",
    }
    try:
        r = requests.post(INGEST_URL, json=payload, timeout=20)
        data = r.json()
        if data.get("accepted"):
            print(f"  ✓ {username}/{msg.id}")
        else:
            print(f"  ✗ {username}/{msg.id}: {data.get('error')}")
    except Exception as e:
        print(f"  ! push failed {username}/{msg.id}: {e}")


async def main():
    client = TelegramClient("yidplus_session", API_ID, API_HASH)
    await client.start(phone=PHONE)
    print("Connected to Telegram.\n")

    # 1) Backfill recent posts once.
    for ch in CHANNELS:
        print(f"Backfilling @{ch} ...")
        try:
            async for msg in client.iter_messages(ch, limit=BACKFILL):
                if msg.message or msg.media:
                    push(ch, msg)
        except Exception as e:
            print(f"  ! could not read @{ch}: {e}")

    # 2) Listen for new posts forever.
    @client.on(events.NewMessage(chats=CHANNELS))
    async def handler(event):
        ch = getattr(event.chat, "username", None)
        if ch:
            print(f"New post in @{ch}:")
            push(ch, event.message)

    print("\nListening for new posts.  (Leave this running.)")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())

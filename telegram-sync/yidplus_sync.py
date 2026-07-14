#!/usr/bin/env python3
"""
YID PLUS — Telegram channel sync
--------------------------------
Watches the PUBLIC Telegram channels you list below (using YOUR Telegram
account) and pushes every new post to your YID PLUS website, where it shows up
in the Channels tab as an X/Twitter-style card (text, image/video, stats).

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

import base64
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

BACKFILL   = 20     # how many recent posts to pull on first run, per channel
SEND_MEDIA = True   # download photos/videos and show them (set False for text only)
MAX_MEDIA_MB = 15   # skip media larger than this
# ================================================


async def build_payload(client, username, msg, chat):
    text = msg.message or ""
    media_type, media_b64 = "", ""

    if SEND_MEDIA and msg.media:
        try:
            blob = await msg.download_media(file=bytes)
            if blob and len(blob) <= MAX_MEDIA_MB * 1024 * 1024:
                media_b64 = base64.b64encode(blob).decode("ascii")
                media_type = "video" if (msg.video or msg.video_note or msg.gif) else "photo"
        except Exception as e:
            print(f"  (media skipped: {e})")

    # Channel identity (name + @handle + avatar).
    author_name = getattr(chat, "title", None) or username
    author_avatar = ""
    try:
        pic = await client.download_profile_photo(chat, file=bytes)
        if pic:
            author_avatar = "data:image/jpeg;base64," + base64.b64encode(pic).decode("ascii")
    except Exception:
        pass

    return {
        "secret": INGEST_SECRET,
        "username": username,
        "tg_msg_id": msg.id,
        "text": text,
        "media_type": media_type,
        "media_b64": media_b64,
        "author_name": author_name,
        "author_handle": username,
        "author_avatar": author_avatar,
        "views": getattr(msg, "views", None) or 0,
        "forwards": getattr(msg, "forwards", None) or 0,
        "link": f"https://t.me/{username}/{msg.id}",
        "posted_at": msg.date.isoformat() if msg.date else "",
    }


def push(payload):
    try:
        r = requests.post(INGEST_URL, json=payload, timeout=60)
        data = r.json()
        tag = f"{payload['username']}/{payload['tg_msg_id']}"
        print(f"  {'✓' if data.get('accepted') else '✗'} {tag}" + (f": {data.get('error')}" if not data.get('accepted') else ""))
    except Exception as e:
        print(f"  ! push failed: {e}")


async def main():
    client = TelegramClient("yidplus_session", API_ID, API_HASH)
    await client.start(phone=PHONE)
    print("Connected to Telegram.\n")

    # Cache each channel's entity once (for name/avatar).
    entities = {}
    for ch in CHANNELS:
        try:
            entities[ch] = await client.get_entity(ch)
        except Exception as e:
            print(f"  ! could not resolve @{ch}: {e}")

    # 1) Backfill recent posts.
    for ch in CHANNELS:
        if ch not in entities:
            continue
        print(f"Backfilling @{ch} ...")
        try:
            async for msg in client.iter_messages(ch, limit=BACKFILL):
                if msg.message or msg.media:
                    push(await build_payload(client, ch, msg, entities[ch]))
        except Exception as e:
            print(f"  ! could not read @{ch}: {e}")

    # 2) Listen for new posts forever.
    @client.on(events.NewMessage(chats=CHANNELS))
    async def handler(event):
        ch = getattr(event.chat, "username", None)
        if ch:
            print(f"New post in @{ch}:")
            push(await build_payload(client, ch, event.message, event.chat))

    print("\nListening for new posts.  (Leave this running.)")
    await client.run_until_disconnected()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

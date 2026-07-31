# YID PLUS video converter

A tiny box that runs **ffmpeg** (which Cloudflare Workers can't). The private
bot sends it a video; it shrinks the video toward ~8MB and sends it back, so the
video arrives as a clean email attachment.

## Deploy on Railway (easiest)

1. Go to https://railway.app → sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → pick `848848448/Yidplus`.
3. In the service settings set **Root Directory** to `video-converter`.
   Railway sees the `Dockerfile` and builds it automatically.
4. Under **Variables**, add:
   - `CONVERTER_SECRET` = any long secret you choose (write it down).
5. Deploy. Railway gives you a public URL like
   `https://yidplus-video-converter-production.up.railway.app`.

## Point the bot at it

In Cloudflare → your Pages project → Settings → Variables, add:
- `VIDEO_CONVERTER_URL` = the Railway URL from above
- `VIDEO_CONVERTER_SECRET` = the same `CONVERTER_SECRET`

Redeploy the Pages project. From then on, videos the bot receives are
compressed to ~8MB before being emailed.

## Notes
- Telegram bots can only download files up to **20MB**, so send videos to the
  bot as a normal video (not "as file"). Anything the bot can download, this
  converter can shrink.
- `target_mb` defaults to 8; the bot requests `?target_mb=8`.

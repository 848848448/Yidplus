// YID PLUS — Telegram channel sync (Cloudflare Worker)
//
// Runs on a cron trigger. Each run: connect to Telegram over MTProto using your
// own account's saved auth keys, read the newest posts of every channel listed
// in the admin panel, and POST anything new to the site's ingest endpoint.
//
// Nothing here touches the yidplus.com Pages project — it is a separate Worker
// that only talks to the site over its public API.
//
// First-time setup is the /login flow below (needs the code Telegram texts you).
// After that the auth keys live in KV and every run is unattended.

import MTProto, { makeKVStorage } from './mtproto-cf.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function makeClient(env) {
  return new MTProto({
    api_id: Number(env.TELEGRAM_API_ID),
    api_hash: env.TELEGRAM_API_HASH,
    storageOptions: { instance: makeKVStorage(env.TG_SESSION) },
  });
}

// Telegram answers some calls with "you're on the wrong data centre" — follow
// it. Depth-guarded: without it a DC that keeps redirecting would recurse until
// the run dies.
async function call(mtproto, method, params, options = {}, depth = 0) {
  try {
    return await mtproto.call(method, params, options);
  } catch (error) {
    const code = error.error_code;
    const message = error.error_message || '';

    if (code === 303 && depth < 3) {
      const dcId = Number(message.split('_MIGRATE_')[1]);
      if (message.startsWith('PHONE_MIGRATE_') || message.startsWith('NETWORK_MIGRATE_')) {
        await mtproto.setDefaultDc(dcId);
      } else {
        options = { ...options, dcId };
      }
      return call(mtproto, method, params, options, depth + 1);
    }

    // FLOOD_WAIT_x = "you're asking too often, wait x seconds". Waiting costs
    // wall time, not CPU, so a short one is worth sitting out; a long one is
    // left for the next cron run rather than idling here.
    if (code === 420 && depth < 2) {
      const secs = Number(message.split('FLOOD_WAIT_')[1]) || 0;
      if (secs > 0 && secs <= 5) {
        await new Promise((r) => setTimeout(r, secs * 1000 + 250));
        return call(mtproto, method, params, options, depth + 1);
      }
    }
    throw error;
  }
}

// ── the actual sync ──
async function syncAll(env) {
  const report = { channels: 0, sent: 0, skipped: 0, deferred: 0, errors: [] };
  // Shared across channels: how many files this run may still download.
  // enabled:false means media is off entirely — posts sync text-only.
  const perRun = Number(env.MEDIA_PER_RUN || 0);
  const budget = { left: perRun, enabled: perRun > 0 };

  const listRes = await fetch(env.CHANNELS_URL);
  const listJson = await listRes.json().catch(() => ({}));
  let channels = (listJson && listJson.channels) || [];
  if (!channels.length) return { ...report, note: 'No Telegram channels added in the admin panel yet.' };

  // The media budget is shared, and a run walks the channels in order — so a
  // fixed order means the first channel eats the whole budget every single run
  // and the rest never get a turn. Rotate the starting point each run so every
  // channel advances.
  const turn = Number((await env.TG_SESSION.get('rr')) || 0);
  const start = channels.length ? turn % channels.length : 0;
  channels = channels.slice(start).concat(channels.slice(0, start));
  await env.TG_SESSION.put('rr', String((turn + 1) % 1000000));
  report.started_with = channels.length ? channels[0].username : null;

  const mtproto = makeClient(env);
  const limit = Number(env.FETCH_LIMIT || 20);
  const maxBytes = Number(env.MEDIA_MAX_MB || 20) * 1024 * 1024;

  for (const ch of channels) {
    const username = String(ch.username || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) continue;
    report.channels++;

    try {
      // Resolve @username -> channel with its access_hash.
      const resolved = await call(mtproto, 'contacts.resolveUsername', { username });
      const chat = (resolved.chats || [])[0];
      if (!chat) { report.errors.push(`@${username}: not found`); continue; }

      const history = await call(mtproto, 'messages.getHistory', {
        peer: { _: 'inputPeerChannel', channel_id: chat.id, access_hash: chat.access_hash },
        offset_id: 0, offset_date: 0, add_offset: 0,
        limit, max_id: 0, min_id: 0, hash: 0,
      });

      // Only forward what we haven't forwarded before.
      const lastKey = `last:${username}`;
      const lastSeen = Number((await env.TG_SESSION.get(lastKey)) || 0);
      const messages = (history.messages || [])
        .filter((m) => m._ === 'message' && m.id > lastSeen)
        .sort((a, b) => a.id - b.id);

      if (!messages.length) { report.skipped++; continue; }

      let highest = lastSeen;
      let stalled = false;
      for (const m of messages) {
        // With media enabled, each file is decrypted in pure JS and only a few
        // fit in one run's CPU. Stop BEFORE the post rather than after: leaving
        // lastSeen put means the next run picks it up instead of skipping it.
        // Only defer for a file we would actually fetch — an oversized one is
        // skipped anyway, so waiting on budget for it would stall the channel
        // for nothing.
        const inf = budget.enabled ? mediaInfo(m) : null;
        const needsBudget = inf && !(inf.size && inf.size > maxBytes);
        if (needsBudget && budget.left <= 0) { report.deferred++; break; }

        const res = await pushPost(env, mtproto, username, chat, m, budget);
        if (res.ok) {
          report.sent++;
          // The marker may only move over an unbroken run of successes. Taking
          // the max instead would step over a post that failed earlier in this
          // batch and drop it for good, since the next run only looks past the
          // marker — which is exactly why posts were going missing.
          if (!stalled) highest = m.id;
        } else {
          stalled = true;
          if (report.errors.length < 5) report.errors.push(`push @${username}/${m.id}: ${res.error}`);
        }
      }
      if (highest > lastSeen) await env.TG_SESSION.put(lastKey, String(highest));
    } catch (err) {
      report.errors.push(`@${username}: ${err.error_message || err.message}`);
    }
  }

  return report;
}

async function pushPost(env, mtproto, username, chat, m, budget) {
  let mediaUrl = '';
  let mediaType = '';

  // Note the KIND of media regardless of whether we fetch the bytes. With
  // streaming, the file is never downloaded at all — the client points a player
  // at /media?ch=&id= and Telegram serves it a slice at a time. The kind is
  // what tells the client which player to render.
  const kindInfo = mediaInfo(m);
  if (kindInfo) mediaType = kindInfo.kind;

  // Pull the file down and park it in R2; the post then just points at it.
  const info = budget.enabled ? kindInfo : null;
  if (info) {
    const maxBytes = Number(env.MEDIA_MAX_MB || 20) * 1024 * 1024;
    // The marker only moves over an unbroken run of successes, so a file that
    // fails every time would wedge the channel forever. Give it a few tries,
    // then let the post through without it.
    const failKey = `mediafail:${username}:${m.id}`;
    const fails = Number((await env.TG_SESSION.get(failKey)) || 0);
    const tooBig = info.size && info.size > maxBytes;

    if (tooBig || fails >= 3) {
      // Post goes text-only: too large to decrypt in a run, or it keeps failing.
    } else {
      // Record the attempt BEFORE making it. A file big enough to exhaust the
      // run's CPU kills the isolate outright (Error 1102) — no catch runs, no
      // finally, nothing. Counting afterwards would therefore never see those
      // failures, so the same file would be retried every run forever and, now
      // that the marker only advances contiguously, wedge the channel for good.
      await env.TG_SESSION.put(failKey, String(fails + 1), { expirationTtl: 86400 });
      try {
        const bytes = await downloadMedia(mtproto, info, maxBytes);
        if (bytes.length) {
          const key = `tg/${username}/${m.id}.${info.ext}`;
          await env.MY_BUCKET.put(key, bytes, { httpMetadata: { contentType: info.mime } });
          mediaUrl = '/api/media/' + key;
          mediaType = info.kind;
          budget.left--;
        }
        await env.TG_SESSION.delete(failKey);   // it worked — forget the tries
      } catch (e) {
        const msg = e.error_message || e.message || '';
        // FLOOD_WAIT means Telegram is rate-limiting us, and NETWORK/timeout
        // errors are equally not the file's fault. Give the count back so a
        // perfectly good file isn't given up on after three unlucky runs.
        if (/FLOOD_WAIT|TIMEOUT|NETWORK/i.test(msg)) {
          await env.TG_SESSION.put(failKey, String(fails), { expirationTtl: 86400 });
        }
        return { ok: false, error: `media @${username}/${m.id} (try ${fails + 1}/3): ${msg}` };
      }
    }
  }

  const body = {
    secret: env.TELEGRAM_INGEST_SECRET,
    username,
    tg_msg_id: m.id,
    text: m.message || '',
    media_url: mediaUrl,
    media_type: mediaType,
    author_name: chat.title || username,
    author_handle: username,
    views: m.views || 0,
    forwards: m.forwards || 0,
    link: `https://t.me/${username}/${m.id}`,
    posted_at: m.date ? new Date(m.date * 1000).toISOString() : '',
  };
  try {
    const res = await fetch(env.INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.accepted) return { ok: true };
    // The ingest endpoint always answers ok:true and puts the real status in the
    // body, so surface that instead of reporting a silent zero.
    return { ok: false, error: data.error || `ingest said no (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── media ──
// Telegram hands back a file location, not a URL; the bytes come down in chunks
// via upload.getFile and are decrypted client-side. We write them into the
// site's R2 bucket so /api/media serves them like any other upload.

function extFor(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
    'audio/x-m4a': 'm4a', 'audio/flac': 'flac',
  };
  return map[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
}

// Photos arrive as a set of sizes. Take the biggest one that still fits a
// request's CPU rather than the largest outright: Telegram's top size can be
// 2560px and megabytes, which is both wasted on a chat bubble and more AES than
// a free-plan request can do. The stripped placeholder is skipped — it isn't a
// decodable image on its own.
const PHOTO_BUDGET = 600 * 1024;
function biggestPhotoSize(photo) {
  const sizes = (photo.sizes || []).filter((s) => s._ === 'photoSize' || s._ === 'photoSizeProgressive');
  if (!sizes.length) return null;
  const bytesOf = (s) => Number(s.size || (s.sizes ? s.sizes[s.sizes.length - 1] : 0)) || 0;
  const sorted = sizes.slice().sort((a, b) => bytesOf(a) - bytesOf(b));
  const fits = sorted.filter((s) => bytesOf(s) && bytesOf(s) <= PHOTO_BUDGET);
  // Largest that fits the budget; if every size is oversized (or none report a
  // size), fall back to the smallest so something renders.
  return fits.length ? fits[fits.length - 1] : sorted[0];
}

function mediaInfo(m) {
  const media = m.media;
  if (!media) return null;

  if (media._ === 'messageMediaPhoto' && media.photo) {
    const size = biggestPhotoSize(media.photo);
    if (!size) return null;
    return {
      kind: 'photo', ext: 'jpg', mime: 'image/jpeg',
      size: size.size || (size.sizes ? size.sizes[size.sizes.length - 1] : 0),
      location: {
        _: 'inputPhotoFileLocation',
        id: media.photo.id,
        access_hash: media.photo.access_hash,
        file_reference: media.photo.file_reference,
        thumb_size: size.type,
      },
    };
  }

  // Video, music, voice notes and plain files are all "documents".
  if (media._ === 'messageMediaDocument' && media.document) {
    const d = media.document;
    const mime = d.mime_type || 'application/octet-stream';
    const kind = mime.startsWith('video') ? 'video'
      : mime.startsWith('image') ? 'photo'
      : mime.startsWith('audio') ? 'audio'
      : 'file';
    return {
      kind, mime, ext: extFor(mime), size: d.size,
      location: {
        _: 'inputDocumentFileLocation',
        id: d.id,
        access_hash: d.access_hash,
        file_reference: d.file_reference,
        thumb_size: '',
      },
    };
  }
  return null;
}

// Files often live on a different data centre than the chat; the first chunk
// tells us which, and the rest follow it.
async function getChunk(mtproto, location, offset, limit, dcId) {
  const params = { location, offset, limit, precise: false, cdn_supported: false };
  try {
    return { res: await mtproto.call('upload.getFile', params, dcId ? { dcId } : {}), dcId };
  } catch (e) {
    const msg = e.error_message || '';
    if (e.error_code === 303 && msg.startsWith('FILE_MIGRATE_')) {
      const newDc = Number(msg.split('_MIGRATE_')[1]);
      return { res: await mtproto.call('upload.getFile', params, { dcId: newDc }), dcId: newDc };
    }
    throw e;
  }
}

async function downloadMedia(mtproto, info, maxBytes) {
  // Same arithmetic as SLICE: a 512KB read costs ~38ms of pure-JS AES, more than
  // a free-plan request gets — and this is the path an <img> takes, which is why
  // pictures failed while a 4KB probe of the same file sailed through.
  const CHUNK = SLICE;
  const parts = [];
  let offset = 0, total = 0, dcId = null;

  while (total < maxBytes) {
    const got = await getChunk(mtproto, info.location, offset, CHUNK, dcId);
    dcId = got.dcId;
    const bytes = got.res && got.res.bytes;
    if (!bytes || !bytes.length) break;
    parts.push(bytes);
    total += bytes.length;
    offset += bytes.length;
    if (bytes.length < CHUNK) break; // last chunk
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── streaming proxy ──
// Serves a channel file straight from Telegram to the browser, storing nothing.
//
// The trick that makes this work on the free plan: a <video> or <audio> element
// fetches a file in Range requests, and every Range is a SEPARATE Worker
// invocation with its own CPU budget. Decrypting a whole 60MB file in one run
// is impossible (~4.6s of pure-JS AES); decrypting one small slice per request
// is a few ms. The per-run CPU ceiling stops being a wall.
//
// Slice size is chosen against measured throughput: aes-js does ~13MB/s, so
// 512KB costs ~38ms of CPU — over what a free-plan request gets, which killed
// the response even though the file itself reads fine. 128KB is ~10ms and
// leaves headroom. Smaller slices just mean more requests, and requests are
// the thing we have plenty of.
const SLICE = 131072;         // 128KB per request — must be a multiple of 4096
const ALIGN = 4096;           // Telegram requires offset/limit aligned to this

// A file location holds raw bytes (file_reference) and possibly BigInt ids, and
// plain JSON mangles both: a Uint8Array comes back as {"0":1,"1":2,...} and a
// BigInt throws outright. Either way Telegram then rejects the location, which
// is why nothing loaded. Tag both on the way out and rebuild them on the way in.
function locStringify(obj) {
  return JSON.stringify(obj, (k, v) => {
    if (typeof v === 'bigint') return { __big: v.toString() };
    if (v instanceof Uint8Array) return { __bytes: Array.from(v) };
    return v;
  });
}
function locParse(s) {
  return JSON.parse(s, (k, v) => {
    if (v && typeof v === 'object' && v.__big !== undefined) return BigInt(v.__big);
    if (v && typeof v === 'object' && Array.isArray(v.__bytes)) return new Uint8Array(v.__bytes);
    return v;
  });
}

// Resolving a message costs two round-trips, so cache the file's location.
// file_reference goes stale after a while, hence the short TTL and the retry.
async function fileLocation(env, mtproto, username, msgId, force) {
  const key = `loc:${username}:${msgId}`;
  if (!force) {
    const hit = await env.TG_SESSION.get(key);
    if (hit) { try { return locParse(hit); } catch (e) { /* refetch */ } }
  }

  const resolved = await call(mtproto, 'contacts.resolveUsername', { username });
  const chat = (resolved.chats || [])[0];
  if (!chat) throw new Error('channel not found');

  const res = await call(mtproto, 'channels.getMessages', {
    channel: { _: 'inputChannel', channel_id: chat.id, access_hash: chat.access_hash },
    id: [{ _: 'inputMessageID', id: msgId }],
  });
  const msg = (res.messages || [])[0];
  if (!msg) throw new Error('post not found');

  const info = mediaInfo(msg);
  if (!info) throw new Error('post has no media');

  const out = { location: info.location, size: Number(info.size) || 0, mime: info.mime, kind: info.kind };
  try { await env.TG_SESSION.put(key, locStringify(out), { expirationTtl: 1800 }); } catch (e) { /* serving matters more than caching */ }
  return out;
}

async function streamMedia(env, request) {
  const url = new URL(request.url);
  const username = (url.searchParams.get('ch') || '').replace(/[^a-zA-Z0-9_]/g, '');
  const msgId = parseInt(url.searchParams.get('id'));
  if (!username || !msgId) return new Response('ch and id required', { status: 400 });

  const mtproto = makeClient(env);
  let info;
  try {
    info = await fileLocation(env, mtproto, username, msgId, false);
  } catch (e) {
    return new Response('Not available: ' + (e.error_message || e.message), { status: 404 });
  }

  const total = info.size || 0;
  const range = request.headers.get('Range') || '';

  // No Range header means a plain GET — an <img> does this, and it can't use a
  // partial body: answering 206 with a 512KB slice was why every picture came
  // out broken. Serve the whole thing when it's small enough to decrypt in one
  // run. Note this must NOT depend on knowing the size: photos often report
  // none, and requiring it sent them down the empty-response path instead.
  if (!range) {
    // Sized against the same measurement as SLICE: ~13MB/s means 1MB is ~76ms
    // of AES, which is about as much as one free-plan request will take. Photos
    // are picked below this budget on purpose (see biggestPhotoSize).
    const WHOLE_CAP = 1024 * 1024;
    if (!total || total <= WHOLE_CAP) {
      try {
        const bytes = await downloadMedia(mtproto, info, WHOLE_CAP);
        if (bytes.length) {
          return new Response(bytes, {
            headers: {
              'Content-Type': info.mime || 'application/octet-stream',
              'Content-Length': String(bytes.length),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      } catch (e) {
        return new Response('Stream error: ' + (e.error_message || e.message), { status: 502 });
      }
    }
    // Too big for one run: advertise ranges and let the player ask properly.
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': info.mime || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Work out which slice the player asked for.
  const m = range.match(/bytes=(\d+)-(\d*)/);
  let start = m ? parseInt(m[1]) : 0;
  if (total && start >= total) {
    return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  }

  // Telegram only reads on aligned boundaries, so fetch from the aligned offset
  // and trim the head off afterwards.
  const alignedStart = Math.floor(start / ALIGN) * ALIGN;
  const skip = start - alignedStart;
  let limit = SLICE;
  if (total) limit = Math.min(limit, Math.ceil((total - alignedStart) / ALIGN) * ALIGN);

  let bytes;
  try {
    const got = await getChunk(mtproto, info.location, alignedStart, limit, null);
    bytes = got.res && got.res.bytes;
  } catch (e) {
    // A stale file_reference is the usual cause — rebuild it once and retry.
    if (/FILE_REFERENCE/i.test(e.error_message || '')) {
      info = await fileLocation(env, mtproto, username, msgId, true);
      const got = await getChunk(mtproto, info.location, alignedStart, limit, null);
      bytes = got.res && got.res.bytes;
    } else {
      return new Response('Stream error: ' + (e.error_message || e.message), { status: 502 });
    }
  }
  if (!bytes || !bytes.length) return new Response('', { status: 416 });

  const body = bytes.subarray(skip);
  const end = start + body.length - 1;
  const size = total || (end + 1);

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': info.mime || 'application/octet-stream',
      'Content-Length': String(body.length),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      // Nothing is stored our side, but letting the browser keep what it has
      // already pulled saves re-decrypting the same slice on a replay.
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  // Cron: the unattended path.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncAll(env).catch((e) => console.error('sync failed:', e.message)));
  },

  // HTTP: login + manual test. Every route needs ?secret=<WORKER_ADMIN_SECRET>.
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' ) return json({ ok: true, worker: 'yidplus-telegram-worker', routes: ['/health', '/status', '/login?phone=', '/code?code=', '/password?password=', '/sync', '/reset', '/media?ch=&id='] });

    // Public on purpose: a <video> tag can't attach a secret, and the data is a
    // public channel's anyway. Handled before the gate below.
    if (path === '/media') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        } });
      }
      return streamMedia(env, request);
    }

    // Unguarded on purpose: reports only whether each secret EXISTS, never its
    // value, so a wrong ?secret= can be told apart from a missing binding.
    if (path === '/health') {
      const admin = env.WORKER_ADMIN_SECRET || '';
      return json({
        ok: true,
        secrets: {
          TELEGRAM_API_ID: !!env.TELEGRAM_API_ID,
          TELEGRAM_API_HASH: !!env.TELEGRAM_API_HASH,
          TELEGRAM_INGEST_SECRET: !!env.TELEGRAM_INGEST_SECRET,
          WORKER_ADMIN_SECRET: !!admin,
        },
        // Compare these against what you typed — a mismatch usually means a
        // stray space, a different case, or a character the URL ate.
        admin_secret_length: admin.length,
        admin_secret_first_char: admin ? admin[0] : null,
        admin_secret_last_char: admin ? admin[admin.length - 1] : null,
        kv_bound: !!env.TG_SESSION,
        got_secret_param: url.searchParams.has('secret'),
        got_secret_length: (url.searchParams.get('secret') || '').length,
        matches: url.searchParams.get('secret') === admin,
      });
    }

    if (url.searchParams.get('secret') !== env.WORKER_ADMIN_SECRET) {
      return json({ ok: false, error: 'Bad or missing ?secret=' }, 403);
    }

    try {
      if (path === '/status') {
        const mtproto = makeClient(env);
        try {
          const me = await call(mtproto, 'users.getFullUser', { id: { _: 'inputUserSelf' } });
          const u = me.users ? me.users[0] : null;
          return json({ ok: true, logged_in: true, as: u ? (u.username || u.phone || u.id) : 'unknown' });
        } catch (e) {
          return json({ ok: true, logged_in: false, why: e.error_message || e.message });
        }
      }

      // Step 1 — ask Telegram to text you a code.
      if (path === '/login') {
        const phone = url.searchParams.get('phone');
        if (!phone) return json({ ok: false, error: 'Add ?phone=+1XXXXXXXXXX' }, 400);
        const mtproto = makeClient(env);
        const sent = await call(mtproto, 'auth.sendCode', {
          phone_number: phone,
          settings: { _: 'codeSettings' },
        });
        await env.TG_SESSION.put('login:phone', phone);
        await env.TG_SESSION.put('login:hash', sent.phone_code_hash);
        return json({ ok: true, sent: true, next: 'Telegram just sent you a code. Call /code?code=12345&secret=...' });
      }

      // Step 2 — hand back the code.
      if (path === '/code') {
        const code = url.searchParams.get('code');
        if (!code) return json({ ok: false, error: 'Add ?code=12345' }, 400);
        const phone = await env.TG_SESSION.get('login:phone');
        const hash = await env.TG_SESSION.get('login:hash');
        if (!phone || !hash) return json({ ok: false, error: 'Call /login?phone=... first' }, 400);

        const mtproto = makeClient(env);
        try {
          const auth = await call(mtproto, 'auth.signIn', {
            phone_number: phone, phone_code_hash: hash, phone_code: code,
          });
          return json({ ok: true, logged_in: true, user: auth.user ? (auth.user.username || auth.user.id) : 'ok' });
        } catch (e) {
          if ((e.error_message || '') === 'SESSION_PASSWORD_NEEDED') {
            return json({ ok: true, logged_in: false, needs_password: true, next: 'Two-step is on. Call /password?password=YOURPASSWORD&secret=...' });
          }
          throw e;
        }
      }

      // Step 2b — only if you have two-step verification enabled.
      if (path === '/password') {
        const password = url.searchParams.get('password');
        if (!password) return json({ ok: false, error: 'Add ?password=...' }, 400);
        const mtproto = makeClient(env);
        const { srp_id, current_algo, srp_B } = await call(mtproto, 'account.getPassword');
        const { g, p, salt1, salt2 } = current_algo;
        const { A, M1 } = await mtproto.crypto.getSRPParams({ g, p, salt1, salt2, gB: srp_B, password });
        const auth = await call(mtproto, 'auth.checkPassword', {
          password: { _: 'inputCheckPasswordSRP', srp_id, A, M1 },
        });
        return json({ ok: true, logged_in: true, user: auth.user ? (auth.user.username || auth.user.id) : 'ok' });
      }

      // Clear the "already sent" marks so the next sync re-fetches recent posts.
      // Needed because posts synced before media support exist as empty shells:
      // the ingest upserts, so re-sending fills them in rather than duplicating.
      if (path === '/reset') {
        const only = (url.searchParams.get('username') || '').replace(/[^a-zA-Z0-9_]/g, '');
        const listRes = await fetch(env.CHANNELS_URL);
        const listJson = await listRes.json().catch(() => ({}));
        const channels = (listJson && listJson.channels) || [];
        const cleared = [];
        for (const ch of channels) {
          const u = String(ch.username || '').replace(/[^a-zA-Z0-9_]/g, '');
          if (!u || (only && u !== only)) continue;
          await env.TG_SESSION.delete('last:' + u);
          cleared.push(u);
        }
        return json({ ok: true, cleared, next: 'Now call /sync — it will re-pull recent posts, media included.' });
      }

      // Diagnostic: what does Telegram actually hand us for this post? Reports
      // the size/mime/kind and whether the location survived caching — enough to
      // tell a bad size apart from a bad file_reference without guessing.
      if (path === '/probe') {
        const ch = (url.searchParams.get('ch') || '').replace(/[^a-zA-Z0-9_]/g, '');
        const id = parseInt(url.searchParams.get('id'));
        if (!ch || !id) return json({ ok: true, error: 'need ?ch= and ?id=' });
        const mtproto = makeClient(env);

        const fresh = await fileLocation(env, mtproto, ch, id, true).catch((e) => ({ error: e.error_message || e.message }));
        if (fresh.error) return json({ ok: true, stage: 'resolve', error: fresh.error });

        const cached = await fileLocation(env, mtproto, ch, id, false).catch((e) => ({ error: e.error_message || e.message }));

        const describe = (i) => ({
          size: i.size,
          size_type: typeof i.size,
          mime: i.mime,
          kind: i.kind,
          loc_type: i.location && i.location._,
          ref_is_bytes: !!(i.location && i.location.file_reference instanceof Uint8Array),
          ref_len: i.location && i.location.file_reference ? i.location.file_reference.length : null,
          id_type: i.location ? typeof i.location.id : null,
        });

        // And can we actually read the first slice?
        let firstChunk = null;
        try {
          const got = await getChunk(mtproto, fresh.location, 0, 4096, null);
          firstChunk = { bytes: got.res && got.res.bytes ? got.res.bytes.length : 0, dc: got.dcId };
        } catch (e) {
          firstChunk = { error: e.error_message || e.message };
        }

        // The path an <img> takes: read the whole file in one request. This is
        // where pictures were failing while the 4KB probe above succeeded, so
        // time it and report — a slow success still means a CPU problem.
        let whole = null;
        try {
          const t0 = Date.now();
          const bytes = await downloadMedia(mtproto, fresh, 1024 * 1024);
          whole = { bytes: bytes.length, ms: Date.now() - t0 };
        } catch (e) {
          whole = { error: e.error_message || e.message };
        }

        return json({ ok: true, fresh: describe(fresh), from_cache: cached.error ? { error: cached.error } : describe(cached), first_chunk: firstChunk, whole_file: whole, slice_size: SLICE });
      }

      // Run a sync right now instead of waiting for the cron — this is the one
      // to hit when testing.
      if (path === '/sync') {
        const report = await syncAll(env);
        return json({ ok: true, ...report });
      }

      return json({ ok: false, error: 'Unknown route' }, 404);
    } catch (err) {
      return json({ ok: false, error: err.error_message || err.message, code: err.error_code }, 500);
    }
  },
};

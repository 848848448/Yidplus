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

// Telegram answers some calls with "you're on the wrong data centre" — follow it.
async function call(mtproto, method, params, options = {}) {
  try {
    return await mtproto.call(method, params, options);
  } catch (error) {
    const code = error.error_code;
    const message = error.error_message || '';

    if (code === 303) {
      const dcId = Number(message.split('_MIGRATE_')[1]);
      if (message.startsWith('PHONE_MIGRATE_') || message.startsWith('NETWORK_MIGRATE_')) {
        await mtproto.setDefaultDc(dcId);
      } else {
        options = { ...options, dcId };
      }
      return call(mtproto, method, params, options);
    }
    throw error;
  }
}

// ── the actual sync ──
async function syncAll(env) {
  const report = { channels: 0, sent: 0, skipped: 0, errors: [] };

  const listRes = await fetch(env.CHANNELS_URL);
  const listJson = await listRes.json().catch(() => ({}));
  const channels = (listJson && listJson.channels) || [];
  if (!channels.length) return { ...report, note: 'No Telegram channels added in the admin panel yet.' };

  const mtproto = makeClient(env);
  const limit = Number(env.FETCH_LIMIT || 20);

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
      for (const m of messages) {
        const ok = await pushPost(env, username, chat, m);
        if (ok) { report.sent++; highest = Math.max(highest, m.id); }
      }
      if (highest > lastSeen) await env.TG_SESSION.put(lastKey, String(highest));
    } catch (err) {
      report.errors.push(`@${username}: ${err.error_message || err.message}`);
    }
  }

  return report;
}

async function pushPost(env, username, chat, m) {
  // v1 forwards the text plus a link to the original. Media needs chunked
  // upload.getFile calls, which is a separate step.
  const body = {
    secret: env.TELEGRAM_INGEST_SECRET,
    username,
    tg_msg_id: m.id,
    text: m.message || '',
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
    return !!data.accepted;
  } catch (e) {
    return false;
  }
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

    if (path === '/' ) return json({ ok: true, worker: 'yidplus-telegram-worker', routes: ['/health', '/status', '/login?phone=', '/code?code=', '/password?password=', '/sync'] });

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

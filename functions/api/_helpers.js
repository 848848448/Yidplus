// functions/api/_helpers.js
// Shared helpers for Cloudflare Pages Functions.
// Import with: import { requireUser, json, corsHeaders, getCookie } from '../_helpers.js';

import { sendWebPush } from './_webpush.js';

export const corsHeaders = {
  'Content-Type': 'application/json',
  // The frontend and API live on the same origin (Cloudflare Pages serves
  // both), so no cross-origin site ever needs credentialed access to this
  // API. Wildcard origin is fine for public GETs; deliberately NO
  // Access-Control-Allow-Credentials header — the browser will therefore
  // never attach or expose session cookies on any cross-origin request,
  // which shuts the door on cross-site request abuse of the API.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Simple IP-based rate limiter. Records each hit and returns false when the
// caller has exceeded `max` hits for `bucket` in the last `windowMinutes`.
// Fails open (returns true) on any DB error so a storage hiccup never locks
// legitimate users out. Uses a self-creating table so no manual migration.
export async function checkRateLimit(env, request, bucket, max, windowMinutes) {
  try {
    const ip = (request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown')
      .split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'unknown';

    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, ip TEXT NOT NULL, created_at TEXT NOT NULL)`
    ).run().catch(() => {});

    const row = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM rate_limits WHERE bucket = ? AND ip = ? AND created_at > datetime('now', ?)`
    ).bind(bucket, ip, `-${windowMinutes} minutes`).first().catch(() => ({ cnt: 0 }));

    if ((row?.cnt || 0) >= max) return false;

    await env.DB.prepare(
      `INSERT INTO rate_limits (id, bucket, ip, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), bucket, ip).run().catch(() => {});

    return true;
  } catch (e) {
    return true; // fail open
  }
}

// Generates a 256-bit (32-byte) cryptographically-random session token,
// hex-encoded. crypto.randomUUID() is already CSPRNG-backed, but a single
// UUID is only 122 bits and has a fixed version/variant layout; this gives
// a longer, fully-random opaque token with no guessable structure.
export function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function isValidEmail(email) {
  // Deliberately strict: only the characters a real email address can
  // contain. The previous check in register.js (`[^@\s]+@[^@\s]+\.[^@\s]+`)
  // accepted almost anything as long as it had the word@word.word shape —
  // including <, >, ", ', ; and other HTML/script-injection characters,
  // which is exactly the kind of "put a code in instead of an email" input
  // that should never reach the database or get echoed back into any page.
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) && email.length <= 254;
}

export function json(obj, status = 200, cacheSeconds = 0) {
  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(obj), { status, headers });
}

// ── PASSWORD HASHING ────────────────────────────────────────
// New accounts / password changes use salted PBKDF2 (100k iterations,
// SHA-256), which is far more resistant to offline cracking than a bare
// SHA-256 hash. Format: "pbkdf2$<iterations>$<saltHex>$<hashHex>".
//
// Old accounts created before this change have a bare 64-char hex SHA-256
// hash with no salt. verifyPassword() understands both formats so existing
// users keep working, and silently upgrades their hash to PBKDF2 the next
// time they log in successfully (see login.js).
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

async function _legacySha256(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _pbkdf2Verify(password, iterations, saltHex, expectedHashHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHashHex;
}

// Returns { valid, needsUpgrade } — needsUpgrade is true when the password
// matched a legacy plain-SHA256 hash, signalling the caller (login.js)
// should re-save the password through hashPassword() to upgrade it.
export async function verifyPassword(password, storedHash) {
  if (!storedHash) return { valid: false, needsUpgrade: false };
  if (storedHash.startsWith('pbkdf2$')) {
    const [, iterStr, saltHex, hashHex] = storedHash.split('$');
    const valid = await _pbkdf2Verify(password, parseInt(iterStr, 10), saltHex, hashHex);
    return { valid, needsUpgrade: false };
  }
  // Legacy bare-SHA256 hash
  const legacy = await _legacySha256(password);
  const valid = legacy === storedHash;
  return { valid, needsUpgrade: valid };
}

export async function cleanupUserReferences(env, userId, nickname) {
  // Discover every table with a column that plausibly references a user id,
  // and delete matching rows from ALL of them before removing the user row
  // itself. This is more robust than a hand-maintained table list, which
  // caused real "FOREIGN KEY constraint failed" errors when a table was
  // missed.
  const USER_ID_COLUMNS = [
    'user_id', 'sender_id', 'owner_id', 'follower_id', 'following_id',
    'target_user_id', 'target_id', 'requester_id', 'author_id', 'uploader_id',
    'channel_owner_id', 'created_by', 'liked_by', 'reported_by',
    'blocked_by', 'muted_by', 'granted_by', 'recipient_id', 'reviewer_id',
  ];

  try {
    const { results: tables } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'users' AND name NOT LIKE 'sqlite_%'`
    ).all();

    for (const t of tables) {
      let columns;
      try {
        const { results } = await env.DB.prepare(`PRAGMA table_info(${t.name})`).all();
        columns = results.map(c => c.name);
      } catch (e) { continue; }

      for (const col of columns) {
        if (!USER_ID_COLUMNS.includes(col)) continue;
        await env.DB.prepare(`DELETE FROM "${t.name}" WHERE "${col}" = ?`).bind(userId).run().catch(() => {});
      }
    }
  } catch (e) { /* best-effort — fall through to the final delete attempt regardless */ }

  // Nickname-keyed reference (device_bans.banned_by stores a nickname, not an id)
  if (nickname) {
    await env.DB.prepare('DELETE FROM device_bans WHERE banned_by = ?').bind(nickname).run().catch(() => {});
  }
}

export function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

// Returns the logged-in user row (id, email, nickname, role, blocked) or null.
export async function requireUser(request, env) {
  const token = getCookie(request, 'yp_session');
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT user_id, impersonator_id FROM sessions WHERE id = ?`
  ).bind(token).first().catch(() =>
    env.DB.prepare(`SELECT user_id FROM sessions WHERE id = ?`).bind(token).first()
  );

  if (!session) return null;

  const user = await env.DB.prepare(
    `SELECT id, email, nickname, role, blocked, verified, photo_url, bio, no_ads, email_verified, created_at FROM users WHERE id = ?`
  ).bind(session.user_id).first();

  if (!user || user.blocked) return null;
  // When set, this session is an owner "viewing as" this user — read-only.
  if (session.impersonator_id) user._impersonatorId = session.impersonator_id;
  return user;
}

// ── ROLE SEMANTICS ──────────────────────────────────────────
// member        : regular user
// admin_limited : "Moderator" — can view, delete content, block users.
// admin_super   : "Super Admin" — full access.
// owner (by email): ultimate admin, cannot be demoted/blocked.
// CO_OWNER      : jmittelman2@gmail.com — same rights as owner, hardcoded.

const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];

export function isAdminRole(user, ownerEmail) {
  if (!user) return false;
  var email = (user.email || '').toLowerCase();
  // Both owners always have admin access
  if (OWNER_EMAILS.includes(email)) return true;
  if (ownerEmail && email === ownerEmail.toLowerCase()) return true;
  return user.role === 'admin_super' || user.role === 'admin_limited';
}

export function isSuperOrOwner(user, ownerEmail) {
  if (!user) return false;
  var email = (user.email || '').toLowerCase();
  if (OWNER_EMAILS.includes(email)) return true;
  if (ownerEmail && email === ownerEmail.toLowerCase()) return true;
  return user.role === 'admin_super';
}

export function isOwnerOrCoOwner(user, ownerEmail) {
  if (!user) return false;
  var email = (user.email || '').toLowerCase();
  if (OWNER_EMAILS.includes(email)) return true;
  if (ownerEmail && email === ownerEmail.toLowerCase()) return true;
  return false;
}

// Moderator-or-above: anyone who can view/delete/block (Moderator + Super Admin + Owner)
export function isModeratorOrAbove(user, ownerEmail) {
  return isAdminRole(user, ownerEmail);
}

// Content deletion rule: owner of the content, OR any moderator/admin.
export function canDeleteContent(user, contentOwnerId, ownerEmail) {
  if (!user) return false;
  if (user.id === contentOwnerId) return true;
  return isAdminRole(user, ownerEmail);
}

// Write an audit log entry. Call this whenever a Moderator or Super Admin
// deletes content, blocks a user, or takes another moderation action.
// Never throws — logging failures should not break the underlying action.
export async function logAudit(env, actor, action, targetType, targetId, details) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_nick, actor_role, action, target_type, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      actor.id,
      actor.nickname || '',
      actor.email === env.OWNER_EMAIL || OWNER_EMAILS.includes(actor.email) ? 'owner' : (actor.role || 'member'),
      action,
      targetType || null,
      targetId || null,
      details || '',
      new Date().toISOString()
    ).run();
  } catch (e) {
    // Swallow — audit logging must never block the real action.
    console.error('[audit] failed to write log:', e.message);
  }
    }

/* ══════════════════════════════════════════════════════════════════════
   SECURITY: attacker intelligence + ban enforcement
   ─────────────────────────────────────────────────────────────────────
   One place that (a) reads the true client IP, (b) captures everything an
   attacker's own request reveals to our server, (c) writes it to the
   attack_logs table the Attacks panel reads, and (d) answers "is this
   source banned?". Everything here is best-effort and wrapped so a logging
   or lookup failure can never break the request it's attached to.
   ═════════════════════════════════════════════════════════════════════ */

// True client IP, as Cloudflare sees it (not spoofable via headers on CF).
export function clientIp(request) {
  return (request.headers.get('CF-Connecting-IP') ||
          request.headers.get('X-Forwarded-For') ||
          'unknown').split(',')[0].trim().slice(0, 64);
}

// Everything the attacker's request tells us about who and where they are.
// Cloudflare hands us geo + network for free on request.cf; the rest are
// standard request headers the client sent. Returned as a flat object; the
// rich extras get JSON-stringified into attack_logs.meta.
export function gatherIntel(request) {
  const cf = request.cf || {};
  const h = (name) => request.headers.get(name) || '';
  const ip = clientIp(request);
  const asnNum = cf.asn ? ('AS' + cf.asn) : '';
  return {
    ip,
    country: (request.headers.get('CF-IPCountry') || cf.country || '').slice(0, 8),
    city:    (cf.city || '').slice(0, 80),
    region:  (cf.region || cf.regionCode || '').slice(0, 80),
    asn:     (cf.asOrganization || asnNum || '').slice(0, 120),
    user_agent: h('User-Agent').slice(0, 400),
    referer:    h('Referer').slice(0, 300),
    meta: {
      asnNum,
      continent:   cf.continent || '',
      postalCode:  cf.postalCode || '',
      timezone:    cf.timezone || '',
      latitude:    cf.latitude || '',
      longitude:   cf.longitude || '',
      colo:        cf.colo || '',                 // CF datacenter that served it
      tlsVersion:  cf.tlsVersion || '',
      tlsCipher:   cf.tlsCipher || '',
      httpProtocol: cf.httpProtocol || '',
      // Cloudflare bot/threat signals — present only on some plans; captured
      // defensively so they show when available and are simply absent otherwise.
      botScore:    (cf.botManagement && typeof cf.botManagement.score !== 'undefined') ? cf.botManagement.score : '',
      verifiedBot: (cf.botManagement && cf.botManagement.verifiedBot) ? 1 : 0,
      threatScore: (typeof cf.threatScore !== 'undefined') ? cf.threatScore : '',
      // What the browser volunteers about itself.
      acceptLanguage: h('Accept-Language').slice(0, 120),
      platform:  (h('Sec-CH-UA-Platform') || '').replace(/"/g, '').slice(0, 40),
      mobile:    h('Sec-CH-UA-Mobile') === '?1' ? 1 : 0,
      origin:    h('Origin').slice(0, 200),
      xff:       h('X-Forwarded-For').slice(0, 200),
    },
  };
}

// Ensure the attack_logs table exists AND has the meta column (older
// deployments created it without meta — ALTER is idempotent-by-catch).
async function _ensureAttackTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS attack_logs (
       id TEXT PRIMARY KEY, ip TEXT, country TEXT, city TEXT, region TEXT,
       asn TEXT, method TEXT, path TEXT, attack_type TEXT, user_agent TEXT,
       referer TEXT, status INTEGER, created_at TEXT, meta TEXT
     )`
  ).run().catch(() => {});
  await env.DB.prepare('ALTER TABLE attack_logs ADD COLUMN meta TEXT').run().catch(() => {});
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_attack_ip ON attack_logs(ip)').run().catch(() => {});
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_attack_created ON attack_logs(created_at)').run().catch(() => {});
}

// Record a blocked/failed intrusion attempt with full intelligence. Runs in
// the background via waitUntil so it never slows the response. `opts` may set
// { path, method, status } overrides (e.g. a login/PIN handler wants to label
// its own endpoint). Also auto-bans an IP that crosses the attack threshold.
export function logAttack(context, attackType, status, opts) {
  try {
    const { request, env } = context;
    if (!env || !env.DB) return;
    const info = gatherIntel(request);
    const url = new URL(request.url);
    const path = ((opts && opts.path) || (url.pathname + (url.search || ''))).slice(0, 500);
    const method = ((opts && opts.method) || request.method || '').slice(0, 10);
    const st = (opts && opts.status) || status || 0;

    const work = (async () => {
      await _ensureAttackTable(env);

      // Who made this request? If they were signed in, resolve the session to
      // their account so the owner can see exactly which user was behind it and
      // open their profile. Anonymous attackers simply have no account here.
      try {
        const who = await requireUser(request, env);
        if (who) {
          info.meta.account = {
            id: who.id,
            nickname: who.nickname || '',
            email: who.email || '',
            role: who.role || 'member',
          };
        }
      } catch (e) { /* attribution is a bonus, never required */ }

      // Is this a NEW attacking source, or one we've already seen today? Checked
      // before the insert so a fresh IP reads as 0 prior hits. Drives the owner
      // alert — we ping when someone new starts, not on every repeated knock.
      let priorHits = 1;
      if (info.ip && info.ip !== 'unknown') {
        const p = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM attack_logs
           WHERE ip = ? AND created_at > datetime('now', '-24 hours')`
        ).bind(info.ip).first().catch(() => ({ c: 1 }));
        priorHits = (p && typeof p.c === 'number') ? p.c : 1;
      }

      await env.DB.prepare(
        `INSERT INTO attack_logs
           (id, ip, country, city, region, asn, method, path, attack_type,
            user_agent, referer, status, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      ).bind(
        crypto.randomUUID(), info.ip, info.country, info.city, info.region,
        info.asn, method, path, attackType, info.user_agent, info.referer, st,
        JSON.stringify(info.meta)
      ).run().catch(() => {});

      // Alert the owner's phone when a NEW source starts attacking (the helper
      // throttles to at most one alert per 10 min and respects the on/off
      // toggle, so this can't become a flood).
      if (priorHits === 0) {
        await notifyOwnerAttack(env, attackType, info);
      }

      // ── Auto-ban repeat offenders ──
      // Someone who trips the defenses again and again isn't a one-off typo —
      // it's a determined probe. After enough hits in a short window, ban the
      // IP outright so every future request (not just this endpoint) is turned
      // away. Never auto-bans 'unknown'.
      if (info.ip && info.ip !== 'unknown') {
        const AUTO_BAN_THRESHOLD = 8;   // attacks within the window
        const WINDOW = '-1 hours';
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM attack_logs
           WHERE ip = ? AND created_at > datetime('now', ?)`
        ).bind(info.ip, WINDOW).first().catch(() => ({ c: 0 }));
        if ((row?.c || 0) >= AUTO_BAN_THRESHOLD) {
          const already = await env.DB.prepare(
            `SELECT id FROM device_bans WHERE ip = ? LIMIT 1`
          ).bind(info.ip).first().catch(() => null);
          if (!already) {
            await env.DB.prepare(
              `INSERT INTO device_bans (id, ip, fingerprint, reason, banned_by, created_at)
               VALUES (?, ?, NULL, ?, 'auto', ?)`
            ).bind(
              crypto.randomUUID(), info.ip,
              'Auto-banned: ' + (row.c) + ' attacks in 1h (' + attackType + ')',
              new Date().toISOString()
            ).run().catch(() => {});
          }
        }
      }

      // Occasionally prune anything older than 60 days (cheap, ~3% of writes).
      if (Math.random() < 0.03) {
        await env.DB.prepare(
          `DELETE FROM attack_logs WHERE created_at < datetime('now', '-60 days')`
        ).run().catch(() => {});
      }
    })();

    if (context.waitUntil) context.waitUntil(work);
  } catch (e) { /* logging must never break the request */ }
}

// Is this request coming from a banned source? Checks the exact IP, the whole
// country ('country:US'), and the whole network/ASN ('asn:AS12345') in ONE
// indexed query, so an owner can wall off a single address, an entire country
// they'll never have real users in, or a whole hosting network a bot farm
// lives on. Returns the matching ban row, or null.
export async function findBan(env, request) {
  try {
    const ip = clientIp(request);
    const cf = request.cf || {};
    const cc = (request.headers.get('CF-IPCountry') || cf.country || '').toUpperCase();
    const asn = cf.asn ? ('AS' + cf.asn) : '';
    const keys = [];
    if (ip && ip !== 'unknown') keys.push(ip);
    if (cc) keys.push('country:' + cc);
    if (asn) keys.push('asn:' + asn);
    if (!keys.length) return null;
    const placeholders = keys.map(() => '?').join(',');
    const row = await env.DB.prepare(
      `SELECT id, ip, reason FROM device_bans WHERE ip IN (${placeholders}) LIMIT 1`
    ).bind(...keys).first().catch(() => null);
    return row || null;
  } catch (e) {
    return null; // a ban-lookup failure must never wall off the whole site
  }
}

// Push a "someone is attacking the site" alert to the owner's phone (and the
// co-owner). Deliberately throttled and only ever fired for a NEW attacking
// source, so it's a heads-up when trouble starts — not a stream of pings for
// every background scanner. Controlled by the app setting 'sec_push_alerts'
// (a toggle in the Attacks panel); silently does nothing if turned off, if no
// owner device is subscribed to push, or if VAPID isn't configured. Entirely
// best-effort — it must never affect the request it's attached to.
export async function notifyOwnerAttack(env, attackType, info) {
  try {
    if (!env || !env.DB) return;

    // Respect the on/off toggle. Missing row => treat as ON (the owner asked
    // for this), so it works the moment they flip nothing.
    const setting = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'sec_push_alerts'"
    ).first().catch(() => null);
    if (setting && setting.value === 'false') return;

    // Throttle: at most one attack alert every 10 minutes, however many new
    // sources appear, so a burst can never turn into a flood of buzzes.
    const THROTTLE_MIN = 10;
    const last = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'sec_last_push_at'"
    ).first().catch(() => null);
    if (last && last.value) {
      const lastMs = Date.parse(last.value);
      if (!isNaN(lastMs) && (Date.now() - lastMs) < THROTTLE_MIN * 60 * 1000) return;
    }

    // Who to alert: owner + co-owner.
    const emails = [env.OWNER_EMAIL, 'jmittelman2@gmail.com'].filter(Boolean);
    const placeholders = emails.map(() => '?').join(',');
    const owners = await env.DB.prepare(
      `SELECT id FROM users WHERE lower(email) IN (${placeholders})`
    ).bind(...emails.map((e) => e.toLowerCase())).all().catch(() => ({ results: [] }));
    const ownerIds = (owners.results || []).map((r) => r.id);
    if (!ownerIds.length) return;

    const idPlaceholders = ownerIds.map(() => '?').join(',');
    const subs = await env.DB.prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${idPlaceholders})`
    ).bind(...ownerIds).all().catch(() => ({ results: [] }));
    if (!subs.results || !subs.results.length) return;

    // Mark the throttle now (before sending) so two near-simultaneous attacks
    // don't both fire. Upsert into app_settings.
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('sec_last_push_at', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(nowIso).run().catch(async () => {
      // Fallback for schemas without a unique constraint on key.
      await env.DB.prepare("UPDATE app_settings SET value = ? WHERE key = 'sec_last_push_at'")
        .bind(nowIso).run().catch(() => {});
    });

    const flag = _ccToFlag(info.country);
    const where = [flag, info.ip].filter(Boolean).join(' ');
    const locBits = [info.city, info.country].filter(Boolean).join(', ');
    const payload = {
      title: '🛡️ YID PLUS — attack detected',
      body: (attackType || 'Blocked attempt') + (where ? ' from ' + where : '') + (locBits ? ' (' + locBits + ')' : ''),
      icon: '/images/logo.png',
      badge: '/images/logo.png',
      url: '/admin',
      tag: 'yp-security',        // same tag => a new alert replaces the old one
    };

    for (const s of subs.results) {
      try {
        await sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, env);
      } catch (e) { /* one dead device must not stop the others */ }
    }
  } catch (e) { /* alerting must never break anything */ }
}

// 2-letter country code -> flag emoji (server-side twin of the panel's helper).
function _ccToFlag(cc) {
  if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + cc.toUpperCase().charCodeAt(0) - 65) +
         String.fromCodePoint(A + cc.toUpperCase().charCodeAt(1) - 65);
}

// Private bot credentials: prefer Cloudflare env vars, fall back to values
// saved in app_settings (so they can be set from the admin panel without
// touching Cloudflare).
export async function getPrivateBotCreds(env) {
  let token = (env.PRIVATE_BOT_TOKEN || '').trim();
  let secret = (env.PRIVATE_BOT_WEBHOOK_SECRET || '').trim();
  if (!token || !secret) {
    try {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM app_settings WHERE key IN ('private_bot_token','private_bot_webhook_secret')"
      ).all();
      for (const r of (rows.results || [])) {
        if (r.key === 'private_bot_token' && !token) token = (r.value || '').trim();
        if (r.key === 'private_bot_webhook_secret' && !secret) secret = (r.value || '').trim();
      }
    } catch (e) { /* table may not exist yet */ }
  }
  return { token, secret };
}

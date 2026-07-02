// functions/api/_helpers.js
// Shared helpers for Cloudflare Pages Functions.
// Import with: import { requireUser, json, corsHeaders, getCookie } from '../_helpers.js';

export const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

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
    'target_user_id', 'requester_id', 'author_id', 'uploader_id',
    'channel_owner_id', 'created_by', 'liked_by', 'reported_by',
    'blocked_by', 'muted_by', 'granted_by',
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
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) return null;

  const user = await env.DB.prepare(
    `SELECT id, email, nickname, role, blocked, verified, photo_url, bio, no_ads, email_verified FROM users WHERE id = ?`
  ).bind(session.user_id).first();

  if (!user || user.blocked) return null;
  return user;
}

// ── ROLE SEMANTICS ──────────────────────────────────────────
// member        : regular user
// admin_limited : "Moderator" — can view, delete content, block users.
// admin_super   : "Super Admin" — full access.
// owner (by email): ultimate admin, cannot be demoted/blocked.
// CO_OWNER      : Jmittelman2@gmail.com — same rights as owner, hardcoded.

const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'Jmittelman2@gmail.com'];

export function isAdminRole(user, ownerEmail) {
  if (!user) return false;
  // Both owners always have admin access
  if (OWNER_EMAILS.includes(user.email)) return true;
  if (ownerEmail && user.email === ownerEmail) return true;
  return user.role === 'admin_super' || user.role === 'admin_limited';
}

export function isSuperOrOwner(user, ownerEmail) {
  if (!user) return false;
  if (OWNER_EMAILS.includes(user.email)) return true;
  if (ownerEmail && user.email === ownerEmail) return true;
  return user.role === 'admin_super';
}

export function isOwnerOrCoOwner(user, ownerEmail) {
  if (!user) return false;
  if (OWNER_EMAILS.includes(user.email)) return true;
  if (ownerEmail && user.email === ownerEmail) return true;
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

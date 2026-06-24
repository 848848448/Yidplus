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

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders });
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
    `SELECT id, email, nickname, role, blocked, verified, photo_url, bio FROM users WHERE id = ?`
  ).bind(session.user_id).first();

  if (!user || user.blocked) return null;
  return user;
}

// ── ROLE SEMANTICS ──────────────────────────────────────────
// member        : regular user
// admin_limited : "Moderator" — can view, delete content, block users.
//                 Actions are tracked in audit_logs.
// admin_super   : "Super Admin" — full access: settings, ads, role
//                 management, broadcasts. Includes everything a
//                 Moderator can do.
// owner (by email match) : ultimate Super Admin, cannot be demoted/blocked.

export function isAdminRole(user, ownerEmail) {
  if (!user) return false;
  return user.email === ownerEmail || user.role === 'admin_super' || user.role === 'admin_limited';
}

export function isSuperOrOwner(user, ownerEmail) {
  if (!user) return false;
  const CO_OWNER = 'Jmittelman2@gmail.com';
  return user.email === ownerEmail ||
         user.email === CO_OWNER ||
         user.role  === 'admin_super';
}

export function isOwnerOrCoOwner(user, ownerEmail) {
  if (!user) return false;
  const CO_OWNER = 'Jmittelman2@gmail.com';
  return user.email === ownerEmail || user.email === CO_OWNER;
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
      actor.email === env.OWNER_EMAIL ? 'owner' : (actor.role || 'member'),
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

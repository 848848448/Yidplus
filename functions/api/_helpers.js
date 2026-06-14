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
    `SELECT user_id, expires_at FROM sessions WHERE token = ?`
  ).bind(token).first();

  if (!session || new Date(session.expires_at) < new Date()) return null;

  const user = await env.DB.prepare(
    `SELECT id, email, nickname, role, blocked, verified FROM users WHERE id = ?`
  ).bind(session.user_id).first();

  if (!user || user.blocked) return null;
  return user;
}

export function isAdminRole(user, ownerEmail) {
  if (!user) return false;
  return user.email === ownerEmail || user.role === 'admin_super' || user.role === 'admin_limited';
}

export function isSuperOrOwner(user, ownerEmail) {
  if (!user) return false;
  return user.email === ownerEmail || user.role === 'admin_super';
                                        }

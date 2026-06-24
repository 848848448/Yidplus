// GET /api/auth/check-nick?nick=XXX -> check if nickname is available
import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const nick = new URL(request.url).searchParams.get('nick') || '';
    if (nick.length < 3) return json({ available: false, reason: 'too short' });
    if (!/^[a-zA-Z0-9_\u0590-\u05FF]+$/.test(nick)) return json({ available: false, reason: 'invalid characters' });
    const existing = await env.DB.prepare('SELECT id FROM users WHERE lower(nickname) = lower(?)').bind(nick).first();
    return json({ ok: true, available: !existing });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
    }

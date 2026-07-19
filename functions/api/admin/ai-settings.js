// functions/api/admin/ai-settings.js
// GET/POST the YID PLUS AI configuration. Owner / co-owner only.
// Settings live in app_settings so they apply to everyone, editable with no
// code deploy: ai_enabled, ai_name, ai_instructions, ai_welcome, ai_hourly_limit.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

const KEYS = ['ai_enabled', 'ai_name', 'ai_instructions', 'ai_welcome', 'ai_hourly_limit'];

async function readAll(env) {
  const ph = KEYS.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ph})`
  ).bind(...KEYS).all().catch(() => ({ results: [] }));
  const map = {};
  (results || []).forEach((r) => { map[r.key] = r.value; });
  return map;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const map = await readAll(env);
    const provider = env.ANTHROPIC_API_KEY ? 'claude' : (env.AI ? 'cloudflare' : 'none');

    return json({
      ok: true,
      provider,
      settings: {
        enabled: map.ai_enabled !== 'false',            // default ON
        name: map.ai_name || 'YID PLUS AI',
        instructions: map.ai_instructions || '',
        welcome: map.ai_welcome || '',
        hourly_limit: parseInt(map.ai_hourly_limit || '40', 10),
      },
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json().catch(() => ({}));

    const save = async (key, value) => {
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(key, value).run().catch(() => {});
    };

    if (typeof body.enabled === 'boolean') await save('ai_enabled', body.enabled ? 'true' : 'false');
    if (typeof body.name === 'string') await save('ai_name', body.name.trim().slice(0, 60) || 'YID PLUS AI');
    if (typeof body.instructions === 'string') await save('ai_instructions', body.instructions.slice(0, 6000));
    if (typeof body.welcome === 'string') await save('ai_welcome', body.welcome.slice(0, 1000));
    if (body.hourly_limit !== undefined) {
      let n = parseInt(body.hourly_limit, 10);
      if (isNaN(n) || n < 1) n = 40;
      if (n > 1000) n = 1000;
      await save('ai_hourly_limit', String(n));
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

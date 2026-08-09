// functions/api/admin/app-config.js
// Owner-only. Manage the app's configuration/keys from the admin panel instead
// of Cloudflare. Values are stored in app_settings under a 'cfg:' prefix; the
// code reads them via getConfig(env, KEY) (env var first, then here).
//   GET          -> for each known key: set via env? set via app? (never the value)
//   POST {key,value} -> save (validated for a few known keys)
//   DELETE ?key= -> clear an app-stored value

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

// The knobs the app actually reads. label + hint shown in the UI.
const KEYS = [
  { key: 'RESEND_API_KEY',          label: 'Email API key (Resend)',        secret: true },
  { key: 'RESEND_FROM_EMAIL',       label: 'Email "from" address',          secret: false, hint: 'e.g. YID PLUS <noreply@yidplus.com>' },
  { key: 'RESEND_REPLY_TO',         label: 'Email "reply-to" address',      secret: false, hint: 'Where replies to your emails should go (e.g. your Gmail, or reply@yidplus.com routed to your bot). Leave blank for no-reply.' },
  { key: 'TG_BOT_TOKEN',            label: 'Telegram bot token',            secret: true },
  { key: 'PRIVATE_BOT_TOKEN',       label: 'Private (email) bot token',     secret: true },
  { key: 'PRIVATE_BOT_WEBHOOK_SECRET', label: 'Private bot webhook secret', secret: true },
  { key: 'VIDEO_CONVERTER_URL',     label: 'Video converter URL',           secret: false, hint: 'https://…onrender.com' },
  { key: 'VIDEO_CONVERTER_SECRET',  label: 'Video converter secret',        secret: true },
  { key: 'GOOGLE_CLIENT_ID',        label: 'Google sign-in client ID',      secret: false },
  { key: 'GOOGLE_CLIENT_SECRET',    label: 'Google sign-in client secret',  secret: true },
  { key: 'SITE_URL',                label: 'Site URL',                      secret: false, hint: 'https://yidplus.com' },
];

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

async function saveSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, value).run();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    // Which app-stored keys exist?
    let stored = {};
    try {
      const rows = await env.DB.prepare("SELECT key FROM app_settings WHERE key LIKE 'cfg:%'").all();
      for (const r of (rows.results || [])) stored[r.key.slice(4)] = true;
    } catch (e) {}
    const items = KEYS.map((k) => ({
      key: k.key, label: k.label, secret: k.secret, hint: k.hint || '',
      set_env: !!(env[k.key] != null && String(env[k.key]).length),
      set_app: !!stored[k.key],
    }));
    return json({ ok: true, items });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const body = await request.json().catch(() => ({}));
    const key = String(body.key || '');
    const value = String(body.value || '').trim();
    if (!KEYS.some((k) => k.key === key)) return json({ ok: false, error: 'Unknown key' });
    if (!value) return json({ ok: false, error: 'Value is empty' });

    // Light validation for a couple of well-known keys.
    if ((key === 'TG_BOT_TOKEN' || key === 'PRIVATE_BOT_TOKEN') && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(value)) {
      return json({ ok: false, error: 'That does not look like a bot token.' });
    }
    if ((key === 'VIDEO_CONVERTER_URL' || key === 'SITE_URL') && !/^https?:\/\//i.test(value)) {
      return json({ ok: false, error: 'Must start with https://' });
    }
    await saveSetting(env, 'cfg:' + key, value);
    return json({ ok: true, saved: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const key = new URL(request.url).searchParams.get('key') || '';
    if (key) await env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind('cfg:' + key).run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

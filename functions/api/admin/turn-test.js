// Diagnostic: does the configured Cloudflare TURN key actually mint credentials?
// Owner-only. Returns whether TURN is working, without leaking the credential.
import { json, corsHeaders, requireUser, isOwnerOrCoOwner, getConfig } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const keyId = await getConfig(env, 'CF_TURN_KEY_ID');
    const token = await getConfig(env, 'CF_TURN_API_TOKEN');
    if (!keyId || !token) {
      return json({ ok: true, turn_configured: false, turn_working: false,
        message: 'No TURN key set. Calls use STUN only, which fails on many networks. Add CF_TURN_KEY_ID and CF_TURN_API_TOKEN in Config & Keys.' });
    }

    let status = 0, working = false, turnUrls = 0, err = '';
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 }),
      });
      status = r.status;
      if (r.ok) {
        const data = await r.json();
        const ice = data && data.iceServers;
        const arr = Array.isArray(ice) ? ice : (ice ? [ice] : []);
        arr.forEach((s) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          urls.forEach((u) => { if (String(u).indexOf('turn:') === 0 || String(u).indexOf('turns:') === 0) turnUrls++; });
        });
        working = turnUrls > 0;
      } else {
        const t = await r.text().catch(() => '');
        err = t.slice(0, 200);
      }
    } catch (e) { err = e.message; }

    return json({
      ok: true,
      turn_configured: true,
      turn_working: working,
      http_status: status,
      turn_urls: turnUrls,
      message: working
        ? '✅ TURN is working! Calls should connect on any network.'
        : (status === 401 || status === 403
            ? '❌ TURN key rejected (auth error). Double-check the Key ID and API Token — they may be swapped or mistyped.'
            : '❌ TURN did not return relay servers.' + (err ? ' (' + err + ')' : '')),
    });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

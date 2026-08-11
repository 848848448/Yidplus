// Returns the ICE servers for WebRTC calls: Google STUN always, plus short-lived
// Cloudflare TURN credentials when a TURN key is configured (Config & Keys:
// CF_TURN_KEY_ID + CF_TURN_API_TOKEN). Cloudflare TURN is free up to 1TB/month.
import { json, corsHeaders, requireUser, getConfig } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const iceServers = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    const keyId = await getConfig(env, 'CF_TURN_KEY_ID');
    const token = await getConfig(env, 'CF_TURN_API_TOKEN');
    if (keyId && token) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
        });
        if (r.ok) {
          const data = await r.json();
          if (data && data.iceServers) {
            // Cloudflare returns a single iceServers object; normalize to array.
            const cf = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
            for (const s of cf) iceServers.push(s);
          }
        }
      } catch (e) { /* fall back to STUN-only */ }
    }

    return json({ ok: true, iceServers });
  } catch (e) { return json({ ok: true, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); }
}

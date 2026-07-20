import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    // Computed server-side so the client never needs to know WHICH emails
    // are the owners' — keeps them out of the downloadable JS source.
    user.is_owner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
    // Soft "please verify your email" state — on only if the requirement is
    // enabled AND this account hasn't confirmed yet. Never blocks anything;
    // just lets the app show a gentle reminder banner.
    const verifySetting = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'require_email_verify'"
    ).first().catch(() => null);
    user.unverified = !!(verifySetting && verifySetting.value === 'true' && !user.email_verified);
    return json({ ok: true, user, impersonating: !!user._impersonatorId });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

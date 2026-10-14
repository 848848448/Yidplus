// GET /api/auth/google-login -> redirects to Google's OAuth consent screen
import { safeReturnTo, makeState, stateCookie } from './_oauth-state.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const googleClientId = env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    return new Response('Google Sign-In not configured', { status: 500 });
  }

  const redirectUri = `${origin}/api/auth/google-callback`;

  // Optional: where to send the user after login (default dashboard)
  const returnTo = safeReturnTo(url.searchParams.get('return_to') || '/', origin);

  const state = makeState(returnTo);

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 'Set-Cookie': stateCookie(state), 'Cache-Control': 'no-store' } });
}

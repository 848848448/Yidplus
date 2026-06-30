// GET /api/auth/google-login -> redirects to Google's OAuth consent screen
import { corsHeaders } from '../_helpers.js';

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
  const returnTo = url.searchParams.get('return_to') || '/';

  const state = btoa(JSON.stringify({ returnTo, nonce: crypto.randomUUID() }));

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

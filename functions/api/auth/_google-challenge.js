import { generateSessionToken, getCookie } from '../_helpers.js';
export const challengeCookie = (token, age = 300) => `__Host-yp_google_2fa=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export function challengeToken(request) { return getCookie(request, '__Host-yp_google_2fa'); }
export async function createGoogleChallenge(env, userId, ip, returnTo) {
  const token = generateSessionToken();
  await env.DB.prepare("INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, ?, 'google_2fa_pending', ?)")
    .bind(token, userId, ip, returnTo, new Date().toISOString()).run();
  return token;
}

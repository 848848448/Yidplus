// Browser-bound, short-lived OAuth state. No database or extra secret needed.
export const STATE_COOKIE = '__Host-yp_google_state';
export function safeReturnTo(value, origin) {
  try {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith('/api/auth/')) return '/';
    return target.pathname + target.search + target.hash;
  } catch (_) { return '/'; }
}
export function makeState(returnTo, now = Date.now()) {
  return btoa(encodeURIComponent(JSON.stringify({ returnTo, nonce: crypto.randomUUID(), createdAt: now })));
}
export function stateCookie(value, maxAge = 600) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function validateState(request, raw, origin, now = Date.now()) {
  if (!raw || raw.length > 4096) return null;
  const cookies = request.headers.get('Cookie') || '';
  const pair = cookies.split(';').map(v => v.trim()).find(v => v.startsWith(STATE_COOKIE + '='));
  if (!pair) return null;
  try {
    const saved = decodeURIComponent(pair.slice(STATE_COOKIE.length + 1));
    if (saved !== raw) return null;
    const state = JSON.parse(decodeURIComponent(atob(raw)));
    if (typeof state.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(state.nonce)) return null;
    if (!Number.isFinite(state.createdAt) || state.createdAt > now + 30000 || now - state.createdAt > 600000) return null;
    return { returnTo: safeReturnTo(state.returnTo, origin) };
  } catch (_) { return null; }
}

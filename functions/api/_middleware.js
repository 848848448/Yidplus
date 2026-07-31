import { findBan, logAttack } from './_helpers.js';

// Security middleware — scoped to /api/* only (this file lives under
// functions/api/, NOT functions/). It must stay here: a site-wide
// functions/_middleware.js previously caused an ERR_TOO_MANY_REDIRECTS loop
// on the _redirects-rewritten routes (/admin, /chat, /shorts, /music).
//
// Multiple independent defense layers ("defense in depth"): if one is
// bypassed, the others still stand.
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  let fullUrl = path + (url.search || '');
  try { fullUrl = decodeURIComponent(fullUrl); } catch (e) {}

  // ── Layer 0: turn away banned sources entirely ──
  // A banned IP / country / network is blocked from EVERY endpoint, not just
  // the login door — and each blocked attempt is still recorded, so the owner
  // can watch a banned attacker keep knocking and getting nowhere. Skipped for
  // CORS preflight (no body, no risk) and wrapped so a lookup hiccup can never
  // wall off the whole site.
  if (request.method !== 'OPTIONS') {
    try {
      const ban = await findBan(context.env, request);
      if (ban) {
        logAttack(context, 'Banned source (blocked)', 403);
        return _deny(403);
      }
    } catch (e) { /* fail open — never block legit traffic over a bad lookup */ }
  }

  // ── Layer 1: block injection / XSS / traversal signatures in the URL ──
  // Each pattern is labelled so a blocked hit can be recorded with a
  // human-readable attack type in the security log.
  const suspiciousPatterns = [
    { rx: /(union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+\w+\s+set)/i, type: 'SQL Injection' },
    { rx: /(\bor\s+1\s*=\s*1|\band\s+1\s*=\s*1)/i,     type: 'SQL Injection' },
    { rx: /(<script|javascript:|<iframe|<img\s|<svg\s)/i, type: 'XSS (script injection)' },
    // Real HTML event-handler injection (onerror=, onclick=, onload=, …). The
    // handler name is enumerated on purpose: a loose /on\w+=/ falsely flagged
    // ordinary query params that merely END in "on" — permissions=, options=,
    // session=, reason= — as attacks (the admin's own traffic).
    { rx: /\bon(abort|blur|change|click|contextmenu|copy|cut|dblclick|drag|drop|error|focus|input|keydown|keypress|keyup|load|mousedown|mousemove|mouseout|mouseover|mouseup|paste|pointer\w+|reset|resize|scroll|select|submit|toggle|touchstart|touchmove|touchend|unload|wheel|animation\w+|transitionend)\s*=/i, type: 'XSS (script injection)' },
    { rx: /\.\.[\/\\]/,                                 type: 'Path traversal' },
    { rx: /\/etc\/(passwd|shadow)/i,                    type: 'System file probe' },
    { rx: /\$\{.*\}/,                                    type: 'Template injection' },
    { rx: /\bexec\s*\(|\beval\s*\(|system\s*\(/i,       type: 'Code execution probe' },
  ];
  for (const p of suspiciousPatterns) {
    if (p.rx.test(fullUrl)) { logAttack(context, p.type, 400); return _deny(400); }
  }

  // ── Layer 2: block probes for other stacks / secret files ──
  const badPaths = [
    /\/wp-(admin|login|content|includes)/i, /\/(phpmyadmin|adminer|xmlrpc)/i,
    /\.(php|asp|aspx|jsp|cgi|sh|bak|sql|env)$/i, /\/\.(git|env|htaccess|ssh)/i,
  ];
  for (const rx of badPaths) {
    if (rx.test(path)) { logAttack(context, 'Scanner / file probe', 403); return _deny(403); }
  }

  // ── Layer 3: HTTP method allowlist ──
  if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'].includes(request.method)) {
    logAttack(context, 'Unusual HTTP method', 405);
    return _deny(405);
  }

  // ── Layer 4: cap request body size (~105MB) against memory exhaustion ──
  const clen = parseInt(request.headers.get('content-length') || '0', 10);
  if (clen > 105 * 1024 * 1024) return _deny(413);

  // ── Read-only impersonation guard ──
  // If this session is an owner "viewing as" a user, block every write. The
  // only write allowed is exiting the preview (DELETE /api/admin/impersonate).
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    const isExit = (path === '/api/admin/impersonate' && request.method === 'DELETE');
    if (!isExit) {
      const tok = _cookie(request, 'yp_session');
      if (tok) {
        try {
          const s = await context.env.DB.prepare('SELECT impersonator_id FROM sessions WHERE id = ?').bind(tok).first();
          if (s && s.impersonator_id) {
            return new Response(JSON.stringify({ ok: false, error: "You're viewing as a user (read-only). Exit to make changes." }), {
              status: 403, headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (e) { /* column may not exist yet — nothing to enforce */ }
      }
    }
  }

  // ── Run the actual endpoint, masking any uncaught internal error ──
  let response;
  try {
    response = await next();
  } catch (e) {
    // Record the server-side error so it appears in Admin → Code Errors, then
    // return a clean 500 (never leak a stack trace to the client).
    try {
      const msg = ('Server: ' + (e && e.message ? e.message : String(e))).slice(0, 1000);
      const src = request.method + ' ' + path;
      const stack = (e && e.stack) ? String(e.stack).slice(0, 2000) : '';
      context.waitUntil((async () => {
        try {
          await context.env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS error_log (id TEXT PRIMARY KEY, level TEXT DEFAULT 'error', message TEXT, source TEXT, line INTEGER, col INTEGER, stack TEXT, page TEXT, ua TEXT, user_id TEXT, nickname TEXT, count INTEGER DEFAULT 1, created_at TEXT)"
          ).run();
          await context.env.DB.prepare("ALTER TABLE error_log ADD COLUMN level TEXT DEFAULT 'error'").run().catch(() => {});
          const ex = await context.env.DB.prepare("SELECT id FROM error_log WHERE message = ? AND source = ? LIMIT 1").bind(msg, src).first().catch(() => null);
          if (ex) {
            await context.env.DB.prepare("UPDATE error_log SET count = count + 1, created_at = ? WHERE id = ?").bind(new Date().toISOString(), ex.id).run();
          } else {
            await context.env.DB.prepare("INSERT INTO error_log (id, level, message, source, stack, page, count, created_at) VALUES (?,?,?,?,?,?,1,?)")
              .bind(crypto.randomUUID(), 'server', msg, src, stack, path, new Date().toISOString()).run();
          }
        } catch (le) { /* logging must never break the response */ }
      })());
    } catch (le) {}
    return _deny(500);
  }

  // ── Layer 5: harden response headers on every API response ──
  const h = new Headers(response.headers);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('X-XSS-Protection', '1; mode=block');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  h.set('X-Permitted-Cross-Domain-Policies', 'none');
  h.delete('X-Powered-By');
  h.delete('Server');
  if (!url.hostname.includes('localhost')) {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers: h,
  });
}

function _deny(status) {
  return new Response(JSON.stringify({ ok: false, error: status === 500 ? 'Server error' : 'Blocked' }), {
    status, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });
}


function _cookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

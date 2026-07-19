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

  // ── Layer 1: block injection / XSS / traversal signatures in the URL ──
  // Each pattern is labelled so a blocked hit can be recorded with a
  // human-readable attack type in the security log.
  const suspiciousPatterns = [
    { rx: /(union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+\w+\s+set)/i, type: 'SQL Injection' },
    { rx: /(\bor\s+1\s*=\s*1|\band\s+1\s*=\s*1)/i,     type: 'SQL Injection' },
    { rx: /(<script|javascript:|on\w+\s*=|<iframe|<img\s)/i, type: 'XSS (script injection)' },
    { rx: /\.\.[\/\\]/,                                 type: 'Path traversal' },
    { rx: /\/etc\/(passwd|shadow)/i,                    type: 'System file probe' },
    { rx: /\$\{.*\}/,                                    type: 'Template injection' },
    { rx: /\bexec\s*\(|\beval\s*\(|system\s*\(/i,       type: 'Code execution probe' },
  ];
  for (const p of suspiciousPatterns) {
    if (p.rx.test(fullUrl)) { _logAttack(context, p.type, 400); return _deny(400); }
  }

  // ── Layer 2: block probes for other stacks / secret files ──
  const badPaths = [
    /\/wp-(admin|login|content|includes)/i, /\/(phpmyadmin|adminer|xmlrpc)/i,
    /\.(php|asp|aspx|jsp|cgi|sh|bak|sql|env)$/i, /\/\.(git|env|htaccess|ssh)/i,
  ];
  for (const rx of badPaths) {
    if (rx.test(path)) { _logAttack(context, 'Scanner / file probe', 403); return _deny(403); }
  }

  // ── Layer 3: HTTP method allowlist ──
  if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'].includes(request.method)) {
    _logAttack(context, 'Unusual HTTP method', 405);
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
    return _deny(500); // never leak a stack trace to the client
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

// Record a blocked attack attempt to the security log. Runs entirely in the
// background via waitUntil so it NEVER slows down the response the attacker
// gets (and never slows a legitimate request — this is only ever reached on
// the deny path). Wrapped in try/catch and .catch() so a logging failure can
// never turn a blocked attack into an error. The table self-creates, so no
// manual migration is needed.
function _logAttack(context, attackType, status) {
  try {
    const { request, env } = context;
    if (!env || !env.DB) return;

    const url = new URL(request.url);
    // Cloudflare gives us the true client IP and geo/network data for free.
    const ip = (request.headers.get('CF-Connecting-IP') ||
                request.headers.get('X-Forwarded-For') ||
                'unknown').split(',')[0].trim().slice(0, 64);
    const cf = request.cf || {};
    const country = (request.headers.get('CF-IPCountry') || cf.country || '').slice(0, 8);
    const city    = (cf.city || '').slice(0, 80);
    const region  = (cf.region || '').slice(0, 80);
    const asn     = (cf.asOrganization || (cf.asn ? ('AS' + cf.asn) : '')).slice(0, 120);
    const ua      = (request.headers.get('User-Agent') || '').slice(0, 400);
    const ref     = (request.headers.get('Referer') || '').slice(0, 300);
    const path    = (url.pathname + (url.search || '')).slice(0, 500);
    const method  = (request.method || '').slice(0, 10);

    const work = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS attack_logs (
           id TEXT PRIMARY KEY, ip TEXT, country TEXT, city TEXT, region TEXT,
           asn TEXT, method TEXT, path TEXT, attack_type TEXT, user_agent TEXT,
           referer TEXT, status INTEGER, created_at TEXT
         )`
      ).run().catch(() => {});

      await env.DB.prepare(
        `INSERT INTO attack_logs
           (id, ip, country, city, region, asn, method, path, attack_type, user_agent, referer, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), ip, country, city, region, asn,
        method, path, attackType, ua, ref, status
      ).run().catch(() => {});

      // Occasionally prune anything older than 60 days so the table can't
      // grow without bound. Cheap, and only runs ~3% of the time.
      if (Math.random() < 0.03) {
        await env.DB.prepare(
          `DELETE FROM attack_logs WHERE created_at < datetime('now', '-60 days')`
        ).run().catch(() => {});
      }
    })();

    if (context.waitUntil) context.waitUntil(work);
  } catch (e) { /* logging must never break the block */ }
}

function _cookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

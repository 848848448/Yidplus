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
  const suspiciousPatterns = [
    /(union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+\w+\s+set)/i, // SQLi
    /(\bor\s+1\s*=\s*1|\band\s+1\s*=\s*1)/i,     // SQLi tautology
    /(<script|javascript:|on\w+\s*=|<iframe|<img\s)/i, // XSS
    /\.\.[\/\\]/,                                 // path traversal
    /\/etc\/(passwd|shadow)/i,                    // system files
    /\$\{.*\}/,                                    // template injection
    /\bexec\s*\(|\beval\s*\(|system\s*\(/i,       // code-exec probes
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullUrl)) return _deny(400);
  }

  // ── Layer 2: block probes for other stacks / secret files ──
  const badPaths = [
    /\/wp-(admin|login|content|includes)/i, /\/(phpmyadmin|adminer|xmlrpc)/i,
    /\.(php|asp|aspx|jsp|cgi|sh|bak|sql|env)$/i, /\/\.(git|env|htaccess|ssh)/i,
  ];
  for (const rx of badPaths) {
    if (rx.test(path)) return _deny(403);
  }

  // ── Layer 3: HTTP method allowlist ──
  if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'].includes(request.method)) {
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

function _cookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

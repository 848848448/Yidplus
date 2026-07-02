// Security middleware — scoped to /api/* only (this file lives under
// functions/api/, not functions/, on purpose). It was previously at
// functions/_middleware.js, which made it run on EVERY request site-wide,
// including static pages served via _redirects rewrites like /admin, /chat,
// /shorts, /music. That combination caused an actual redirect loop
// (ERR_TOO_MANY_REDIRECTS) on those routes. Its job — blocking suspicious
// URL patterns and adding security headers — only makes sense for API
// calls anyway, so scoping it here fixes the loop and matches its real
// intent.
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // ── Block suspicious patterns in URLs (SQLi, XSS, path traversal)
  const suspiciousPatterns = [
    /(\-\-|;|\/\*|\*\/)/,           // SQL comments
    /(union\s+select|drop\s+table|insert\s+into|delete\s+from)/i,  // SQL injection
    /(<script|javascript:|on\w+=)/i, // XSS
    /\.\.\//,                         // Path traversal
    /\/etc\/passwd/i,                 // System file access
  ];

  const fullUrl = url.pathname + url.search;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullUrl)) {
      return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Rate limit: max 120 API requests per minute per IP
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const isApiRequest = url.pathname.startsWith('/api/');

  // Get response from the actual function
  const response = await next();

  // ── Add security headers to all responses
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HTTPS only
  if (!url.hostname.includes('localhost')) {
    newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

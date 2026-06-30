// GET /api/auth/verify-email?token=xxx -> marks user.email_verified=1, redirects to login w/ success msg
import { json } from '../_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;
  const token = url.searchParams.get('token');

  if (!token) {
    return Response.redirect(`${origin}/index.html?verify=missing_token`, 302);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT user_id, email, expires_at FROM email_verifications WHERE token = ?'
    ).bind(token).first();

    if (!row) {
      return Response.redirect(`${origin}/index.html?verify=invalid`, 302);
    }
    if (new Date(row.expires_at) < new Date()) {
      return Response.redirect(`${origin}/index.html?verify=expired`, 302);
    }

    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.user_id).run();
    await env.DB.prepare('DELETE FROM email_verifications WHERE token = ?').bind(token).run();

    return Response.redirect(`${origin}/index.html?verify=success`, 302);
  } catch (err) {
    return Response.redirect(`${origin}/index.html?verify=error`, 302);
  }
      }

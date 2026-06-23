// GET /api/ads — returns active ads for the current user
// Respects: pages filter, exempt_users list, active flag
import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const userId = user ? user.id : null;

    const { results } = await env.DB.prepare(
      `SELECT id, title, subtitle, media_key, link_url, email_url,
              interval_minutes, countdown_seconds, pages, exempt_users
       FROM ads WHERE active = 1
       ORDER BY sort_order ASC, created_at DESC LIMIT 20`
    ).all();

    const out = results
      .filter(a => {
        if (!userId) return true;
        try {
          const exempt = JSON.parse(a.exempt_users || '[]');
          return !exempt.includes(userId);
        } catch { return true; }
      })
      .map(a => ({
        id: a.id,
        title: a.title,
        subtitle: a.subtitle,
        email_url: a.email_url,
        link_url: a.link_url,
        interval_minutes: a.interval_minutes || 60,
        countdown_seconds: a.countdown_seconds || 5,
        pages: a.pages || 'all',
        exempt_users: a.exempt_users || '[]',
        media_url: a.media_key ? `/api/media/${encodeURIComponent(a.media_key)}` : null,
        is_video: a.media_key ? /\.(mp4|webm|mov)$/i.test(a.media_key) : false,
      }));

    return json({ ok: true, ads: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }

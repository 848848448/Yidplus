// functions/api/posts.js
// Cloudflare Pages Function — D1 database API
// Handles GET (fetch posts) and POST (create post)

export async function onRequest(context) {
  const { request, env } = context;

  // CORS headers — allow your frontend to call this
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // ── GET /api/posts → fetch all posts ──────────────────
  if (request.method === 'GET') {
    try {
      const { results } = await env.DB.prepare(
        'SELECT * FROM posts ORDER BY created_at DESC LIMIT 50'
      ).all();

      return new Response(JSON.stringify({ ok: true, posts: results }), {
        status: 200,
        headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers,
      });
    }
  }

  // ── POST /api/posts → create a new post ───────────────
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { username, caption, content } = body;

      if (!username || !content) {
        return new Response(
          JSON.stringify({ ok: false, error: 'username and content are required' }),
          { status: 400, headers }
        );
      }

      await env.DB.prepare(
        'INSERT INTO posts (username, caption, content, likes, comments, created_at) VALUES (?, ?, ?, 0, 0, datetime("now"))'
      ).bind(username, caption || '', content).run();

      return new Response(JSON.stringify({ ok: true }), { status: 201, headers });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers,
      });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers,
  });
}

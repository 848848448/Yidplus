// functions/api/posts.js
// GET    /api/posts            -> list recent posts (newest first), with liked flag per viewer
// POST   /api/posts            -> { caption, content } create a post
// PUT    /api/posts            -> { id, like: true|false } toggle like
// DELETE /api/posts?id=xxx     -> delete own post, or any post if Moderator/Admin (cascades likes+comments)

import { json, corsHeaders, requireUser, canDeleteContent, isAdminRole, logAudit, notifyAdmin, notifyUser, notifyChannelFollowers } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Runs once per worker isolate: ensures the featured column exists and, more
// importantly, that the feed has proper indexes (posts had none, so every feed
// load was a full table scan + sort — the main source of site-wide slowness).
let _postsReady = false;
async function ensurePostsSchema(env) {
  if (_postsReady) return;
  _postsReady = true;
  try {
    await env.DB.prepare('ALTER TABLE posts ADD COLUMN is_featured INTEGER DEFAULT 0').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(is_featured, created_at)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id)').run().catch(() => {});
  } catch (e) { _postsReady = false; }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const filterUserId = url.searchParams.get('user_id');
    // One-time (per worker) schema + index setup so the feed query is fast and
    // we don't run DDL on every request.
    await ensurePostsSchema(env);

    let results;
    try {
      const r = filterUserId
        ? await env.DB.prepare(
            `SELECT id, username, user_id, caption, content, likes, comments, created_at
             FROM posts WHERE user_id = ? AND (hidden IS NULL OR hidden = 0) ORDER BY created_at DESC LIMIT 30`
          ).bind(filterUserId).all()
        : await env.DB.prepare(
            `SELECT id, username, user_id, caption, content, likes, comments, created_at, is_featured
             FROM posts WHERE (hidden IS NULL OR hidden = 0) ORDER BY is_featured DESC, created_at DESC LIMIT 30`
          ).all();
      results = r.results;
    } catch (e) {
      const r = filterUserId
        ? await env.DB.prepare(
            `SELECT id, username, user_id, caption, content, likes, comments, created_at
             FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
          ).bind(filterUserId).all()
        : await env.DB.prepare(
            `SELECT id, username, user_id, caption, content, likes, comments, created_at
             FROM posts ORDER BY created_at DESC LIMIT 30`
          ).all();
      results = r.results;
    }

    let likedIds = new Set();
    if (user) {
      const { results: likedRows } = await env.DB.prepare(
        `SELECT post_id FROM post_likes WHERE user_id = ?`
      ).bind(user.id).all();
      likedIds = new Set(likedRows.map(r => r.post_id));
    }

    // Privacy filter: a post from a channel marked followers_only must NOT
    // appear in the public feed unless the viewer is the owner, an approved
    // follower, or an admin. When a specific user_id is requested (viewing one
    // channel), channels.js already gates that page, so we only filter the
    // mixed public feed here.
    if (!filterUserId && results.length) {
      const isAdmin = user && (user.role === 'admin_super' || user.role === 'admin_limited');
      if (!isAdmin) {
        // Which of the post authors run a private channel?
        const authorIds = [...new Set(results.map(p => p.user_id).filter(Boolean))];
        if (authorIds.length) {
          const ph = authorIds.map(() => '?').join(',');
          const privRows = await env.DB.prepare(
            `SELECT owner_id FROM channels WHERE privacy = 'followers_only' AND owner_id IN (${ph})`
          ).bind(...authorIds).all().catch(() => ({ results: [] }));
          const privateOwners = new Set((privRows.results || []).map(r => r.owner_id));

          if (privateOwners.size) {
            // Of those private owners, which does the viewer follow (or own)?
            let allowed = new Set();
            if (user) {
              allowed.add(user.id); // your own private posts still show to you
              const followRows = await env.DB.prepare(
                `SELECT channel_owner_id FROM channel_followers WHERE follower_id = ? AND channel_owner_id IN (${ph})`
              ).bind(user.id, ...authorIds).all().catch(() => ({ results: [] }));
              (followRows.results || []).forEach(r => allowed.add(r.channel_owner_id));
            }
            results = results.filter(p => !privateOwners.has(p.user_id) || allowed.has(p.user_id));
          }
        }
      }
    }

    const out = results.map(p => ({ ...p, liked: likedIds.has(p.id) }));
    return json({ ok: true, posts: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    // Two shapes: JSON { caption, content } for text posts, or multipart with
    // an optional file for photo/video posts.
    let caption = '';
    let content = '';
    const ctype = request.headers.get('content-type') || '';

    if (ctype.indexOf('multipart/form-data') !== -1) {
      const form = await request.formData();
      caption = (form.get('caption') || '').toString().trim();
      const file = form.get('file');
      if (file && typeof file.arrayBuffer === 'function' && file.size > 0) {
        const isVideo = (file.type || '').indexOf('video') === 0;
        if (file.size > (isVideo ? 60 : 12) * 1024 * 1024) {
          return json({ ok: false, error: isVideo ? 'Video too large (max 60MB)' : 'Image too large (max 12MB)' }, 400);
        }
        const ext = (file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || (isVideo ? 'mp4' : 'jpg');
        const key = 'posts/' + crypto.randomUUID() + '.' + ext;
        await env.MY_BUCKET.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg') }
        });
        content = key;
      }
    } else {
      const body = await request.json();
      caption = (body.caption || '').trim();
      content = body.content || '';
    }

    if (!caption && !content) return json({ ok: false, error: 'Write something or attach a photo/video' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // username is a denormalized snapshot of the nickname at post time —
    // always sourced from the authenticated user, never trusted from the client.
    let finalId = id;
    try {
      await env.DB.prepare(
        `INSERT INTO posts (id, username, user_id, caption, content, likes, comments, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
      ).bind(id, user.nickname || 'Anonymous', user.id, caption, content, now).run();
    } catch (mismatchErr) {
      // Some deployments have posts.id as INTEGER (autoincrement), which
      // rejects a UUID string with SQLITE_MISMATCH. Fall back to letting the
      // DB assign the id and read it back.
      if (String(mismatchErr.message || '').includes('MISMATCH')) {
        const res = await env.DB.prepare(
          `INSERT INTO posts (username, user_id, caption, content, likes, comments, created_at)
           VALUES (?, ?, ?, ?, 0, 0, ?)`
        ).bind(user.nickname || 'Anonymous', user.id, caption, content, now).run();
        finalId = res.meta && res.meta.last_row_id != null ? res.meta.last_row_id : id;
      } else {
        throw mismatchErr;
      }
    }

    const _esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    context.waitUntil(notifyAdmin(env,
      '📝 <b>New post</b>\n👤 ' + _esc(user.nickname || 'Anonymous') + '\n' + (_esc((caption || content || '').slice(0, 300)) || '(no text)'),
      'post'));
    // Notify all followers of this channel about the new post
    notifyChannelFollowers(env, context, user.id, user.nickname || 'Channel', finalId);
    return json({ ok: true, post: { id: finalId, username: user.nickname, user_id: user.id, caption, content: content, likes: 0, comments: 0, created_at: now, liked: false } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { id, like } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const existing = await env.DB.prepare(
      `SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`
    ).bind(id, user.id).first();

    if (like && !existing) {
      await env.DB.prepare(`INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(id, user.id, new Date().toISOString()).run();
      await env.DB.prepare(`UPDATE posts SET likes = likes + 1 WHERE id = ?`).bind(id).run();
      try {
        const owner = await env.DB.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
        if (owner && owner.user_id) notifyUser(env, context, owner.user_id, {
          type: 'like', actor_id: user.id, actor_nick: user.nickname,
          text: (user.nickname || 'Someone') + ' liked your post', link: '/',
        });
      } catch (e) {}
    } else if (!like && existing) {
      await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`).bind(id, user.id).run();
      await env.DB.prepare(`UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?`).bind(id).run();
    }

    const row = await env.DB.prepare(`SELECT likes FROM posts WHERE id = ?`).bind(id).first();
    return json({ ok: true, likes: row ? row.likes : 0 });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const post = await env.DB.prepare(`SELECT user_id, username FROM posts WHERE id = ?`).bind(id).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    if (!canDeleteContent(user, post.user_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    // Cascading delete: remove likes + comments before the post itself.
    await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM post_comments WHERE post_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();

    // Audit log only when a moderator/admin deletes someone else's content.
    if (user.id !== post.user_id && isAdminRole(user, env.OWNER_EMAIL)) {
      await logAudit(env, user, 'delete_post', 'post', id, `Deleted post by @${post.username}`);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }

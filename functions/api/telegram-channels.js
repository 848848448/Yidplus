import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Once per isolate, not once per request — this creates four tables and alters
// another before every single call, and the ALTERs all throw because the
// columns are already there.
let _schemaReady = null;

async function ensureTable(env) {
  if (_schemaReady) return _schemaReady;
  _schemaReady = _migrate(env);
  return _schemaReady;
}

async function _migrate(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_channels (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, title TEXT, added_by TEXT, created_at TEXT NOT NULL, sort_order INTEGER DEFAULT 0)'
  ).run().catch(() => {});
  // Lazy column: added after the table shipped.
  await env.DB.prepare('ALTER TABLE telegram_channels ADD COLUMN photo_key TEXT').run().catch(() => {});
  // Private channels: only listed nicknames (plus admins) may see/join them.
  await env.DB.prepare('ALTER TABLE telegram_channels ADD COLUMN is_private INTEGER DEFAULT 0').run().catch(() => {});
  await env.DB.prepare('ALTER TABLE telegram_channels ADD COLUMN allowed_users TEXT').run().catch(() => {});
  // Who joined from OUR site. Deliberately not Telegram's subscriber count —
  // this is the audience on YID PLUS.
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_channel_members (username TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (username, user_id))'
  ).run().catch(() => {});
  // Read markers live apart from membership: reading a channel isn't joining it.
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_channel_reads (username TEXT NOT NULL, user_id TEXT NOT NULL, last_read_at TEXT, PRIMARY KEY (username, user_id))'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_posts (id TEXT PRIMARY KEY, username TEXT NOT NULL, tg_msg_id INTEGER NOT NULL, text TEXT, media_url TEXT, media_type TEXT, link TEXT, posted_at TEXT, created_at TEXT NOT NULL, UNIQUE(username, tg_msg_id))'
  ).run().catch(() => {});

  // Every channel-list load counts unread posts per channel and looks up which
  // channels the caller joined. Neither had an index: the unread count scanned
  // the whole posts table, and the membership lookup scanned all members —
  // per user, every minute.
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_tgposts_user_posted ON telegram_posts(username, posted_at)'
  ).run().catch(() => {});
  // The members PK is (username, user_id), so a lookup BY user_id alone can't
  // use it.
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_tgmembers_user ON telegram_channel_members(user_id)'
  ).run().catch(() => {});
}

// Clean a user-supplied handle into a bare Telegram username.
function cleanUsername(raw) {
  if (!raw) return '';
  let u = String(raw).trim();
  u = u.replace(/^https?:\/\/(t\.me|telegram\.me|telegram\.org)\//i, ''); // strip full links
  u = u.replace(/^s\//, '');   // strip the /s/ preview prefix
  u = u.replace(/^@/, '');      // strip a leading @
  u = u.split(/[/?#]/)[0];      // drop anything after the name
  return u.replace(/[^a-zA-Z0-9_]/g, '');
}

// A private-invite link (t.me/+CODE or t.me/joinchat/CODE) is NOT a public
// channel and cannot be embedded — Telegram only exposes a public /s/ feed for
// channels that have a @username.
function isPrivateInvite(raw) {
  const s = String(raw || '');
  return /(?:t\.me|telegram\.me)\/\+/.test(s) || /joinchat/i.test(s) || /\/\+[A-Za-z0-9_-]{10,}/.test(s) || /^\+/.test(s.trim());
}

async function savePhoto(env, file, username) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) return null;
  if (!(file.type || '').startsWith('image/')) throw new Error('Photo must be an image');
  if (file.size > 5 * 1024 * 1024) throw new Error('Photo too large (max 5MB)');
  const ext = (file.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
  // Same key each time + a cache-busting query on the URL, so re-uploading
  // replaces the old photo instead of littering the bucket.
  const key = `tgchan/${username}.${ext}`;
  await env.MY_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

// GET → list all Telegram channels, with how many YID PLUS users joined each
// and how many posts are unread for the caller.
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureTable(env);
    const user = await requireUser(request, env).catch(() => null);

    const res = await env.DB.prepare(
      `SELECT c.id, c.username, c.title, c.photo_key, c.created_at, c.is_private, c.allowed_users,
              (SELECT COUNT(*) FROM telegram_channel_members m WHERE m.username = c.username) AS members,
              (SELECT MAX(p.posted_at) FROM telegram_posts p WHERE p.username = c.username) AS last_post_at,
              (SELECT p.text FROM telegram_posts p WHERE p.username = c.username ORDER BY p.tg_msg_id DESC LIMIT 1) AS last_text,
              (SELECT p.media_type FROM telegram_posts p WHERE p.username = c.username ORDER BY p.tg_msg_id DESC LIMIT 1) AS last_media
       FROM telegram_channels c
       ORDER BY c.sort_order ASC, c.created_at ASC`
    ).all();

    const isAdmin = user && isSuperOrOwner(user, env.OWNER_EMAIL);
    const myNick = user && user.nickname ? String(user.nickname).toLowerCase() : '';
    const myEmail = user && user.email ? String(user.email).toLowerCase() : '';
    // Can this viewer see a given private channel?
    const canSeePrivate = (allowedRaw) => {
      if (isAdmin) return true;
      if (!user) return false;
      let list = [];
      try { list = JSON.parse(allowedRaw || '[]'); } catch (e) { list = []; }
      return list.some((x) => {
        const v = String(x || '').toLowerCase().replace(/^@/, '');
        return v && (v === myNick || v === myEmail);
      });
    };

    let joined = [];
    let unreadBy = {};
    if (user) {
      const j = await env.DB.prepare('SELECT username FROM telegram_channel_members WHERE user_id = ?').bind(user.id).all();
      joined = (j.results || []).map((r) => r.username);

      // Same shape as a group's unread: posts newer than this reader's stamp.
      // A channel never read before counts as fully unread.
      const u = await env.DB.prepare(
        `SELECT p.username, COUNT(*) AS c
         FROM telegram_posts p
         LEFT JOIN telegram_channel_reads r
           ON r.username = p.username AND r.user_id = ?
         WHERE r.last_read_at IS NULL OR p.posted_at > r.last_read_at
         GROUP BY p.username`
      ).bind(user.id).all().catch(() => ({ results: [] }));
      for (const row of (u.results || [])) unreadBy[row.username] = row.c;
    }

    const channels = (res.results || [])
      .filter((c) => !c.is_private || canSeePrivate(c.allowed_users))
      .map((c) => ({
        id: c.id,
        username: c.username,
        title: c.title,
        created_at: c.created_at,
        is_private: c.is_private ? 1 : 0,
        // Only the admin needs the allow-list (to edit it); others never see it.
        allowed_users: isAdmin ? (c.allowed_users || '[]') : undefined,
        members: c.members || 0,
        joined: joined.indexOf(c.username) !== -1,
        unread: unreadBy[c.username] || 0,
        last_post_at: c.last_post_at || null,
        last_text: c.last_text || '',
        last_media: c.last_media || '',
        photo_url: c.photo_key ? '/api/media/' + c.photo_key : null,
      }));

    return json({ ok: true, channels });
  } catch (err) { return json({ ok: true, channels: [], error: err.message }); }
}

// POST { username, title } (+ optional photo, multipart) → add (owner/super only)
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureTable(env);

    let rawUsername = '', title = '', photo = null;
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      rawUsername = (form.get('username') || '').toString();
      title = (form.get('title') || '').toString().trim();
      photo = form.get('photo');
    } else {
      const body = await request.json();
      rawUsername = body.username || '';
      title = (body.title || '').trim();
    }

    if (isPrivateInvite(rawUsername)) {
      return json({ ok: false, error: 'That is a private invite link (t.me/+…). Only PUBLIC channels with a @username can be embedded. Ask the channel owner for its public @username, or make the channel public.' }, 400);
    }
    const username = cleanUsername(rawUsername);
    if (!username || username.length < 3) return json({ ok: false, error: 'Enter a valid public @username (not a t.me/+ invite link)' }, 400);
    title = title.slice(0, 80) || username;

    const exists = await env.DB.prepare('SELECT id FROM telegram_channels WHERE username = ?').bind(username).first();
    if (exists) return json({ ok: false, error: 'That channel is already added' }, 409);

    const photoKey = photo ? await savePhoto(env, photo, username) : null;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO telegram_channels (id, username, title, photo_key, added_by, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, username, title, photoKey, user.id, new Date().toISOString(), Date.now()).run();

    return json({ ok: true, channel: { id, username, title } }, 201);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

// PUT → rename / re-photo a channel (owner/super only).
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: true, error: 'Forbidden' });
    await ensureTable(env);

    let id = '', title = null, photo = null, isPrivate = null, allowedUsers = null;
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      id = (form.get('id') || '').toString();
      if (form.has('title')) title = (form.get('title') || '').toString().trim().slice(0, 80);
      photo = form.get('photo');
      if (form.has('is_private')) isPrivate = (form.get('is_private') || '') === '1' ? 1 : 0;
      if (form.has('allowed_users')) allowedUsers = (form.get('allowed_users') || '').toString();
    } else {
      const body = await request.json();
      id = body.id || '';
      if (body.title !== undefined) title = String(body.title).trim().slice(0, 80);
      if (body.is_private !== undefined) isPrivate = body.is_private ? 1 : 0;
      if (body.allowed_users !== undefined) allowedUsers = body.allowed_users;
    }
    if (!id) return json({ ok: true, error: 'id required' });

    const row = await env.DB.prepare('SELECT username FROM telegram_channels WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: true, error: 'Channel not found' });

    if (title) await env.DB.prepare('UPDATE telegram_channels SET title = ? WHERE id = ?').bind(title, id).run();
    if (isPrivate !== null) await env.DB.prepare('UPDATE telegram_channels SET is_private = ? WHERE id = ?').bind(isPrivate, id).run();
    if (allowedUsers !== null) {
      // Normalize to a JSON array of lowercase handles/emails.
      let list = [];
      if (Array.isArray(allowedUsers)) list = allowedUsers;
      else list = String(allowedUsers).split(/[\n,]+/);
      list = list.map((s) => String(s).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
      await env.DB.prepare('UPDATE telegram_channels SET allowed_users = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
    }
    if (photo && photo.size) {
      const key = await savePhoto(env, photo, row.username);
      await env.DB.prepare('UPDATE telegram_channels SET photo_key = ? WHERE id = ?').bind(key, id).run();
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: true, error: err.message }); }
}

// DELETE ?id= → remove a channel (owner / super admin only)
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureTable(env);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    const row = await env.DB.prepare('SELECT username FROM telegram_channels WHERE id = ?').bind(id).first();
    await env.DB.prepare('DELETE FROM telegram_channels WHERE id = ?').bind(id).run();
    if (row) await env.DB.prepare('DELETE FROM telegram_channel_members WHERE username = ?').bind(row.username).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

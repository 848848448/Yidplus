// functions/api/admin/optimize.js
// Owner-only. Adds database indexes so the app stays fast with many users.
// Each statement runs independently (try/catch), so a column that doesn't
// exist on this deployment just gets skipped instead of aborting the rest.
//   POST  -> { ok, created, skipped, total }
//   GET   -> { ok, indexes: [...] }  (list current indexes)

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

const INDEXES = [
  // Chat — the hottest path. Loading a room filters by room_id and orders by created_at.
  "CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_room_hidden ON messages(room_id, hidden)",
  "CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id)",
  // Membership checks run on almost every chat request.
  "CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id)",
  "CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_room_members_pair ON room_members(room_id, user_id)",
  // Reactions.
  "CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_room ON reactions(room_id)",
  // Auth — email lookup on every login; sessions on every authenticated request.
  "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)",
  "CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  // Feeds.
  "CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(is_featured, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id)",
  "CREATE INDEX IF NOT EXISTS idx_shorts_owner_created ON shorts(owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_shorts_created ON shorts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_music_owner ON music_tracks(owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id)",
  // Social graph.
  "CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows(follower_id)",
  "CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id)",
  "CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks(blocker_id)",
  "CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_id)",
  // channel_followers is keyed (channel_owner_id, follower_id) so owner-side
  // lookups ("who follows my channel") are already covered, but follower_id
  // alone (channels.js "how many channels do I follow", posts.js feed
  // privacy filter) was a full scan.
  "CREATE INDEX IF NOT EXISTS idx_channel_followers_follower ON channel_followers(follower_id)",
  // Comments — the real tables are post_comments / short_comments (there is no
  // "comments" table), so the two statements that used to live here silently
  // failed every single run (caught by the try/catch below) and never indexed
  // anything. post_comments/short_comments back every post and short's comment
  // list AND the per-row `(SELECT COUNT(*) FROM short_comments WHERE short_id
  // = s.id)` subquery that runs on every shorts feed load — both were doing
  // full table scans.
  "CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_short_comments_short ON short_comments(short_id, created_at)",
  // Likes — post_likes was covered below already; short_likes/music_likes use
  // the identical WHERE short_id=?/track_id=? and WHERE user_id=? patterns
  // (feed "did I like this" checks + toggle) but were never added.
  "CREATE INDEX IF NOT EXISTS idx_short_likes_short ON short_likes(short_id)",
  "CREATE INDEX IF NOT EXISTS idx_short_likes_user ON short_likes(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_music_likes_track ON music_likes(track_id)",
  "CREATE INDEX IF NOT EXISTS idx_music_likes_user ON music_likes(user_id)",
  // Notifications — polled by every signed-in user every 45-90s for the bell
  // badge count, plus the full list fetch and the "trim to latest 100" cleanup
  // on every write. Never indexed.
  "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)",
  // Saved items (shorts/music "save for later" list).
  "CREATE INDEX IF NOT EXISTS idx_saved_items_user ON saved_items(user_id, item_type, created_at)",
  // Moderation / security.
  "CREATE INDEX IF NOT EXISTS idx_reports_message ON reports(message_id)",
  "CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id)",
  "CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id)",
  "CREATE INDEX IF NOT EXISTS idx_loginlogs_user ON login_logs(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_loginlogs_ip ON login_logs(ip)",
  "CREATE INDEX IF NOT EXISTS idx_loginlogs_fp ON login_logs(fingerprint)",
  // Push + misc lookups.
  "CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_channel_followers_owner ON channel_followers(channel_owner_id)",
];

async function gate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return { err: json({ ok: false, error: 'Not signed in' }, 401) };
  if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return { err: json({ ok: false, error: 'Owner only' }, 403) };
  return { user };
}

// Two naming conventions ended up creating the same index twice on the same
// column — idx_login_logs_user and idx_loginlogs_user, and so on. A duplicate
// index buys nothing on reads and costs every write, since each INSERT and
// UPDATE has to maintain all of them. These are the older-named copies; the
// survivor in each pair is the one INDEXES above still creates.
const DUPLICATE_INDEXES = [
  'idx_loginlogs_user',
  'idx_loginlogs_ip',
  'idx_loginlogs_fp',
  'idx_music_tracks_owner',
  'idx_post_comments',
  'idx_user_follows_user',
  'idx_users_nick',
];

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    let created = 0, skipped = 0;
    const errors = [];
    for (const stmt of INDEXES) {
      try {
        await env.DB.prepare(stmt).run();
        created++;
      } catch (e) {
        skipped++;
        errors.push(stmt.match(/idx_[a-z_]+/)[0]);
      }
    }

    // Clear out the redundant copies while we're here.
    let dropped = 0;
    for (const name of DUPLICATE_INDEXES) {
      try { await env.DB.prepare('DROP INDEX IF EXISTS ' + name).run(); dropped++; } catch (e) { /* fine */ }
    }
    // ANALYZE lets SQLite pick the new indexes optimally.
    await env.DB.prepare('ANALYZE').run().catch(() => {});
    return json({ ok: true, created, skipped, dropped_duplicates: dropped, total: INDEXES.length, skipped_names: errors });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    const { results } = await env.DB.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY tbl_name"
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, indexes: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

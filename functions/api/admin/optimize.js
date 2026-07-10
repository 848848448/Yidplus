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
  "CREATE INDEX IF NOT EXISTS idx_shorts_owner_created ON shorts(owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_shorts_created ON shorts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_music_owner ON music_tracks(owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id)",
  // Social graph.
  "CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows(follower_id)",
  "CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id)",
  "CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks(blocker_id)",
  "CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_id)",
  // Comments.
  "CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)",
  "CREATE INDEX IF NOT EXISTS idx_comments_short ON comments(short_id)",
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
    // ANALYZE lets SQLite pick the new indexes optimally.
    await env.DB.prepare('ANALYZE').run().catch(() => {});
    return json({ ok: true, created, skipped, total: INDEXES.length, skipped_names: errors });
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

// functions/api/_scheduled.js
// Lazy "cron": activates any due scheduled broadcasts. Called from the
// frequently-hit /settings GET, so a scheduled broadcast goes live the moment
// the next person loads any page — no Cloudflare Cron Trigger required.
import { sendWebPush } from './_webpush.js';

let _lastRun = 0;

export async function ensureScheduledTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
       id TEXT PRIMARY KEY,
       text TEXT,
       push INTEGER DEFAULT 0,
       scheduled_for TEXT,
       sender_email TEXT,
       created_at TEXT,
       sent INTEGER DEFAULT 0
     )`
  ).run().catch(() => {});
}

export async function activateDueScheduledBroadcasts(env) {
  // Throttle: at most once every 30s per warm instance, so we don't run this on
  // every single request.
  const now = Date.now();
  if (now - _lastRun < 30000) return;
  _lastRun = now;

  try {
    const nowIso = new Date().toISOString();
    const { results: due } = await env.DB.prepare(
      'SELECT id, text, push, sender_email FROM scheduled_broadcasts WHERE sent = 0 AND scheduled_for <= ? LIMIT 10'
    ).bind(nowIso).all().catch(() => ({ results: [] }));

    for (const b of due) {
      // Publish the in-app broadcast
      await env.DB.prepare(
        'INSERT INTO broadcasts (id, text, sender_email, created_at) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), b.text, b.sender_email || 'system', nowIso).run().catch(() => {});
      await env.DB.prepare('UPDATE scheduled_broadcasts SET sent = 1 WHERE id = ?').bind(b.id).run().catch(() => {});

      // Optional push blast
      if (b.push) {
        const { results: subs } = await env.DB.prepare(
          'SELECT endpoint, p256dh, auth FROM push_subscriptions'
        ).all().catch(() => ({ results: [] }));
        const payload = { title: 'YID PLUS', body: b.text, icon: '/images/logo.png', badge: '/images/logo.png', url: '/chat', tag: 'yidplus-broadcast' };
        for (const s of subs) {
          try { await sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, env); } catch (e) {}
        }
      }
    }
  } catch (e) { /* never let scheduling break the caller */ }
}

// functions/api/admin/diagnostics.js
// GET /api/admin/diagnostics -> a whole-site self-check. Owner / co-owner only.
//
// Runs a battery of checks across configuration, storage, the database schema
// and the actual data, and returns a flat list of findings the Health Check
// panel renders. Every check is defensive: a check that can't run (e.g. a
// table doesn't exist yet) is reported as 'skip', never as a false failure.
//
// status: 'ok' | 'warn' | 'fail' | 'skip'

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const checks = [];
    const add = (category, label, status, detail, fix) =>
      checks.push({ category, label, status, detail: detail || '', fix: fix || '' });

    const has = (v) => typeof v === 'string' ? v.trim().length > 0 : !!v;

    /* ── CONFIGURATION / SECRETS ─────────────────────────────── */
    add('Configuration', 'Database (D1) connected', env.DB ? 'ok' : 'fail',
      env.DB ? 'The main database binding is present.' : 'The DB binding is missing — nothing will work.',
      env.DB ? '' : 'Bind the D1 database as DB in the Pages project settings.');

    add('Configuration', 'Media storage (R2)', env.MY_BUCKET ? 'ok' : 'fail',
      env.MY_BUCKET ? 'The R2 bucket for uploads is connected.' : 'No R2 bucket — image/voice/media uploads will fail.',
      env.MY_BUCKET ? '' : 'Bind your R2 bucket as MY_BUCKET in Pages settings.');

    add('Configuration', 'Admin PIN set', has(env.ADMIN_PIN) ? 'ok' : 'fail',
      has(env.ADMIN_PIN) ? 'The second-factor admin PIN is configured.' : 'No ADMIN_PIN — the admin gate cannot be unlocked.',
      has(env.ADMIN_PIN) ? '' : 'Add an ADMIN_PIN secret in Pages settings.');

    add('Configuration', 'Owner email set', has(env.OWNER_EMAIL) ? 'ok' : 'fail',
      has(env.OWNER_EMAIL) ? 'Ownership is configured.' : 'No OWNER_EMAIL — owner-only powers can\'t be granted.',
      has(env.OWNER_EMAIL) ? '' : 'Add an OWNER_EMAIL secret in Pages settings.');

    const vapidOk = has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY);
    add('Configuration', 'Push notifications (VAPID)', vapidOk ? 'ok' : 'warn',
      vapidOk ? 'Push keys are configured — notifications and attack alerts can be sent.'
              : 'VAPID keys missing — push notifications AND the attack alerts to your phone will not send.',
      vapidOk ? '' : 'Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets.');

    const resendOk = has(env.RESEND_API_KEY) && has(env.RESEND_FROM_EMAIL);
    add('Configuration', 'Email sending (Resend)', resendOk ? 'ok' : 'warn',
      resendOk ? 'Email is configured — verification, password resets and blasts can send.'
               : (has(env.RESEND_API_KEY) ? 'RESEND_FROM_EMAIL is missing — emails will fail to send.'
                                          : 'RESEND_API_KEY missing — no email (verification, password reset) will send.'),
      resendOk ? '' : 'Add RESEND_API_KEY and RESEND_FROM_EMAIL secrets.');

    const googleOk = has(env.GOOGLE_CLIENT_ID) && has(env.GOOGLE_CLIENT_SECRET);
    add('Configuration', 'Google sign-in', googleOk ? 'ok' : 'warn',
      googleOk ? 'Google login is configured.' : 'Google keys missing — the "Sign in with Google" button will not work.',
      googleOk ? '' : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.');

    add('Configuration', 'Telegram bridge', has(env.TELEGRAM_BOT_TOKEN) ? 'ok' : 'skip',
      has(env.TELEGRAM_BOT_TOKEN) ? 'Telegram bot token is set.' : 'No Telegram token — Telegram features are off (fine if unused).',
      '');

    /* ── SETTINGS SANITY ─────────────────────────────────────── */
    const setting = async (key) => {
      const r = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first().catch(() => null);
      return r ? r.value : null;
    };

    const emailVerifyOn = (await setting('require_email_verify')) === 'true';
    if (emailVerifyOn && !resendOk) {
      add('Settings', 'Email verification vs. email sending', 'fail',
        'Email verification is REQUIRED but email sending is not configured — new users get locked out because the verification email can never arrive.',
        'Either configure Resend, or turn off "require email verification".');
    } else {
      add('Settings', 'Email verification consistency', 'ok',
        emailVerifyOn ? 'Verification is required and email is configured.' : 'Verification is optional.');
    }

    const maint = (await setting('maintenance_mode')) === 'true';
    add('Settings', 'Maintenance mode', maint ? 'warn' : 'ok',
      maint ? 'Maintenance mode is currently ON — regular users are locked out right now.' : 'Site is live.',
      maint ? 'Turn off Maintenance mode when you\'re ready to reopen.' : '');

    /* ── STORAGE REACHABLE ───────────────────────────────────── */
    if (env.MY_BUCKET) {
      try {
        await env.MY_BUCKET.list({ limit: 1 });
        add('Storage', 'R2 read test', 'ok', 'Successfully listed the media bucket.');
      } catch (e) {
        add('Storage', 'R2 read test', 'fail', 'Could not read the media bucket: ' + e.message,
          'Check the R2 binding and bucket permissions.');
      }
    }

    /* ── DATABASE SCHEMA ─────────────────────────────────────── */
    let existing = new Set();
    try {
      const { results } = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all();
      (results || []).forEach((r) => existing.add(r.name));
    } catch (e) { /* leave empty; core checks below will flag */ }

    const coreTables = ['users', 'sessions', 'posts', 'messages', 'rooms',
      'app_settings', 'channels', 'shorts', 'statuses'];
    const missingCore = coreTables.filter((t) => !existing.has(t));
    add('Database', 'Core tables present', missingCore.length ? 'fail' : 'ok',
      missingCore.length ? 'Missing core tables: ' + missingCore.join(', ') + ' — the matching features are broken.'
                         : 'All core tables exist.',
      missingCore.length ? 'These tables should be created by the app\'s schema — a deploy/migration may be incomplete.' : '');

    /* ── DATA INTEGRITY (best-effort; skip on error) ─────────── */
    const countQuery = async (category, label, sql, warnAtOne, fixText) => {
      try {
        const r = await env.DB.prepare(sql).first();
        const n = r ? (r.c || 0) : 0;
        if (n > 0) {
          add(category, label, warnAtOne ? 'warn' : 'fail', String(n) + ' found.', fixText);
        } else {
          add(category, label, 'ok', 'None found.');
        }
      } catch (e) {
        add(category, label, 'skip', 'Check could not run (table/column not present).');
      }
    };

    await countQuery('Data', 'Orphaned login sessions',
      'SELECT COUNT(*) AS c FROM sessions WHERE user_id NOT IN (SELECT id FROM users)',
      true, 'Harmless but messy — these are sessions for deleted users. Can be cleared safely.');

    await countQuery('Data', 'Orphaned push subscriptions',
      'SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id NOT IN (SELECT id FROM users)',
      true, 'Push targets for deleted users — safe to clear.');

    await countQuery('Data', 'Comments on missing posts',
      'SELECT COUNT(*) AS c FROM post_comments WHERE post_id NOT IN (SELECT id FROM posts)',
      true, 'Comments whose post was deleted — safe to clear.');

    await countQuery('Data', 'Messages in missing rooms',
      'SELECT COUNT(*) AS c FROM messages WHERE room_id NOT IN (SELECT id FROM rooms)',
      true, 'Chat messages whose room was deleted — safe to clear.');

    await countQuery('Data', 'Duplicate account emails',
      "SELECT COUNT(*) AS c FROM (SELECT lower(email) e FROM users WHERE email IS NOT NULL AND email != '' GROUP BY lower(email) HAVING COUNT(*) > 1)",
      false, 'Two accounts share an email — this can cause login confusion. Merge or remove one.');

    await countQuery('Data', 'Accounts with no email',
      "SELECT COUNT(*) AS c FROM users WHERE email IS NULL OR email = ''",
      true, 'Accounts missing an email address.');

    /* ── OWNER PUSH READINESS (ties into attack alerts) ──────── */
    try {
      const emails = [env.OWNER_EMAIL, 'jmittelman2@gmail.com'].filter(Boolean).map((e) => e.toLowerCase());
      const ph = emails.map(() => '?').join(',');
      const owners = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) IN (${ph})`).bind(...emails).all();
      const ids = (owners.results || []).map((r) => r.id);
      if (ids.length) {
        const iph = ids.map(() => '?').join(',');
        const sub = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id IN (${iph})`
        ).bind(...ids).first().catch(() => ({ c: 0 }));
        const n = sub ? (sub.c || 0) : 0;
        add('Alerts', 'Your phone is subscribed for alerts', n > 0 ? 'ok' : 'warn',
          n > 0 ? (n + ' device(s) will receive attack alerts.')
                : 'No owner device is subscribed — attack alerts have nowhere to go.',
          n > 0 ? '' : 'Open the app on your phone and enable notifications, then use "Send test" in the Attacks panel.');
      }
    } catch (e) { /* skip silently */ }

    const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
    checks.forEach((c) => { summary[c.status] = (summary[c.status] || 0) + 1; });

    return json({ ok: true, checks, summary, generated_at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

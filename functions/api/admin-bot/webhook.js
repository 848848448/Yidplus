// functions/api/admin-bot/webhook.js
// The admin activity bot's webhook. Its only job: when you message the bot
// (e.g. /start), remember the chat it should send notifications to.
import { json, corsHeaders, getAdminBot } from '../_helpers.js';

async function saveSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, value).run();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token } = await getAdminBot(env);
    // Verify the secret so only Telegram can post here.
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    let expected = '';
    try {
      const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'admin_bot_webhook_secret'").first();
      expected = (r && r.value) || '';
    } catch (e) {}
    if (expected && secret !== expected) return new Response('Unauthorized', { status: 401 });

    const update = await request.json().catch(() => ({}));
    const msg = update.message || update.edited_message || update.channel_post;
    if (msg && msg.chat && msg.chat.id != null) {
      const chatId = String(msg.chat.id);
      await saveSetting(env, 'admin_bot_chat_id', chatId);
      const text = (msg.text || '').trim();

      // Only act on commands from the linked owner chat.
      let linked = '';
      try {
        const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'admin_bot_chat_id'").first();
        linked = (r && r.value) || chatId;
      } catch (e) { linked = chatId; }

      if (token && text) {
        const reply = (t) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: msg.chat.id, text: String(t).slice(0, 3900), parse_mode: 'HTML', disable_web_page_preview: true }),
        }).catch(() => {});
        const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

        if (/^\/(start|hi|hello|connect)/i.test(text)) {
          await reply('✅ Connected! You will get YID PLUS activity here.\n\nCommands:\n/users — latest people who signed up\n/allusers — everyone (up to 100)\n/stats — site totals\n/reports — open reports\n/help — this list');
        } else if (/^\/help/i.test(text)) {
          await reply('Commands:\n/users — latest sign-ups\n/allusers — everyone (up to 100)\n/stats — site totals\n/reports — open reports');
        } else if (/^\/(users|allusers)/i.test(text)) {
          const all = /^\/allusers/i.test(text);
          const lim = all ? 100 : 20;
          const { results } = await env.DB.prepare(
            'SELECT nickname, email, created_at, role, blocked FROM users ORDER BY created_at DESC LIMIT ?'
          ).bind(lim).all().catch(() => ({ results: [] }));
          const cntRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first().catch(() => ({ c: 0 }));
          if (!results || !results.length) { await reply('No users found.'); }
          else {
            let out = '👥 <b>' + (all ? 'All users' : 'Latest sign-ups') + '</b> (' + (cntRow.c || results.length) + ' total)\n\n';
            for (const u of results) {
              const when = u.created_at ? String(u.created_at).slice(0, 10) : '';
              out += '• <b>' + esc(u.nickname || '?') + '</b>' + (u.blocked ? ' 🚫' : '') + (u.role && u.role !== 'member' ? ' [' + esc(u.role) + ']' : '') + '\n  ' + esc(u.email || '') + (when ? ' · ' + when : '') + '\n';
            }
            await reply(out);
          }
        } else if (/^\/stats/i.test(text)) {
          const q = async (sql) => { try { const r = await env.DB.prepare(sql).first(); return (r && r.c) || 0; } catch (e) { return '?'; } };
          const users = await q('SELECT COUNT(*) AS c FROM users');
          const posts = await q('SELECT COUNT(*) AS c FROM posts');
          const shorts = await q('SELECT COUNT(*) AS c FROM shorts');
          const reports = await q("SELECT COUNT(*) AS c FROM reports WHERE resolved = 0");
          const today = await q("SELECT COUNT(*) AS c FROM users WHERE created_at >= date('now')");
          await reply('📊 <b>YID PLUS stats</b>\n👥 Users: ' + users + ' (' + today + ' today)\n📝 Posts: ' + posts + '\n🎬 Shorts: ' + shorts + '\n🚩 Open reports: ' + reports);
        } else if (/^\/reports/i.test(text)) {
          const { results } = await env.DB.prepare(
            'SELECT reported_nick, reason, created_at FROM reports WHERE resolved = 0 ORDER BY created_at DESC LIMIT 20'
          ).all().catch(() => ({ results: [] }));
          if (!results || !results.length) { await reply('✅ No open reports.'); }
          else {
            let out = '🚩 <b>Open reports</b> (' + results.length + ')\n\n';
            for (const r of results) out += '• Against <b>' + esc(r.reported_nick || '?') + '</b>: ' + esc(r.reason || '') + '\n';
            await reply(out);
          }
        } else if (/^\//.test(text)) {
          await reply('Unknown command. Try /help');
        }
      }
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: true }); // always 200 to Telegram
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

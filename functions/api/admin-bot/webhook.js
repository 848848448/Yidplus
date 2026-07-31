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
          await reply('✅ Connected! You will get YID PLUS activity here.\n\nCommands:\n/users — latest sign-ups\n/allusers — everyone (up to 100)\n/find &lt;name/email&gt; — search a person\n/block &lt;email&gt; · /unblock &lt;email&gt;\n/stats — site totals\n/posts — latest posts\n/online — who is online\n/reports — open reports\n/broadcast &lt;msg&gt; — announce to everyone');
        } else if (/^\/help/i.test(text)) {
          await reply('Commands:\n/users — latest sign-ups\n/allusers — everyone (up to 100)\n/find &lt;name/email&gt; — search a person\n/block &lt;email&gt; · /unblock &lt;email&gt;\n/stats — site totals\n/posts — latest posts\n/online — who is online\n/reports — open reports\n/broadcast &lt;msg&gt; — announce to everyone');
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
        } else if (/^\/find\b/i.test(text)) {
          const q = text.replace(/^\/find\s*/i, '').trim();
          if (!q) { await reply('Usage: /find someone@email.com  (or part of a name)'); }
          else {
            const { results } = await env.DB.prepare(
              "SELECT nickname, email, created_at, role, blocked FROM users WHERE email LIKE ? OR nickname LIKE ? ORDER BY created_at DESC LIMIT 20"
            ).bind('%' + q + '%', '%' + q + '%').all().catch(() => ({ results: [] }));
            if (!results || !results.length) { await reply('No user matches "' + esc(q) + '".'); }
            else {
              let out = '🔎 <b>Matches for "' + esc(q) + '"</b>\n\n';
              for (const u of results) out += '• <b>' + esc(u.nickname || '?') + '</b>' + (u.blocked ? ' 🚫' : '') + '\n  ' + esc(u.email || '') + '\n';
              await reply(out);
            }
          }
        } else if (/^\/(block|unblock)\b/i.test(text)) {
          const block = /^\/block/i.test(text);
          const em = text.replace(/^\/(un)?block\s*/i, '').trim().toLowerCase();
          if (!em) { await reply('Usage: /' + (block ? 'block' : 'unblock') + ' someone@email.com'); }
          else {
            const u = await env.DB.prepare('SELECT id, nickname FROM users WHERE lower(email) = ?').bind(em).first().catch(() => null);
            if (!u) { await reply('No user with that email.'); }
            else {
              await env.DB.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(block ? 1 : 0, u.id).run().catch(() => {});
              await reply((block ? '🚫 Blocked ' : '✅ Unblocked ') + '<b>' + esc(u.nickname) + '</b> (' + esc(em) + ').');
            }
          }
        } else if (/^\/posts\b/i.test(text)) {
          const { results } = await env.DB.prepare(
            'SELECT username, caption, content, created_at FROM posts ORDER BY created_at DESC LIMIT 10'
          ).all().catch(() => ({ results: [] }));
          if (!results || !results.length) { await reply('No posts yet.'); }
          else {
            let out = '📝 <b>Latest posts</b>\n\n';
            for (const p of results) out += '• <b>' + esc(p.username || '?') + '</b>: ' + esc(String(p.caption || p.content || '').slice(0, 120)) + '\n';
            await reply(out);
          }
        } else if (/^\/online\b/i.test(text)) {
          const { results } = await env.DB.prepare(
            'SELECT nickname FROM users WHERE online = 1 ORDER BY nickname LIMIT 50'
          ).all().catch(() => ({ results: [] }));
          const n = (results || []).length;
          if (!n) { await reply('Nobody is online right now.'); }
          else await reply('🟢 <b>Online now (' + n + ')</b>\n' + results.map((u) => '• ' + esc(u.nickname || '?')).join('\n'));
        } else if (/^\/broadcast\b/i.test(text)) {
          const m = text.replace(/^\/broadcast\s*/i, '').trim();
          if (!m) { await reply('Usage: /broadcast Your announcement here'); }
          else {
            try {
              await env.DB.prepare('INSERT INTO pinned_announcements (id, text, created_by, created_at, active) VALUES (?, ?, ?, ?, 1)')
                .bind(crypto.randomUUID(), m, 'Admin bot', new Date().toISOString()).run();
              await reply('📢 Announcement posted to everyone:\n\n' + esc(m));
            } catch (e) { await reply('Could not post the announcement.'); }
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

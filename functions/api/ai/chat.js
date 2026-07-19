// functions/api/ai/chat.js
// YID PLUS AI — a chat assistant for the community.
//   GET  /api/ai/chat            -> this user's conversation history
//   POST /api/ai/chat { message } -> send a message, get the AI's reply
//   DELETE /api/ai/chat          -> clear this user's conversation
//
// Powered by Claude (Anthropic). Requires ANTHROPIC_API_KEY as a Pages secret.
// The model is overridable via the AI_MODEL secret so it can be changed
// without a code deploy. Rate-limited per user to keep costs sane.

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

let _ready = null;
async function ensureTable(env) {
  if (_ready) return _ready;
  _ready = (async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ai_messages (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         role TEXT NOT NULL,
         content TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`
    ).run().catch(() => {});
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_ai_user_time ON ai_messages(user_id, created_at)'
    ).run().catch(() => {});
  })();
  return _ready;
}

// The assistant's persona. Kept in one place so it's easy to tune.
function systemPrompt(user) {
  const name = (user && user.nickname) ? user.nickname : '';
  return [
    'You are YID PLUS AI, the helpful assistant built into YID PLUS — a social platform for a Yiddish-speaking (Chassidish/Heimish) Jewish community.',
    'Reply in Yiddish by default, in the warm, natural Yiddish this community actually speaks. If the user writes in another language, you may answer in that language.',
    'Be genuinely helpful, friendly, concise and clear. You can help with questions, writing, explanations, ideas, translations, planning, and general knowledge.',
    'Respect the community\'s religious values and sensibilities. Avoid content that is inappropriate, disrespectful of Yiddishkeit, or unsuitable for a frum audience. If asked for a psak halacha or a serious halachic/medical/legal ruling, gently suggest asking a qualified Rav or professional.',
    'You are a chat assistant inside an app — you cannot change the website, access accounts, or perform actions outside this conversation. If asked to do something you can\'t, say so kindly and offer what you can do.',
    name ? ('You are speaking with ' + name + '.') : '',
  ].filter(Boolean).join('\n');
}

// GET → history
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);
    const { results } = await env.DB.prepare(
      'SELECT role, content, created_at FROM ai_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 200'
    ).bind(user.id).all();
    return json({ ok: true, messages: results || [], configured: !!env.ANTHROPIC_API_KEY });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// POST → send a message, get a reply
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);

    const body = await request.json().catch(() => ({}));
    const message = (body.message || '').toString().trim();
    if (!message) return json({ ok: false, error: 'Empty message' }, 400);
    if (message.length > 4000) return json({ ok: false, error: 'Message too long (max 4000 characters).' }, 400);

    if (!env.ANTHROPIC_API_KEY) {
      return json({ ok: false, error: 'not_configured',
        message: 'YID PLUS AI is not set up yet. The site owner needs to add an ANTHROPIC_API_KEY.' }, 503);
    }

    // ── Rate limit: cap messages per user per hour to control cost/abuse ──
    const HOURLY_CAP = 40;
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM ai_messages WHERE user_id = ? AND role = 'user' AND created_at > datetime('now','-1 hours')"
    ).bind(user.id).first().catch(() => ({ c: 0 }));
    if ((recent?.c || 0) >= HOURLY_CAP) {
      return json({ ok: false, error: 'rate_limited',
        message: 'You\'ve reached the hourly limit. Please try again a little later.' }, 429);
    }

    // ── Build context from recent history (last ~20 turns) ──
    const hist = await env.DB.prepare(
      'SELECT role, content FROM ai_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(user.id).all().catch(() => ({ results: [] }));
    const history = (hist.results || []).reverse();

    const messages = history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    messages.push({ role: 'user', content: message });

    const model = env.AI_MODEL || 'claude-sonnet-5';

    let reply = '';
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt(user),
          messages,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return json({ ok: false, error: 'ai_error',
          message: 'The AI service returned an error (' + resp.status + '). Please try again.',
          detail: errText.slice(0, 300) }, 502);
      }

      const data = await resp.json();
      reply = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    } catch (e) {
      return json({ ok: false, error: 'ai_unreachable',
        message: 'Could not reach the AI service. Please try again.' }, 502);
    }

    if (!reply) reply = 'איך האב נישט געקענט ענטפערן דערויף. פרוביר נאכאמאל.';

    // ── Persist both turns ──
    const now = new Date();
    await env.DB.prepare(
      'INSERT INTO ai_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, 'user', message, now.toISOString()).run().catch(() => {});
    await env.DB.prepare(
      'INSERT INTO ai_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, 'assistant', reply, new Date(now.getTime() + 1).toISOString()).run().catch(() => {});

    return json({ ok: true, reply });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// DELETE → clear this user's conversation
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);
    await env.DB.prepare('DELETE FROM ai_messages WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

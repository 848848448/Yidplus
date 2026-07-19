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

// Read the owner-configured AI settings from app_settings (applies to all).
async function readAiSettings(env) {
  const keys = ['ai_enabled', 'ai_name', 'ai_instructions', 'ai_welcome', 'ai_hourly_limit'];
  const ph = keys.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ph})`
  ).bind(...keys).all().catch(() => ({ results: [] }));
  const m = {};
  (results || []).forEach((r) => { m[r.key] = r.value; });
  return {
    enabled: m.ai_enabled !== 'false',
    name: m.ai_name || 'YID PLUS AI',
    instructions: m.ai_instructions || '',
    welcome: m.ai_welcome || '',
    hourly_limit: parseInt(m.ai_hourly_limit || '40', 10) || 40,
  };
}

// The assistant's persona. A fixed safety base (always enforced) plus whatever
// custom behaviour the owner configured in the admin panel.
function systemPrompt(user, settings) {
  const name = (user && user.nickname) ? user.nickname : '';
  const aiName = (settings && settings.name) || 'YID PLUS AI';
  const base = [
    'You are ' + aiName + ', the assistant built into YID PLUS — a social platform for a Yiddish-speaking (Chassidish/Heimish) Jewish community.',
    'Reply in Yiddish by default, in the warm, natural Yiddish this community actually speaks. If the user clearly writes in another language, you may answer in that language.',
    'Always keep content appropriate and respectful of Yiddishkeit and a frum audience. Never produce content that is inappropriate for this community. For a serious psak halacha or a medical/legal ruling, gently suggest asking a qualified Rav or professional.',
    'You are a chat assistant inside an app — you cannot change the website, access accounts, or act outside this conversation. If asked to do something you can\'t, say so kindly.',
  ];
  const custom = (settings && settings.instructions && settings.instructions.trim())
    ? ['\nThe site owner has given you these additional instructions on how to behave — follow them as long as they don\'t conflict with keeping content safe and appropriate:\n' + settings.instructions.trim()]
    : ['Be genuinely helpful, friendly, concise and clear. You can help with questions, writing, explanations, ideas, translations and planning.'];
  const who = name ? ['\nYou are speaking with ' + name + '.'] : [];
  return base.concat(custom).concat(who).join('\n');
}

// GET → history
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);
    const settings = await readAiSettings(env);
    const { results } = await env.DB.prepare(
      'SELECT role, content, created_at FROM ai_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 200'
    ).bind(user.id).all();
    return json({
      ok: true,
      messages: results || [],
      configured: !!(env.ANTHROPIC_API_KEY || env.AI),
      enabled: settings.enabled,
      name: settings.name,
      welcome: settings.welcome,
    });
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
    const settings = await readAiSettings(env);

    if (!settings.enabled) {
      return json({ ok: false, error: 'disabled',
        message: 'YID PLUS AI is currently turned off.' }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const message = (body.message || '').toString().trim();
    if (!message) return json({ ok: false, error: 'Empty message' }, 400);
    if (message.length > 4000) return json({ ok: false, error: 'Message too long (max 4000 characters).' }, 400);

    if (!env.ANTHROPIC_API_KEY && !env.AI) {
      return json({ ok: false, error: 'not_configured',
        message: 'YID PLUS AI is not set up yet. The site owner needs to either bind Cloudflare Workers AI (free) or add an ANTHROPIC_API_KEY.' }, 503);
    }

    // ── Rate limit: cap messages per user per hour to control cost/abuse ──
    const HOURLY_CAP = settings.hourly_limit;
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

    const gen = await generateReply(env, systemPrompt(user, settings), messages);
    if (!gen.ok) {
      return json({ ok: false, error: gen.error || 'ai_error',
        message: gen.message || 'The AI service returned an error. Please try again.',
        detail: (gen.detail || '').slice(0, 300) }, gen.status || 502);
    }
    let reply = (gen.reply || '').trim();
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

// Generate a reply. Prefers Claude (best, needs a paid ANTHROPIC_API_KEY);
// otherwise falls back to Cloudflare Workers AI (free — 10k neurons/day, just
// needs the AI binding, no external account). Returns { ok, reply } or
// { ok:false, error, message, status }.
async function generateReply(env, system, messages) {
  // ── Preferred: Claude ──
  if (env.ANTHROPIC_API_KEY) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.AI_MODEL || 'claude-sonnet-5',
          max_tokens: 1024,
          system,
          messages,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { ok: false, error: 'ai_error', status: 502,
          message: 'The AI service returned an error (' + resp.status + ').', detail: errText };
      }
      const data = await resp.json();
      const reply = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { ok: true, reply };
    } catch (e) {
      return { ok: false, error: 'ai_unreachable', status: 502,
        message: 'Could not reach the AI service.' };
    }
  }

  // ── Free fallback: Cloudflare Workers AI ──
  if (env.AI) {
    try {
      const model = env.CF_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
      const out = await env.AI.run(model, {
        messages: [{ role: 'system', content: system }].concat(messages),
        max_tokens: 1024,
      });
      // Workers AI text models return { response: "..." }.
      const reply = (out && (out.response || out.result || '')) || '';
      return { ok: true, reply: String(reply) };
    } catch (e) {
      return { ok: false, error: 'ai_error', status: 502,
        message: 'The free AI model returned an error. It may be busy — please try again.',
        detail: String(e && e.message || e) };
    }
  }

  return { ok: false, error: 'not_configured', status: 503,
    message: 'AI is not configured.' };
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

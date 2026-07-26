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

// Does this message ask for a picture/drawing? (English + Yiddish/Hebrew)
function isImageRequest(msg) {
  var m = (msg || '').toLowerCase();
  if (/\b(draw|sketch|paint|render|generate (an? )?(image|picture|photo)|create (an? )?(image|picture|photo)|make (me )?(an? )?(image|picture|photo|drawing)|picture of|image of|photo of)\b/.test(m)) return true;
  // Yiddish/Hebrew: בילד (picture), צייכן (draw), געמעל, מאל מיר, מאך א בילד
  if (/מאך\s+(מיר\s+)?א\s*בילד|מאכ?\s*מיר\s*א\s*בילד|צייכ[עֶ]?ן|א\s*בילד\s+פֿ?ון|בילד\s+פֿ?ון|געמעל|מאל\s+מיר|קען\s*סט?\s*דו\s*מאכן\s*א\s*בילד/.test(msg || '')) return true;
  return false;
}

// Turn a (usually Yiddish) request into a concise English prompt — image models
// work far better in English. Falls back to the raw text if this call fails.
async function toImagePrompt(env, userMsg) {
  try {
    var out = await env.AI.run(env.CF_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: 'Convert the user\'s image request into ONE concise English image-generation prompt: just a vivid visual description, no preamble, no quotes, under 60 words. Keep it modest and appropriate for a religious Jewish community (no immodest or inappropriate imagery).' },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 120,
    });
    var p = (out && (typeof out.response === 'string' ? out.response : out)) || '';
    p = String(p).trim().replace(/^["']+|["']+$/g, '');
    return p || userMsg;
  } catch (e) { return userMsg; }
}

// Generate an image with FLUX.1 [schnell] and store it in R2, returning its URL.
async function generateImage(env, prompt) {
  var res = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: prompt, steps: 6 });
  var b64 = res && res.image;
  if (!b64) throw new Error('no image returned');
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var key = 'ai-images/' + crypto.randomUUID() + '.jpg';
  await env.MY_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return '/api/media/' + encodeURIComponent(key);
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

    // ── Image request? Generate a picture instead of a text reply. Needs the
    //    Cloudflare Workers AI binding (env.AI). ──
    if (isImageRequest(message)) {
      if (!env.AI) {
        return json({ ok: false, error: 'no_image',
          message: 'בילד-מאכן פֿאדערט די פֿרייע Cloudflare Workers AI — דער אייגנטומער דארף עס אנצינדן.' }, 503);
      }
      try {
        const prompt = await toImagePrompt(env, message);
        const imgUrl = await generateImage(env, prompt);
        const caption = 'אָט איז דיין בילד 🎨';
        const content = caption + '\n[img:' + imgUrl + ']';
        const nowI = new Date();
        await env.DB.prepare('INSERT INTO ai_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), user.id, 'user', message, nowI.toISOString()).run().catch(() => {});
        await env.DB.prepare('INSERT INTO ai_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), user.id, 'assistant', content, new Date(nowI.getTime() + 1).toISOString()).run().catch(() => {});
        return json({ ok: true, reply: caption, image: imgUrl });
      } catch (e) {
        return json({ ok: false, error: 'image_failed',
          message: 'איך האב נישט געקענט מאכן דאס בילד. פרוביר נאכאמאל מיט אן אנדער באשרייבונג.',
          detail: String((e && e.message) || e).slice(0, 200) }, 502);
      }
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
      // Best free-tier Workers AI text model: Llama 3.3 70B (fp8, fast). Far
      // stronger than the old 8B. Overridable via the CF_AI_MODEL secret.
      const model = env.CF_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
      // Guard against a hung inference: if the model doesn't answer in time,
      // fail cleanly with JSON instead of letting the Function hit a platform
      // limit and return a raw 502 page.
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('AI timed out')), 25000));
      const run = env.AI.run(model, {
        messages: [{ role: 'system', content: system }].concat(messages),
        max_tokens: 800,
      });
      const out = await Promise.race([run, timeout]);
      // Workers AI text models return { response: "..." }; be defensive.
      let reply = '';
      if (typeof out === 'string') reply = out;
      else if (out && typeof out.response === 'string') reply = out.response;
      else if (out && out.result && typeof out.result.response === 'string') reply = out.result.response;
      return { ok: true, reply: String(reply || '') };
    } catch (e) {
      return { ok: false, error: 'ai_error', status: 200,
        message: 'The free AI model errored: ' + String((e && e.message) || e) + '. Please try again in a moment.',
        detail: String((e && e.stack) || '') };
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

// functions/api/support-questions.js
// GET    /api/support-questions?screen=login|home  -> list questions for that screen (public — the
//                                                       login screen needs this before anyone signs in)
// POST   /api/support-questions                     -> add a question (owner only)
// PUT    /api/support-questions                      -> edit a question (owner only)
// DELETE /api/support-questions?id=X                 -> remove a question (owner only)
//
// action_type tells the client what happens when the question is tapped:
//   'admin_message'   -> opens a text box, sends to Support Chats as a new ticket
//   'auto_resend'     -> instantly re-sends the verification email, no ticket created
//   'self_block'      -> shows the block-yourself-from-a-feature picker
//   'free_text'       -> "something else" — opens a blank text box

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from './_helpers.js';

const VALID_SCREENS = ['login', 'home'];
const VALID_ACTIONS = ['admin_message', 'auto_resend', 'self_block', 'free_text'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const screen = new URL(request.url).searchParams.get('screen');
    if (!screen || !VALID_SCREENS.includes(screen)) {
      return json({ ok: false, error: 'screen must be login or home' }, 400);
    }
    const { results } = await env.DB.prepare(
      'SELECT id, screen, label, action_type, order_num FROM support_questions WHERE screen = ? ORDER BY order_num ASC, created_at ASC'
    ).bind(screen).all().catch(() => ({ results: [] }));
    return json({ ok: true, questions: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const screen = body.screen;
    const label = (body.label || '').trim();
    const actionType = body.action_type;
    if (!VALID_SCREENS.includes(screen)) return json({ ok: false, error: 'Invalid screen' }, 400);
    if (!label) return json({ ok: false, error: 'label is required' }, 400);
    if (!VALID_ACTIONS.includes(actionType)) return json({ ok: false, error: 'Invalid action_type' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const orderNum = Number.isFinite(body.order_num) ? body.order_num : 999;

    await env.DB.prepare(
      'INSERT INTO support_questions (id, screen, label, action_type, order_num, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, screen, label, actionType, orderNum, now).run();

    return json({ ok: true, id }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    const sets = [], params = [];
    if (body.label !== undefined)      { sets.push('label = ?');      params.push(String(body.label).trim()); }
    if (body.action_type !== undefined) {
      if (!VALID_ACTIONS.includes(body.action_type)) return json({ ok: false, error: 'Invalid action_type' }, 400);
      sets.push('action_type = ?'); params.push(body.action_type);
    }
    if (body.order_num !== undefined)  { sets.push('order_num = ?');  params.push(body.order_num); }
    if (!sets.length) return json({ ok: false, error: 'Nothing to update' }, 400);

    params.push(body.id);
    await env.DB.prepare(`UPDATE support_questions SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    await env.DB.prepare('DELETE FROM support_questions WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

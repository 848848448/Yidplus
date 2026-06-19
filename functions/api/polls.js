// functions/api/polls.js
// GET    /api/polls?room_id=xxx       -> list polls in a room (with options + vote counts + my votes)
// GET    /api/polls?id=xxx            -> single poll detail
// POST   /api/polls                   -> create a poll (also creates a chat message of type 'poll')
// PUT    /api/polls                   -> { id, vote: [option_ids] } cast/change vote
//                                          OR { id, add_option: text } suggest a new option
//                                          OR { id, close: true } close the poll (creator/admin only)
// DELETE /api/polls?id=xxx            -> delete poll (creator/admin only)

import { json, corsHeaders, requireUser, isAdminRole, canDeleteContent } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function _hydratePoll(env, poll, viewerId) {
  const { results: options } = await env.DB.prepare(
    `SELECT id, text, is_correct, added_by, sort_order FROM poll_options
     WHERE poll_id = ? ORDER BY sort_order ASC`
  ).bind(poll.id).all();

  const { results: voteRows } = await env.DB.prepare(
    `SELECT option_id, user_id, user_nick FROM poll_votes WHERE poll_id = ?`
  ).bind(poll.id).all();

  const totalVoters = new Set(voteRows.map(v => v.user_id)).size;

  const hydratedOptions = options.map(opt => {
    const votesForOption = voteRows.filter(v => v.option_id === opt.id);
    const out = {
      id: opt.id,
      text: opt.text,
      votes: votesForOption.length,
      pct: totalVoters ? Math.round((votesForOption.length / totalVoters) * 100) : 0,
      my_vote: votesForOption.some(v => v.user_id === viewerId),
    };
    // Correct-answer flag is only revealed once the viewer has voted, or the poll is closed —
    // otherwise it would leak the answer before voting (quiz mode).
    if (poll.quiz_mode) {
      const viewerHasVoted = voteRows.some(v => v.user_id === viewerId);
      if (viewerHasVoted || poll.closed) out.is_correct = !!opt.is_correct;
    }
    if (poll.show_who_voted) {
      out.voters = votesForOption.map(v => v.user_nick);
    }
    return out;
  });

  // Auto-close if the duration has elapsed.
  let closed = !!poll.closed;
  if (!closed && poll.closes_at && new Date(poll.closes_at) <= new Date()) {
    closed = true;
    await env.DB.prepare(`UPDATE polls SET closed = 1 WHERE id = ?`).bind(poll.id).run();
  }

  return {
    id: poll.id,
    room_id: poll.room_id,
    message_id: poll.message_id,
    creator_id: poll.creator_id,
    question: poll.question,
    description: poll.description,
    show_who_voted: !!poll.show_who_voted,
    allow_multiple: !!poll.allow_multiple,
    allow_add_options: !!poll.allow_add_options,
    allow_revote: !!poll.allow_revote,
    shuffle_options: !!poll.shuffle_options,
    quiz_mode: !!poll.quiz_mode,
    closes_at: poll.closes_at,
    closed,
    total_voters: totalVoters,
    created_at: poll.created_at,
    options: hydratedOptions,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    const id = url.searchParams.get('id');

    if (id) {
      const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(id).first();
      if (!poll) return json({ ok: false, error: 'Poll not found' }, 404);
      const hydrated = await _hydratePoll(env, poll, user ? user.id : null);
      return json({ ok: true, poll: hydrated });
    }

    if (!roomId) return json({ ok: false, error: 'room_id or id is required' }, 400);

    const { results: polls } = await env.DB.prepare(
      `SELECT * FROM polls WHERE room_id = ? ORDER BY created_at DESC LIMIT 50`
    ).bind(roomId).all();

    const hydrated = [];
    for (const p of polls) hydrated.push(await _hydratePoll(env, p, user ? user.id : null));

    return json({ ok: true, polls: hydrated });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const roomId = body.room_id;
    const question = (body.question || '').trim();
    const optionsIn = Array.isArray(body.options) ? body.options.map(o => (o || '').trim()).filter(Boolean) : [];

    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);
    if (!question) return json({ ok: false, error: 'question is required' }, 400);
    if (optionsIn.length < 2) return json({ ok: false, error: 'At least 2 options are required' }, 400);
    if (optionsIn.length > 12) return json({ ok: false, error: 'Maximum 12 options allowed' }, 400);

    const correctSet = new Set(Array.isArray(body.correct_indices) ? body.correct_indices : []);

    const pollId = crypto.randomUUID();
    const now = new Date().toISOString();
    const closesAt = (body.duration_minutes && Number(body.duration_minutes) > 0)
      ? new Date(Date.now() + Number(body.duration_minutes) * 60000).toISOString()
      : null;

    // Create the chat message first so the poll can reference it.
    const messageId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
       VALUES (?, ?, ?, ?, 'poll', ?, ?, 0)`
    ).bind(messageId, roomId, user.id, user.nickname || '', pollId, now).run();

    await env.DB.prepare(
      `INSERT INTO polls
        (id, room_id, message_id, creator_id, question, description,
         show_who_voted, allow_multiple, allow_add_options, allow_revote,
         shuffle_options, quiz_mode, closes_at, closed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      pollId, roomId, messageId, user.id, question, body.description || null,
      body.show_who_voted ? 1 : 0,
      body.allow_multiple ? 1 : 0,
      body.allow_add_options ? 1 : 0,
      body.allow_revote !== false ? 1 : 0,   // defaults to true
      body.shuffle_options ? 1 : 0,
      body.quiz_mode ? 1 : 0,
      closesAt, now
    ).run();

    for (let i = 0; i < optionsIn.length; i++) {
      await env.DB.prepare(
        `INSERT INTO poll_options (id, poll_id, text, is_correct, added_by, sort_order, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      ).bind(crypto.randomUUID(), pollId, optionsIn[i], correctSet.has(i) ? 1 : 0, i, now).run();
    }

    const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(pollId).first();
    const hydrated = await _hydratePoll(env, poll, user.id);

    return json({ ok: true, poll: hydrated, message_id: messageId }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { id } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(id).first();
    if (!poll) return json({ ok: false, error: 'Poll not found' }, 404);

    // ── Close poll ──
    if (body.close) {
      if (!canDeleteContent(user, poll.creator_id, env.OWNER_EMAIL)) {
        return json({ ok: false, error: 'Only the poll creator or an admin can close it' }, 403);
      }
      await env.DB.prepare(`UPDATE polls SET closed = 1 WHERE id = ?`).bind(id).run();
      const updated = await _hydratePoll(env, { ...poll, closed: 1 }, user.id);
      return json({ ok: true, poll: updated });
    }

    // ── Add a suggested option ──
    if (typeof body.add_option === 'string') {
      if (!poll.allow_add_options) return json({ ok: false, error: 'This poll does not allow adding options' }, 403);
      if (poll.closed) return json({ ok: false, error: 'This poll is closed' }, 403);
      const text = body.add_option.trim();
      if (!text) return json({ ok: false, error: 'Option text is required' }, 400);

      const maxOrderRow = await env.DB.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM poll_options WHERE poll_id = ?`
      ).bind(id).first();

      await env.DB.prepare(
        `INSERT INTO poll_options (id, poll_id, text, is_correct, added_by, sort_order, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`
      ).bind(crypto.randomUUID(), id, text, user.id, (maxOrderRow.m || 0) + 1, new Date().toISOString()).run();

      const updated = await _hydratePoll(env, poll, user.id);
      return json({ ok: true, poll: updated });
    }

    // ── Cast / change vote ──
    if (Array.isArray(body.vote)) {
      if (poll.closed) return json({ ok: false, error: 'This poll is closed' }, 403);

      const existingVotes = await env.DB.prepare(
        `SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?`
      ).bind(id, user.id).all();

      const hasVoted = existingVotes.results.length > 0;
      if (hasVoted && !poll.allow_revote) {
        return json({ ok: false, error: 'Revoting is not allowed on this poll' }, 403);
      }

      const optionIds = body.vote.slice(0, poll.allow_multiple ? 12 : 1);
      if (!optionIds.length) return json({ ok: false, error: 'No option selected' }, 400);

      // Always clear previous votes first (covers both revote and multi-select changes).
      await env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?`).bind(id, user.id).run();

      const now = new Date().toISOString();
      for (const optId of optionIds) {
        await env.DB.prepare(
          `INSERT INTO poll_votes (poll_id, option_id, user_id, user_nick, created_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(id, optId, user.id, user.nickname || '', now).run();
      }

      const updated = await _hydratePoll(env, poll, user.id);
      return json({ ok: true, poll: updated });
    }

    return json({ ok: false, error: 'No valid action specified' }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const poll = await env.DB.prepare(`SELECT creator_id, message_id FROM polls WHERE id = ?`).bind(id).first();
    if (!poll) return json({ ok: false, error: 'Poll not found' }, 404);

    if (!canDeleteContent(user, poll.creator_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    await env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM poll_options WHERE poll_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM polls WHERE id = ?`).bind(id).run();
    if (poll.message_id) {
      await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(poll.message_id).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

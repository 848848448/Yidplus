import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

// Bookmarking a message_id you're not actually allowed to see would let it
// resurface (with full text/media) in your own bookmarks list forever —
// this is the same room-access rule chat.js applies when reading messages.
async function canAccessMessage(env, messageId, userId) {
  const message=await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(messageId).first();
  if (!message || message.view_once || message.hidden || (message.expires_at && Date.parse(message.expires_at)<=Date.now()) || (message.scheduled_for && Date.parse(message.scheduled_for)>Date.now() && message.sender_id!==userId)) return false;
  const room = await env.DB.prepare('SELECT id,type,visibility FROM rooms WHERE id=?').bind(message.room_id).first();
  if (!room) return false;
  const isMember = await env.DB.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(room.id, userId).first().catch(() => null);
  if (isMember) return true;
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(userId).first().catch(() => null);
  if (room.type === 'private') return isOwnerOrCoOwner(user, env.OWNER_EMAIL);
  if (room.type === 'group' && room.visibility === 'private') return isAdminRole(user, env.OWNER_EMAIL);
  return room.visibility==='public'; // public group/channel
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const owner=isOwnerOrCoOwner(user,env.OWNER_EMAIL)?1:0,admin=isAdminRole(user,env.OWNER_EMAIL)?1:0;
    const now=new Date().toISOString();
    const query=`SELECT b.*,m.room_id AS room_id,m.text,m.type,m.sender_nick,m.created_at AS msg_time,m.media_key
       FROM message_bookmarks b JOIN messages m ON m.id=b.message_id JOIN rooms r ON r.id=m.room_id
       WHERE b.user_id=? AND COALESCE(m.view_once,0)=0 AND COALESCE(m.hidden,0)=0
       AND (m.expires_at IS NULL OR m.expires_at>?) AND (m.scheduled_for IS NULL OR m.scheduled_for<=? OR m.sender_id=?)
       AND (EXISTS(SELECT 1 FROM room_members rm WHERE rm.room_id=m.room_id AND rm.user_id=?)
         OR (r.type='private' AND ?=1) OR (r.type!='private' AND ?=1)
         OR (r.type!='private' AND r.visibility='public'))
       ORDER BY b.created_at DESC LIMIT 100`;
    let results;
    try {({results}=await env.DB.prepare(query).bind(user.id,now,now,user.id,user.id,owner,admin).all());}
    catch(e){if(!/no such column.*hidden/i.test(String(e.message)))throw e;({results}=await env.DB.prepare(query.replace(" AND COALESCE(m.hidden,0)=0", "")).bind(user.id,now,now,user.id,user.id,owner,admin).all());}
    results.forEach(row=>{row.media_url=row.media_key?'/api/media/'+encodeURIComponent(row.media_key):null;});
    return json({ ok: true, bookmarks: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { message_id, room_id } = await request.json();
    if (!message_id) return json({ ok: false, error: 'message_id is required' }, 400);
    if (!(await canAccessMessage(env, message_id, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT OR REPLACE INTO message_bookmarks (id, user_id, message_id, room_id, created_at) VALUES (?,?,?,?,?)'
    ).bind(id,user.id,message_id,(await env.DB.prepare('SELECT room_id FROM messages WHERE id=?').bind(message_id).first()).room_id,new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const msgId = new URL(request.url).searchParams.get('message_id');
    await env.DB.prepare('DELETE FROM message_bookmarks WHERE user_id=? AND message_id=?').bind(user.id, msgId).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

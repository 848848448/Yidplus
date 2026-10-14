import {isAdminRole,isOwnerOrCoOwner} from './_helpers.js';
export async function resolveReportTarget(env,user,body) {
  if(!body || Array.isArray(body) || typeof body!=='object')return null;
  if(typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>200 || (body.details!==undefined && (typeof body.details!=='string' || body.details.length>2000)))return null;
  let messageId=body.message_id || (body.target_type==='message'?body.target_id:null),targetId=body.reported_id || (body.target_type==='channel'?body.target_id:null),roomId=null;
  if(messageId) {
    if(typeof messageId!=='string' || messageId.length>100)return null;
    const message=await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(messageId).first();
    if(!message || (message.expires_at && Date.parse(message.expires_at)<=Date.now()) || (message.scheduled_for && Date.parse(message.scheduled_for)>Date.now() && message.sender_id!==user.id))return null;
    const room=await env.DB.prepare('SELECT id,type,visibility FROM rooms WHERE id=?').bind(message.room_id).first();
    if(!room)return null;
    const moderator=room.type==='private'?isOwnerOrCoOwner(user,env.OWNER_EMAIL):isAdminRole(user,env.OWNER_EMAIL);
    const member=await env.DB.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').bind(room.id,user.id).first();
    if((message.hidden&&!moderator) || (!member&&!moderator&&!(room.type!=='private'&&room.visibility==='public')))return null;
    targetId=message.sender_id;roomId=room.id;
  }
  if(typeof targetId!=='string' || targetId.length>100)return null;
  const target=await env.DB.prepare('SELECT id,nickname FROM users WHERE id=?').bind(targetId).first();
  if(!target)return null;
  return {reported_id:target.id,reported_nick:target.nickname||'',message_id:messageId||null,room_id:roomId,reason:body.reason.trim(),details:body.details||''};
}

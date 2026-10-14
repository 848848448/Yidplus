import { json, requireUser } from '../_helpers.js';
function sameOrigin(request){return request.headers.get('Origin')==='https://yidplus.com';}
export async function onRequestPost({request,env}) {
 if(!sameOrigin(request))return json({ok:false},403);
 const user=await requireUser(request,env);if(!user||user._impersonatorId)return json({ok:false},401);
 try{const {id,token}=await request.json();if(!/^[a-zA-Z0-9_-]{32,64}$/.test(id||'')||typeof token!=='string'||token.length<20||token.length>4096||/[\s\x00-\x1f]/.test(token))return json({ok:false},400);
  const now=new Date().toISOString();
  // A refresh may change either device id or token. Remove only this user's
  // prior id, and bind any token conflict to its newest authenticated owner.
  await env.DB.batch([
   env.DB.prepare('DELETE FROM native_push_devices WHERE id=? AND user_id=?').bind(id,user.id),
   env.DB.prepare('INSERT INTO native_push_devices (id,user_id,token,platform,created_at,updated_at) VALUES (?,?,?,\'android\',?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, id=excluded.id, updated_at=excluded.updated_at').bind(id,user.id,token,now,now)
  ]);return json({ok:true});
 }catch{return json({ok:false,error:'Native notifications are not ready yet'},503);}
}
export async function onRequestDelete({request,env}) {
 if(!sameOrigin(request))return json({ok:false},403);
 const user=await requireUser(request,env);if(!user||user._impersonatorId)return json({ok:false},401);
 try{const {id}=await request.json();if(!/^[a-zA-Z0-9_-]{32,64}$/.test(id||''))return json({ok:false},400);await env.DB.prepare('DELETE FROM native_push_devices WHERE id=? AND user_id=?').bind(id,user.id).run();return json({ok:true});}catch{return json({ok:false},503);}
}

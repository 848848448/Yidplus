import { json, requireUser, generateSessionToken } from '../_helpers.js';
const codeRE = /^[0-9a-f]{64}$/;
const verifierRE = /^[A-Za-z0-9_-]{43}$/;
export async function challengeFor(verifier) {
 const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// The browser's session never enters a URL. Code is single-use and bound to
// an app-generated verifier, so another app claiming the scheme cannot use it.
export async function onRequestPost({request,env}) {
 try {
  if(Number(request.headers.get('Content-Length')||0)>4096)return json({ok:false},413);
  const {code,verifier}=await request.json();
  if(!codeRE.test(code||'')||!verifierRE.test(verifier||''))return json({ok:false,error:'Invalid handoff'},400);
  const challenge=await challengeFor(verifier);
  const claimed=await env.DB.prepare("DELETE FROM login_logs WHERE id=? AND action='native_login_handoff' AND fingerprint=? AND julianday(created_at)>julianday('now','-2 minutes') RETURNING user_id").bind(code,challenge).first();
  if(!claimed)return json({ok:false,error:'Sign-in expired'},401);
  const user=await env.DB.prepare('SELECT blocked FROM users WHERE id=?').bind(claimed.user_id).first();
  if(!user||user.blocked)return json({ok:false},403);
  const session=generateSessionToken();
  await env.DB.prepare('INSERT INTO sessions (id,user_id,created_at) VALUES (?,?,?)').bind(session,claimed.user_id,new Date().toISOString()).run();
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`yp_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}});
 }catch{return json({ok:false,error:'Could not finish sign-in'},503);}
}

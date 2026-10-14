import { requireUser, generateSessionToken } from './api/_helpers.js';
export async function onRequestGet({request,env}) {
 const url=new URL(request.url),challenge=url.searchParams.get('challenge');
 if(!/^[A-Za-z0-9_-]{43}$/.test(challenge||''))return new Response('Invalid sign-in request',{status:400});
 const user=await requireUser(request,env);
 if(!user||user._impersonatorId)return new Response('Please finish signing in and try again.',{status:401});
 const code=generateSessionToken();
 await env.DB.prepare("INSERT INTO login_logs (id,user_id,ip,fingerprint,action,created_at) VALUES (?,?,NULL,?,'native_login_handoff',?)").bind(code,user.id,challenge,new Date().toISOString()).run();
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to YID PLUS</title><style>body{font:18px system-ui;background:#101823;color:#edf3fa;display:grid;min-height:90vh;place-items:center;text-align:center}a{display:inline-block;background:#087c91;color:white;padding:16px 24px;border-radius:12px;text-decoration:none}p{max-width:28em;line-height:1.6}</style></head><body><main><h1>Sign-in complete</h1><p>Return to the YID PLUS app to finish. This link expires in 2 minutes and can be used once.</p><a href="yidplus://auth?code=${code}">Open YID PLUS</a></main></body></html>`,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});
}

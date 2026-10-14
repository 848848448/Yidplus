// FCM HTTP v1 only. Dedicated messaging service-account credential is a
// Cloudflare encrypted secret, never a public config or client bundle.
let cached=null;
const encode=v=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function accessToken(env){
 if(cached&&cached.exp>Date.now()+60000)return cached.value;
 const account=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON||'null');
 if(!account||account.project_id!=='shorts-e05cc'||!account.client_email||!account.private_key)throw Error('Native push not configured');
 const seconds=Math.floor(Date.now()/1000),part=o=>encode(new TextEncoder().encode(JSON.stringify(o)));
 const header=part({alg:'RS256',typ:'JWT'}),claims=part({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:seconds,exp:seconds+3600}),unsigned=header+'.'+claims;
 const pem=account.private_key.replace(/-----[^-]+-----|\s/g,''),bytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned))));
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature})});
 if(!response.ok)throw Error('Native push authorization failed');const result=await response.json();cached={value:result.access_token,exp:Date.now()+Number(result.expires_in||3600)*1000};return cached.value;
}
export function safeNativeTarget(value){try{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x1f]/.test(value))return '/chat';const u=new URL(value,'https://yidplus.com');return ['/chat','/music','/shorts','/admin','/'].includes(u.pathname)?u.pathname+u.search+u.hash:'/chat';}catch{return '/chat';}}
export async function sendNativePush(env,userIds,payload={}){
 if(!env.FCM_SERVICE_ACCOUNT_JSON)return {sent:0,configured:false};
 try{const ids=[...new Set(userIds||[])];if(!ids.length)return {sent:0};const placeholders=ids.map(()=>'?').join(',');
 const {results}=await env.DB.prepare(`SELECT id,token FROM native_push_devices WHERE user_id IN (${placeholders})`).bind(...ids).all();if(!results.length)return {sent:0};
 const token=await accessToken(env);let sent=0;
 for(const device of results){try{const response=await fetch('https://fcm.googleapis.com/v1/projects/shorts-e05cc/messages:send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message:{token:device.token,data:{title:'YID PLUS',body:'You have a new notification',url:safeNativeTarget(payload.url)},android:{priority:'high',ttl:'3600s'}}})});if(response.ok)sent++;else{const error=await response.json().catch(()=>null);if(error?.error?.details?.some(x=>x.errorCode==='UNREGISTERED'))await env.DB.prepare('DELETE FROM native_push_devices WHERE id=? AND token=?').bind(device.id,device.token).run();}}catch{}}
 return {sent,configured:true};}catch{return {sent:0,error:true};}
}

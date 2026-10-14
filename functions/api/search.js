import {json,requireUser} from './_helpers.js';
import {filterChannelContent} from './_content-visibility.js';
const hiddenMissing=e=>/no such column.*hidden/i.test(String(e&&e.message));
export async function onRequestGet({request,env}) {
  try {
    const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,100);
    if(q.length<2)return json({ok:true,posts:[],shorts:[]});
    const user=await requireUser(request,env).catch(()=>null);
    // Literal substring search: user percent/underscore characters are not wildcards.
    const term='%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%';
    let posts,shorts;
    for(const kind of ['posts','shorts']) {
      const owner=kind==='posts'?'user_id':'owner_id';
      const columns=kind==='posts'?'id,user_id,username,caption,created_at':'id,owner_id,caption,created_at';
      const text=kind==='posts'?"(caption LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')":"caption LIKE ? ESCAPE '\\'";
      const values=kind==='posts'?[term,term]:[term];
      const query=hidden=>`SELECT ${columns} FROM ${kind} WHERE ${text} ${hidden?'AND (hidden IS NULL OR hidden=0)':''}
        AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_id=? AND b.blocked_id=${kind}.${owner})
        ORDER BY created_at DESC LIMIT 20`;
      let rows;
      try{rows=await env.DB.prepare(query(true)).bind(...values,user?user.id:'').all();}
      catch(e){if(!hiddenMissing(e))throw e;rows=await env.DB.prepare(query(false)).bind(...values,user?user.id:'').all();}
      const visible=await filterChannelContent(env,rows.results||[],user,owner);
      if(kind==='posts')posts=visible;else shorts=visible;
    }
    return new Response(JSON.stringify({ok:true,posts,shorts}),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}});
  }catch{return json({ok:false,error:'Search unavailable'},503);}
}

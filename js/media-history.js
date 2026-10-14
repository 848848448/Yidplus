/* Paged shared-media browser. Uses the same authorized history endpoint as chat. */
(function(){
  var run=0;
  window._renderInfoTab=function(tab){
    var el=document.getElementById('info-tab-content');if(!el||!CHAT_curRoom)return;
    var room=CHAT_curRoom.id,token=++run,cursor=null,busy=false,seen=new Set(),total=0;
    el.replaceChildren();var grid=document.createElement('div'),status=document.createElement('p'),more=document.createElement('button');
    if(tab==='media')grid.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px';
    status.style.cssText='color:var(--muted);font-size:.82rem;padding:10px 0';status.setAttribute('role','status');more.type='button';more.className='save-pill';more.textContent='Load earlier messages';more.style.cssText='width:100%;margin:14px 0';el.append(grid,status,more);
    function safeUrl(value){try{var u=new URL(value,location.href);return /^https?:$/.test(u.protocol)?u.href:null;}catch(e){return null;}}
    function add(m){if(seen.has(m.id)||m.view_once||m.hidden||(m.scheduled_for&&Date.parse(m.scheduled_for)>Date.now())||(m.expires_at&&Date.parse(m.expires_at)<=Date.now()))return;seen.add(m.id);
      var url=safeUrl(m.media_url||''),item;
      if(tab==='media'&&m.type==='media'&&m.media_url&&url){item=document.createElement('button');item.type='button';item.style.cssText='padding:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg3);cursor:pointer;position:relative';item.setAttribute('aria-label','Open '+(m.text||'shared media'));var video=typeof _isVid==='function'&&_isVid(m.media_key||'');var img=document.createElement(video?'video':'img');img.src=url;img.style.cssText='width:100%;height:100%;object-fit:cover';if(video){img.preload='metadata';img.muted=true;var badge=document.createElement('span');badge.textContent='▶';badge.style.cssText='position:absolute;inset:0;display:grid;place-items:center;color:white;text-shadow:0 1px 6px black';item.appendChild(badge);}else{img.loading='lazy';img.alt=m.text||'Shared image';}item.prepend(img);item.onclick=function(){var dialog=document.createElement('dialog');dialog.style.cssText='width:min(94vw,900px);max-height:94dvh;padding:16px;border:1px solid var(--border);border-radius:18px;background:var(--bg);color:var(--text)';var close=document.createElement('button');close.textContent='Close';close.className='save-pill';close.onclick=function(){dialog.close();};var content=document.createElement(video?'video':'img');content.src=url;content.style.cssText='display:block;max-width:100%;max-height:75dvh;margin:12px auto;object-fit:contain';if(video)content.controls=true;else content.alt=m.text||'Shared image';dialog.append(close,content);dialog.addEventListener('close',function(){if(video)content.pause();dialog.remove();});dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close();});document.body.appendChild(dialog);dialog.showModal();};}
      else if(tab==='files'&&m.type==='file'&&m.media_url&&url){item=document.createElement('a');item.href=url;item.target='_blank';item.rel='noopener noreferrer';item.textContent=m.text||'File';}
      else if(tab==='links'&&m.type==='text'){var match=(m.text||'').match(/https?:\/\/[^\s]+/);if(!match||!safeUrl(match[0]))return;item=document.createElement('a');item.href=safeUrl(match[0]);item.textContent=match[0];item.target='_blank';item.rel='noopener noreferrer';}
      else if(tab==='voice'&&m.type==='voice'&&m.media_url&&url){item=document.createElement('audio');item.controls=true;item.preload='none';item.src=url;item.setAttribute('aria-label',m.text||'Voice message');}
      if(!item)return;if(tab!=='media')item.style.cssText='display:block;max-width:100%;width:100%;padding:12px 0;border-bottom:1px solid var(--border);overflow-wrap:anywhere;color:var(--blue)';grid.prepend(item);total++;
    }
    async function load(){if(busy)return;busy=true;more.disabled=true;status.textContent='Loading shared '+tab+'...';var url='/chat?room_id='+encodeURIComponent(room);if(cursor)url+='&before='+encodeURIComponent(cursor.before)+'&before_id='+encodeURIComponent(cursor.before_id);
      try{var res=await api.get(url);if(token!==run||!CHAT_curRoom||CHAT_curRoom.id!==room||!el.isConnected)return;(res.messages||[]).forEach(add);cursor=res.next_cursor||null;var hasMore=!!res.has_more&&!!cursor;more.hidden=!hasMore;status.textContent=total+' '+(tab==='media'?'media items':tab)+' shown'+(!total&&hasMore?'. Check earlier messages.':'');more.textContent='Load earlier messages';}
      catch(e){if(token!==run)return;status.textContent='Could not load shared '+tab+'. Your messages are unchanged.';more.hidden=false;more.textContent='Try again';}
      finally{busy=false;more.disabled=false;}
    }
    more.onclick=load;load();
  };
})();

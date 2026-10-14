/* Server-side room history search, paged on demand. No message writes. */
(function(){
  var timer=null,token=0,scope=null,cursor=null,busy=false;
  var bar=document.getElementById('in-chat-search-bar');
  var input=document.getElementById('in-chat-search-inp');
  var count=document.getElementById('in-chat-search-count');
  var panel=document.createElement('div');panel.id='history-search-results';panel.style.cssText='display:none;max-height:42vh;overflow:auto;border-bottom:1px solid var(--border);background:var(--surface);padding:8px 14px';panel.setAttribute('role','region');panel.setAttribute('aria-label','History search results');bar.after(panel);
  input.setAttribute('aria-label','Search full message history in this chat');
  function close(){clearTimeout(timer);token++;panel.style.display='none';panel.replaceChildren();count.textContent='';cursor=null;scope=null;}
  var oldClose=window.closeInChatSearch;window.closeInChatSearch=function(){close();return oldClose.apply(this,arguments);};
  function renderResult(m){var button=document.createElement('button');button.type='button';button.className='history-search-result';var title=document.createElement('strong');title.textContent=m.sender_nick||'Message';var text=document.createElement('span');text.textContent=m.text||'';var date=document.createElement('small');date.textContent=new Date(m.created_at).toLocaleString();button.append(title,text,date);button.onclick=function(){window.jumpToHistoryMessage(m.id);};panel.appendChild(button);}
  async function query(more){if(!scope)return;if(busy){timer=setTimeout(function(){query(more);},100);return;}var current=scope,run=token;busy=true;count.textContent='Searching...';if(!more)panel.replaceChildren();var moreButton=panel.querySelector('.history-search-more');if(moreButton)moreButton.remove();
    var url='/chat?room_id='+encodeURIComponent(current.room)+'&search='+encodeURIComponent(current.q);
    if(more&&cursor)url+='&search_before='+encodeURIComponent(cursor.before)+'&search_before_id='+encodeURIComponent(cursor.before_id);
    try{var res=await api.get(url);if(run!==token||!CHAT_curRoom||CHAT_curRoom.id!==current.room)return;var rows=res.messages||[];rows.forEach(renderResult);cursor=res.next_cursor||null;count.textContent=panel.querySelectorAll('.history-search-result').length+' results';if(!panel.children.length){var empty=document.createElement('div');empty.textContent='No matching messages.';empty.style.padding='14px';panel.appendChild(empty);}if(res.has_more&&cursor){var next=document.createElement('button');next.type='button';next.className='history-search-more';next.textContent='Search earlier messages';next.onclick=function(){query(true);};panel.appendChild(next);}}
    catch(e){if(run!==token)return;count.textContent='Could not search';var retry=document.createElement('button');retry.type='button';retry.textContent='Try search again';retry.onclick=function(){query(more);};panel.appendChild(retry);}finally{busy=false;}
  }
  window.doInChatSearch=function(){clearTimeout(timer);token++;var q=input.value.trim();if(!q||!CHAT_curRoom){close();return;}scope={room:CHAT_curRoom.id,q:q};cursor=null;panel.style.display='block';count.textContent='Searching...';timer=setTimeout(function(){query(false);},300);};
  window.jumpToHistoryMessage=async function(id){if(!CHAT_curRoom)return;var room=CHAT_curRoom.id;var rounds=0;count.textContent='Finding message...';while(!CHAT_messages.some(function(m){return m.id===id;})&&CHAT_hasOlder&&rounds<5){if(CHAT_historyBusy){toast('History is already loading. Try again shortly.');return;}rounds++;await loadOlderMessages();if(!CHAT_curRoom||CHAT_curRoom.id!==room)return;}
    if(CHAT_messages.some(function(m){return m.id===id;})){CHAT_renderLimit=CHAT_messages.length;renderMessages(false);requestAnimationFrame(function(){scrollToMsg(id);});count.textContent='Message found';}else{count.textContent='Message is further back';toast('Load earlier messages, then tap the result again.');}};
  window.inChatSearchNav=function(){var first=panel.querySelector('.history-search-result');if(first)first.focus();};
  var oldScroll=window.scrollToMsg;window.scrollToMsg=function(id){if(document.getElementById('msg-'+id))return oldScroll(id);if(CHAT_messages.some(function(m){return m.id===id;})){CHAT_renderLimit=CHAT_messages.length;renderMessages(false);return oldScroll(id);}return window.jumpToHistoryMessage(id);};
  var oldOpen=window.openChatRoom;window.openChatRoom=function(){close();return oldOpen.apply(this,arguments);};
})();

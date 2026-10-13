// Chat reliability and privacy corrections.
function _msgSig(m) {
  return JSON.stringify([m.id,m.type,m.text,m.media_url,m.edited_at,m.edited,m.read,m.opened,m.pinned,m.seen_count,m.expires_at,m.reactions,m.reply_to,m.reply_count,m._scheduled_pending,m._pending,m._failed]);
}
function loadMessages(scrollToBottom) {
  if (!CHAT_curRoom) return;

  var roomId = CHAT_curRoom.id;
  var topicId = CHAT_curTopicId;
  var topicQuery = CHAT_curTopicId ? ('&topic_id=' + encodeURIComponent(CHAT_curTopicId)) : '';
  api.get('/chat?room_id=' + encodeURIComponent(CHAT_curRoom.id) + topicQuery)
    .then(function (res) {
      if (!CHAT_curRoom || CHAT_curRoom.id !== roomId || CHAT_curTopicId !== topicId) return;
      if (!CHAT_historyCursor) { CHAT_historyCursor = res.next_cursor || null; CHAT_hasOlder = !!res.has_more; }
      var fetched = res.messages || [];
      var fetchedIds = new Set(fetched.map(function(m){ return m.id; }));
      var older = CHAT_messages.filter(function(m){ return m.room_id === roomId && !m._pending && !m._failed && !fetchedIds.has(m.id) && fetched.length && m.created_at < fetched[0].created_at && (!m.expires_at || Date.parse(m.expires_at) > Date.now()); });
      var pending = CHAT_messages.filter(function(m){ return m.room_id === roomId && (m._pending || m._failed); });
      var msgs = older.concat(fetched, pending);
      var prevLen = CHAT_messages.length;
      CHAT_messages = msgs;

      // Count new messages while not at bottom
      if (!scrollToBottom && !CHAT_atBottom && msgs.length > prevLen) {
        CHAT_unreadNew += (msgs.length - prevLen);
        var arrow = document.getElementById('new-arrow');
        if (arrow) {
          arrow.classList.add('show');
          var badge = document.getElementById('new-count');
          if (badge) { badge.textContent = CHAT_unreadNew; badge.style.display = 'flex'; }
        }
      }

      // Only rebuild the message list when something actually changed. The 8s
      // poll was calling renderMessages every time, which rebuilt innerHTML and
      // destroyed any <audio> mid-playback — that was the voice/music "shockt
      // zich op" glitch. Build a lightweight signature of what's visible.
      var newSig = msgs.map(_msgSig).join('|');

      if (newSig === CHAT_lastRenderSig && !scrollToBottom) {
        // Nothing visible changed — skip the rebuild entirely.
      } else {
        renderMessages(scrollToBottom || CHAT_atBottom);
        CHAT_lastRenderSig = newSig;
        _ypRestoreUI(); // re-assert play/pause icon for any audio still playing
      }

      // Update pinned bar text now that messages are loaded
      if (CHAT_pinnedMsgId) {
        var pinnedMsg = CHAT_messages.find(function (m) { return m.id === CHAT_pinnedMsgId; });
        var pinnedText = document.getElementById('pinned-bar-text');
        if (pinnedText && pinnedMsg) {
          pinnedText.textContent = pinnedMsg.text || '[Media]';
        }
      }

      updateHistoryButton();
      // Fetch link previews asynchronously
      setTimeout(function () {
        CHAT_messages.forEach(function (m) {
          if (!m.text) return;
          var urlMatch = m.text.match(/(https?:\/\/[^\s]{10,})/);
          if (!urlMatch) return;
          var rawUrl = urlMatch[1];
          var lpEl = document.getElementById('lp-' + m.id);
          if (!lpEl || lpEl.dataset.loaded) return;

          // Internal invite/join links have no useful preview and render as an
          // empty white box — skip them (the link text stays clickable).
          if (/\/chat\?join=|\/invite\b|yidplus\.com\/chat\?/i.test(rawUrl)) { lpEl.dataset.loaded = '1'; return; }

          // Re-renders (e.g. a read-receipt change) replace the message node and
          // wipe the loaded preview; repopulate instantly from cache so it never
          // flickers or "dances".
          if (CHAT_lpCache[m.id]) {
            lpEl.dataset.loaded = '1';
            lpEl.style.cssText = CHAT_lpCache[m.id].css;
            lpEl.innerHTML = CHAT_lpCache[m.id].html;
            lpEl.onclick = CHAT_lpCache[m.id].url ? function () { window.open(CHAT_lpCache[m.id].url, '_blank'); } : null;
            return;
          }
          lpEl.dataset.loaded = '1';

          // YouTube embed
          var ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/);
          if (ytMatch) {
            var vid = ytMatch[1];
            lpEl.style.display = 'block';
            lpEl.innerHTML =
              '<div style="border-radius:12px;overflow:hidden;cursor:pointer;background:#000;position:relative;padding-top:56.25%">' +
                '<iframe src="https://www.youtube.com/embed/' + vid + '?rel=0" ' +
                  'style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" ' +
                  'allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ' +
                  'allowfullscreen loading="lazy"></iframe>' +
              '</div>';
            CHAT_lpCache[m.id] = { html: lpEl.innerHTML, css: lpEl.style.cssText, url: '' };
            return;
          }
          api.get('/link-preview?url=' + encodeURIComponent(rawUrl))
            .then(function (res) {
              if (!res || !res.ok || !res.title) return;
              var isMe = m.sender_id === (STATE.user && STATE.user.id);
              lpEl.onclick = function () { window.open(rawUrl, '_blank'); };
              lpEl.style.cssText = 'display:block;margin-top:.4rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface);max-width:100%;opacity:0;transition:opacity .25s ease';
              lpEl.innerHTML =
                (res.image
                  ? '<img src="' + escHtml(res.image) + '" onerror="this.style.display=&#39;none&#39;" style="width:100%;aspect-ratio:1.91/1;max-height:150px;object-fit:cover;display:block;background:var(--bg3)" loading="lazy">'
                  : '') +
                '<div style="padding:.5rem .65rem">' +
                  '<div style="font-size:.7rem;color:' + (isMe ? '#4c8a63' : 'var(--muted)') + ';margin-bottom:.15rem;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escHtml(new URL(rawUrl).hostname) + '</div>' +
                  '<div style="font-size:.82rem;font-weight:700;color:' + (isMe ? '#12241d' : 'var(--text)') + ';line-height:1.3">' + escHtml(res.title.slice(0, 80)) + '</div>' +
                  (res.description ? '<div style="font-size:.72rem;color:' + (isMe ? '#3f7a58' : 'var(--muted)') + ';margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(res.description.slice(0, 120)) + '</div>' : '') +
                '</div>';
              lpEl.style.display = 'block';
              CHAT_lpCache[m.id] = { html: lpEl.innerHTML, css: 'display:block;margin-top:.4rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface);max-width:100%;opacity:1', url: rawUrl };
              // Fade in on the next frame instead of popping straight to
              // opacity 1 — softens the sudden appearance once the async
              // preview fetch resolves, since it always lands a beat after
              // the message itself is already rendered and scrolled.
              requestAnimationFrame(function () { lpEl.style.opacity = '1'; });
            })
            .catch(function () {});
        });
      }, 600);

      // Clear the local unread badge whenever you OPEN a room — including one
      // you're only spectating — so the badge goes down the moment you view it.
      var _cachedRoom = CHAT_rooms.find(function (r) { return r.id === CHAT_curRoom.id; });
      if (_cachedRoom) _cachedRoom.unread = 0;
      // Remember locally that we've seen this room up to now, so the badge stays
      // down on later server polls (for spectated chats the server never marks
      // them read, so without this the count would keep coming back).
      _markRoomSeenLocally(CHAT_curRoom.id);
      if (typeof _refreshChatNavBadge === 'function') _refreshChatNavBadge();
      // Only tell the SERVER for rooms you're actually a member of — spectating
      // must stay invisible and leave no read trace.
      if (CHAT_curRoom.joined !== false && chatReceiptsEnabled()) {
        api.post('/chat/read', { room_id: roomId, receipts: chatReceiptsEnabled() }).catch(function () {});
      }

      // Load reaction summary for this room and re-render once available.
      api.get('/chat/reactions?room_id=' + encodeURIComponent(CHAT_curRoom.id))
        .then(function (rres) {
          if (!CHAT_curRoom || CHAT_curRoom.id !== roomId || CHAT_curTopicId !== topicId) return;
          CHAT_reactions = rres.reactions || {};
          renderMessages(false);
        })
        .catch(function () {});
    })
    .catch(function () {});
}

window.sendChatMsg = function () {
  var inp  = document.getElementById('chat-input');
  var text = (inp.value || '').trim();
  if (!text || !CHAT_curRoom) return;
  if (!CHAT_curRoom.joined && CHAT_curRoom.type === 'group') return;

  var payload = { room_id: CHAT_curRoom.id, type: 'text', text: text };
  if (CHAT_replyTo) payload.reply_to_id = CHAT_replyTo.id;
  if (CHAT_curTopicId) payload.topic_id = CHAT_curTopicId;
  if (CHAT_scheduleFor) payload.scheduled_for = CHAT_scheduleFor;
  if (CHAT_disappearSecs) payload.disappear_seconds = CHAT_disappearSecs;

  var roomId = CHAT_curRoom.id;
  var topicId = CHAT_curTopicId;
  var wasScheduled = !!CHAT_scheduleFor;

  // Clear input immediately (feels instant)
  var msgText = text;
  inp.value = '';
  delete CHAT_drafts[roomId];
  persistChatDraft(roomId, '');
  inp.style.height = 'auto';
  document.getElementById('chat-send-btn').style.display = 'none';
  document.getElementById('voice-rec-btn').style.display = 'flex';
  _cancelReply();

  // Optimistic render: show message immediately before server confirms
  var tempId = 'tmp-' + Date.now();
  var me = STATE.user || {};
  var now = new Date().toISOString();
  var tempMsg = {
    id: tempId, room_id: CHAT_curRoom ? CHAT_curRoom.id : '',
    sender_id: me.id, sender_nick: me.nickname || '',
    sender_photo: me.photo_url || null,
    type: 'text', text: msgText, created_at: now, read: 0,
    reply_to_id: payload.reply_to_id || null,
    _pending: true,
  };
  CHAT_messages.push(tempMsg);
  renderMessages(false);
  var sentEl = document.getElementById('msg-' + tempId);
  if (sentEl) sentEl.classList.add('sending');
  scrollToBottom();

  api.post('/chat', payload)
    .then(function (res) {
      if (!CHAT_curRoom || CHAT_curRoom.id !== roomId || CHAT_curTopicId !== topicId) { loadChatRooms(); return; }
      if (wasScheduled) {
        toast('🕓 Message scheduled');
        if (res.message) CHAT_messages = CHAT_messages.map(function(m){ return m.id === tempId ? res.message : m; });
        else CHAT_messages = CHAT_messages.filter(function(m){ return m.id !== tempId; });
        renderMessages(false);
      } else if (res && res.message) {
        // Swap the optimistic message for the real one (real id, confirmed) —
        // no full reload, so it's instant and the reply quote stays put.
        var real = res.message;
        if (real.media_key && !real.media_url) real.media_url = '/api/media/' + encodeURIComponent(real.media_key);
        real.sender_nick = real.sender_nick || tempMsg.sender_nick;
        real.sender_photo = real.sender_photo || tempMsg.sender_photo;
        var i = CHAT_messages.findIndex(function (m) { return m.id === tempId; });
        if (i !== -1) CHAT_messages[i] = real; else CHAT_messages.push(real);
        renderMessages(false);
      } else {
        loadMessages(true);
      }
      _resetMsgOptions();
    })
    .catch(function (err) {
      toast('Message not sent: ' + err.message);
      CHAT_failedSends[tempId] = { payload: payload, message: tempMsg };
      try { sessionStorage.setItem('yp_failed_sends', JSON.stringify(CHAT_failedSends)); } catch(e) {}
      if (!CHAT_curRoom || CHAT_curRoom.id !== roomId || CHAT_curTopicId !== topicId) return;
      tempMsg._pending = false; tempMsg._failed = true;
      CHAT_messages = CHAT_messages.map(function(m){ return m.id === tempId ? tempMsg : m; });
      if (!inp.value) { inp.value = msgText; persistChatDraft(roomId, msgText); onChatType(); }
      _resetMsgOptions();
      renderMessages(false);
    });
};


var CHAT_failedSends = {};
try { CHAT_failedSends = JSON.parse(sessionStorage.getItem('yp_failed_sends') || '{}'); } catch(e) {}
var CHAT_historyCursor = null, CHAT_hasOlder = false, CHAT_historyBusy = false;
function chatReceiptsEnabled() { try { return localStorage.getItem('yp_read_receipts') !== '0'; } catch(e) { return true; } }
function persistChatDraft(roomId, text) {
  CHAT_drafts[roomId] = text;
  try { sessionStorage.setItem('yp_draft_' + roomId, text); } catch(e) {}
}
function updateHistoryButton() {
  var host = document.getElementById('chat-msgs'); if (!host) return;
  var button = document.getElementById('chat-older');
  if (!button && CHAT_hasOlder) { button = document.createElement('button'); button.id = 'chat-older'; button.className='btn-secondary'; button.style.cssText='display:block;margin:.6rem auto;padding:.5rem 1rem'; button.onclick=loadOlderMessages; host.prepend(button); }
  if (button) { button.style.display = CHAT_hasOlder ? 'block' : 'none'; button.textContent = CHAT_historyBusy ? 'Loading...' : 'Load earlier messages'; button.disabled = CHAT_historyBusy; }
}
window.loadOlderMessages = function () {
  if (!CHAT_curRoom || !CHAT_historyCursor || CHAT_historyBusy) return;
  var roomId = CHAT_curRoom.id, topicId = CHAT_curTopicId, cursor = CHAT_historyCursor;
  var host = document.getElementById('chat-msgs'), height = host.scrollHeight, top = host.scrollTop;
  CHAT_historyBusy = true; updateHistoryButton();
  api.get('/chat?room_id='+encodeURIComponent(roomId)+'&before='+encodeURIComponent(cursor.before)+'&before_id='+encodeURIComponent(cursor.before_id)+(topicId?'&topic_id='+encodeURIComponent(topicId):''))
  .then(function(res){
    if (!CHAT_curRoom || CHAT_curRoom.id !== roomId || CHAT_curTopicId !== topicId) return;
    var ids = new Set(CHAT_messages.map(function(m){return m.id;}));
    CHAT_messages=(res.messages||[]).filter(function(m){return !ids.has(m.id);}).concat(CHAT_messages);
    CHAT_historyCursor=res.next_cursor; CHAT_hasOlder=!!res.has_more;
    renderMessages(false); host.scrollTop=top+host.scrollHeight-height;
  }).catch(function(){toast('Could not load earlier messages. Try again.');})
  .finally(function(){CHAT_historyBusy=false;updateHistoryButton();});
};
function retryChatMessage(id) {
  var failed=CHAT_failedSends[id]; if(!failed || !CHAT_curRoom || CHAT_curRoom.id!==failed.payload.room_id) return;
  ypConfirm('Check this conversation first. If the message did arrive, do not retry. Send it again?', {okText:'Retry'}).then(function(ok){
    if(!ok) return;
    api.post('/chat',failed.payload).then(function(res){
      delete CHAT_failedSends[id];try{sessionStorage.setItem('yp_failed_sends',JSON.stringify(CHAT_failedSends));}catch(e){}
      if(!CHAT_curRoom || CHAT_curRoom.id!==failed.payload.room_id) return;
      CHAT_messages=CHAT_messages.filter(function(m){return m.id!==id;});
      if(res.message)CHAT_messages.push(res.message);renderMessages(false);
    }).catch(function(e){toast('Message not sent: '+e.message);});
  });
}
var _chatRenderBase=renderMessages;
renderMessages=function(down){
  _chatRenderBase(down);
  Object.keys(CHAT_failedSends).forEach(function(id){
    var node=document.getElementById('msg-'+id);if(!node || node.querySelector('.chat-retry'))return;
    var b=document.createElement('button');b.className='chat-retry';b.textContent='Not sent - Retry';b.style.cssText='border:0;background:none;color:var(--danger,#c33);padding:.35rem;cursor:pointer';b.onclick=function(e){e.stopPropagation();retryChatMessage(id);};node.appendChild(b);
  });
  updateHistoryButton();
};
var _chatOpenBase=window.openChatRoom;
window.openChatRoom=function(){
  var targetId=arguments[0];
  var target=CHAT_rooms.find(function(r){return r.id===targetId;});
  if(target && target.type==='group' && arguments[1]===undefined) arguments[1]=null;
  var input=document.getElementById('chat-input');
  if(CHAT_curRoom && input)persistChatDraft(CHAT_curRoom.id,input.value);
  CHAT_historyCursor=null;CHAT_hasOlder=false;CHAT_historyBusy=false;
  if (!CHAT_curRoom || CHAT_curRoom.id !== arguments[0]) { CHAT_messages=[]; CHAT_lastRenderSig=null; }
  var result=_chatOpenBase.apply(this,arguments);
  if(CHAT_curRoom && input){var saved='';try{saved=sessionStorage.getItem('yp_draft_'+CHAT_curRoom.id)||'';}catch(e){}input.value=saved;onChatType();}
  if(CHAT_curRoom) Object.keys(CHAT_failedSends).forEach(function(id){var f=CHAT_failedSends[id];if(f.payload.room_id===CHAT_curRoom.id){f.message._pending=false;f.message._failed=true;if(!CHAT_messages.some(function(m){return m.id===id;}))CHAT_messages.push(f.message);}});
  return result;
};
var _chatTypeBase=window.onChatType;
window.onChatType=function(){_chatTypeBase.apply(this,arguments);if(CHAT_curRoom){var input=document.getElementById('chat-input');if(input)persistChatDraft(CHAT_curRoom.id,input.value);}};
window._openOnceVoice=function(id){
  ypConfirm('This voice message can be opened once. Continue?',{okText:'Listen'}).then(function(ok){
    if(!ok)return;
    api.put('/chat',{id:id,opened:true}).then(function(res){
      if(!res.media_url)throw new Error('Media unavailable');
      var audio=new Audio(res.media_url);audio.play().catch(function(){toast('Playback could not start. This message has been opened.');});
      var msg=CHAT_messages.find(function(m){return m.id===id;});if(msg)msg.opened=true;renderMessages(false);
    }).catch(function(e){toast(e.message||'Could not open message');});
  });
};
var _chatReceiptsBase=window.toggleReadReceipts;
window.toggleReadReceipts=function(el){
  var previous=chatReceiptsEnabled();_chatReceiptsBase(el);
  api.put('/profile',{read_receipts:chatReceiptsEnabled()?1:0}).catch(function(){
    if(previous===false)return; // Local off continues to suppress read writes.
    toast('Saved on this device. Account sync unavailable.');
  });
};
(function(){
  var style=document.createElement('style');style.textContent='#cr-status{white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #cr-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .chatroom-topbar>.icon-btn{flex-shrink:0} #cr-name-wrap{min-width:35px}';document.head.appendChild(style);
  api.get('/profile').then(function(res){if(res.profile && res.profile.read_receipts===0){try{localStorage.setItem('yp_read_receipts',res.profile.read_receipts?'1':'0');}catch(e){}}}).catch(function(){});
  var ai=document.querySelector('.ai-chat-item');
  // Existing AI row may be added after load, so normalize only the known duplicate.
  var observer=new MutationObserver(function(){document.querySelectorAll('#chat-list-area div').forEach(function(el){if(el.children.length===0 && el.textContent==='Ask me anything · Ask me anything')el.textContent='Ask me anything';});});
  var list=document.getElementById('chat-list-area');if(list)observer.observe(list,{childList:true,subtree:true});
})();

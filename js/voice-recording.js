/* Hold, slide to cancel and slide up to lock. Recording stays local until send. */
(function(){
  var session=null,serial=0;
  var mic=document.getElementById('voice-rec-btn');
  var hold=document.getElementById('rec-overlay');
  var lock=document.getElementById('rec-lock-pill');
  var bar=document.getElementById('rec-locked-bar');
  var pause=document.createElement('button');pause.id='voice-pause';pause.type='button';pause.className='voice-pause';pause.setAttribute('aria-label','Pause recording');pause.textContent='Ⅱ';
  var center=bar.querySelector('.rec-locked-center');bar.insertBefore(pause,bar.querySelector('.rec-locked-send'));
  var preview=document.createElement('audio');preview.id='voice-local-preview';preview.controls=true;preview.style.display='none';bar.insertBefore(preview,pause);
  var status=document.createElement('div');status.id='voice-record-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='voice-record-status';bar.insertBefore(status,bar.firstChild);
  var hint=document.getElementById('rec-slide-hint');if(hint)hint.querySelector('span').textContent='Slide left to cancel';
  var lockLabel=document.createElement('span');lockLabel.className='voice-lock-label';lockLabel.textContent='Slide up to lock';lock.appendChild(lockLabel);
  function haptic(){try{if(navigator.vibrate)navigator.vibrate(18);}catch(e){}}
  function release(){try{if(session&&mic.hasPointerCapture(session.pointer))mic.releasePointerCapture(session.pointer);}catch(e){}}
  function say(text){status.textContent=text;}
  function stopTracks(s){if(s.stream)s.stream.getTracks().forEach(function(t){t.stop();});if(s.context&&s.context.state!=='closed'){try{s.context.close().catch(function(){});}catch(e){}}cancelAnimationFrame(s.frame);clearInterval(s.timer);}
  function cleanup(s){stopTracks(s);release();mic.classList.remove('rec','held');mic.style.transform='';hold.classList.remove('show');lock.classList.remove('show','near');bar.classList.remove('show');document.getElementById('chat-input-bar').style.display='';preview.pause();preview.style.display='none';preview.removeAttribute('src');if(s.previewUrl)URL.revokeObjectURL(s.previewUrl);CHAT_isRecording=false;CHAT_recLocked=false;say('');if(session===s)session=null;}
  function elapsed(s){return s.elapsed+(s.phase==='recording'?Date.now()-s.tick:0);}
  function meters(s){var seconds=Math.floor(elapsed(s)/1000),label=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');['rec-live-time','rec-locked-time'].forEach(function(id){document.getElementById(id).textContent=label;});}
  function showLocked(s){s.locked=true;CHAT_recLocked=true;release();mic.classList.remove('held');mic.style.transform='';hold.classList.remove('show');lock.classList.remove('show','near');document.getElementById('chat-input-bar').style.display='none';bar.classList.add('show');pause.disabled=false;pause.textContent='Ⅱ';pause.setAttribute('aria-label','Pause recording');preview.style.display='none';if(center)center.style.display='flex';say(s.phase==='pending'?'Opening microphone...':'Recording');haptic();}
  function cancel(){var s=session;if(!s||s.phase==='uploading')return;s.action='cancel';s.cancelled=true;if(s.recorder&&s.recorder.state!=='inactive')s.recorder.stop();else cleanup(s);}
  function finish(){var s=session;if(!s||s.phase==='uploading')return;if(s.phase==='failed'){upload(s);return;}if(s.phase==='pending'){s.action='send';return;}if(elapsed(s)<500){cancel();toast('Hold the microphone to record a voice message.');return;}s.action='send';if(s.phase==='recording'){s.elapsed+=Date.now()-s.tick;}s.phase='stopping';if(s.recorder.state!=='inactive')s.recorder.stop();}
  function upload(s){
    s.phase='uploading';say('Sending voice message...');pause.disabled=true;bar.querySelector('.rec-locked-send').disabled=true;bar.querySelector('.rec-locked-delete').disabled=true;
    var seconds=Math.max(1,Math.round(s.elapsed/1000));var packed=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+'|'+_downsamplePeaks(s.peaks,40).map(function(p){return Math.round(p*100);}).join(',');
    var data=new FormData();data.append('room_id',s.room);data.append('type','voice');data.append('text',packed);data.append('file',new File([s.blob],'voice_'+Date.now()+'.'+s.ext,{type:s.mime}));if(s.topic)data.append('topic_id',s.topic);if(s.reply)data.append('reply_to_id',s.reply);if(s.schedule)data.append('scheduled_for',s.schedule);if(s.disappear)data.append('disappear_seconds',s.disappear);
    api.post('/chat',data,true).then(function(){bar.querySelector('.rec-locked-send').disabled=false;bar.querySelector('.rec-locked-delete').disabled=false;cleanup(s);if(CHAT_curRoom&&CHAT_curRoom.id===s.room)loadMessages(true);loadChatRooms();}).catch(function(){s.phase='failed';bar.querySelector('.rec-locked-send').disabled=false;bar.querySelector('.rec-locked-delete').disabled=false;say('Not sent. Your recording is still here. Check the chat before retrying.');toast('Voice message not sent. Recording kept for retry.');});
  }
  function start(s){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){toast('Voice recording is not supported in this browser.');cleanup(s);return;}
    navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}}).then(function(stream){
      if(session!==s||s.cancelled){stream.getTracks().forEach(function(t){t.stop();});return;}
      s.stream=stream;s.mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].find(function(m){return MediaRecorder.isTypeSupported(m);})||'';s.ext=s.mime.indexOf('mp4')!==-1?'m4a':s.mime.indexOf('ogg')!==-1?'ogg':'webm';
      try{s.recorder=new MediaRecorder(stream,s.mime?{mimeType:s.mime}:{ });}catch(e){cleanup(s);toast('Could not start recording. Try again.');return;}
      CHAT_mediaRec=s.recorder;CHAT_isRecording=true;s.phase='recording';s.tick=Date.now();
      s.recorder.ondataavailable=function(e){if(e.data.size)s.chunks.push(e.data);if(s.phase==='paused'){if(s.previewUrl)URL.revokeObjectURL(s.previewUrl);s.previewUrl=URL.createObjectURL(new Blob(s.chunks,{type:s.mime}));preview.src=s.previewUrl;preview.style.display='block';}};
      s.recorder.onstop=function(){stopTracks(s);if(s.cancelled||s.action!=='send'){cleanup(s);return;}s.blob=new Blob(s.chunks,{type:s.mime||s.recorder.mimeType});if(!s.blob.size){cleanup(s);toast('No audio recorded. Please try again.');return;}showLocked(s);upload(s);};
      s.recorder.onerror=function(){s.cancelled=true;try{if(s.recorder.state!=='inactive')s.recorder.stop();}catch(e){}cleanup(s);toast('Recording stopped. Nothing was sent.');};
      try{s.recorder.start(250);}catch(e){cleanup(s);toast('Could not start recording. Nothing was sent.');return;}
      if(s.action==='cancel'){cancel();return;}if(s.action==='send'){cancel();toast('Microphone is ready. Hold again to record.');return;}
      _buildRecWaveform(document.getElementById('rec-live-meter'));_buildRecWaveform(document.getElementById('rec-locked-meter'));
      if(s.locked)showLocked(s);else{hold.classList.add('show');lock.classList.add('show');mic.classList.add('held');}
      s.timer=setInterval(function(){if(!CHAT_curRoom||CHAT_curRoom.id!==s.room){if(s.phase!=='uploading')cancel();return;}meters(s);},200);
      try{s.context=new(window.AudioContext||window.webkitAudioContext)();var analyser=s.context.createAnalyser();analyser.fftSize=256;s.context.createMediaStreamSource(stream).connect(analyser);var values=new Uint8Array(analyser.frequencyBinCount);function draw(){if(session!==s)return;if(s.phase==='recording'){analyser.getByteFrequencyData(values);var level=values.reduce(function(a,b){return a+b;},0)/values.length/255;s.peaks.push(level);_updateRecordingBar(level);meters(s);}s.frame=requestAnimationFrame(draw);}draw();}catch(e){}
      haptic();
    }).catch(function(err){if(session!==s)return;cleanup(s);toast(err&&err.name==='NotAllowedError'?'Allow microphone access in your browser, then try again.':'Could not open the microphone. Nothing was sent.');});
  }
  window._micDown=function(e){if(session||!CHAT_curRoom||(!CHAT_curRoom.joined&&CHAT_curRoom.type==='group')||(e.button!=null&&e.button!==0))return;var input=document.getElementById('chat-input');if(input&&input.value.trim())return;if(e.cancelable)e.preventDefault();session={id:++serial,room:CHAT_curRoom.id,topic:CHAT_curTopicId,reply:CHAT_replyTo&&CHAT_replyTo.id,schedule:CHAT_scheduleFor,disappear:CHAT_disappearSecs,pointer:e.pointerId,x:e.clientX,y:e.clientY,phase:'pending',locked:false,chunks:[],peaks:[],elapsed:0,action:null};try{mic.setPointerCapture(e.pointerId);}catch(err){}if(hint)hint.style.opacity='1';mic.classList.add('held');start(session);};
  window._micMove=function(e){var s=session;if(!s||s.locked||s.pointer!==e.pointerId||s.phase==='uploading')return;var dx=e.clientX-s.x,dy=e.clientY-s.y;if(dx<=-90&&Math.abs(dx)>Math.abs(dy)){cancel();haptic();return;}if(dy<=-65&&Math.abs(dy)>Math.abs(dx)*.75){showLocked(s);return;}mic.style.transform='translate('+Math.max(-60,Math.min(0,dx))+'px,'+Math.max(-45,Math.min(0,dy))+'px) scale(1.2)';lock.classList.toggle('near',dy<-30);if(hint)hint.style.opacity=String(1-Math.min(-dx/110,.8));};
  window._micUp=function(e){var s=session;if(!s||s.pointer!==e.pointerId||s.locked)return;if(s.phase==='pending'){cancel();toast('Microphone is opening. Hold again once it is ready.');return;}finish();};
  window._micCancelGesture=function(){if(session&&!session.locked)cancel();};
  window.toggleVoiceRec=function(){if(session){if(session.locked)pause.click();return;}window._micDown({clientX:0,clientY:0,pointerId:-1,button:0,cancelable:false});if(session)showLocked(session);};window.startVoiceRec=window.toggleVoiceRec;
  window.cancelVoiceRec=cancel;window.stopVoiceRecAndSend=finish;window._stopLockedRec=finish;
  pause.onclick=function(){var s=session;if(!s||!s.recorder||s.phase==='uploading'||s.phase==='failed')return;if(s.phase==='recording'){s.elapsed+=Date.now()-s.tick;s.phase='paused';s.recorder.pause();s.recorder.requestData();pause.textContent='●';pause.setAttribute('aria-label','Resume recording');if(center)center.style.display='none';say('Paused. Listen before sending.');}else if(s.phase==='paused'){preview.pause();preview.style.display='none';s.recorder.resume();s.tick=Date.now();s.phase='recording';pause.textContent='Ⅱ';pause.setAttribute('aria-label','Pause recording');if(center)center.style.display='flex';say('Recording');}meters(s);};
  mic.addEventListener('lostpointercapture',function(){if(session&&!session.locked&&session.phase==='recording')cancel();});
  window.addEventListener('pagehide',function(){if(session&&session.phase!=='uploading')cancel();});
  document.addEventListener('visibilitychange',function(){if(document.hidden&&session&&session.phase==='recording'){showLocked(session);pause.click();}});
  var oldOpen=window.openChatRoom;window.openChatRoom=function(id){if(session&&session.room!==id){if(session.phase==='uploading')return toast('Wait for your voice message to finish sending.');cancel();}return oldOpen.apply(this,arguments);};
  mic.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!session){window._micDown({clientX:0,clientY:0,pointerId:-1,button:0,cancelable:false});if(session)showLocked(session);}}});
  mic.setAttribute('aria-label','Voice message. Hold to record, slide up to lock, slide left to cancel.');
})();

// Local MP3 preparation. Originals are never overwritten by downloads.
// LAME LGPL: https://lame.sourceforge.net/ . See js/vendor/LAME-LICENSE.txt.
// mp3tag.js MIT: https://github.com/eidoriantan/mp3tag.js . License in js/vendor.
(function(){
 var busy=false,worker=null,cancelled=false;
 function mp3(bytes){
  var p=0;if(bytes.length>=10&&String.fromCharCode.apply(null,bytes.subarray(0,3))==='ID3'){p=10+((bytes[6]&127)<<21)+((bytes[7]&127)<<14)+((bytes[8]&127)<<7)+(bytes[9]&127);if(bytes[3]===4&&(bytes[5]&16))p+=10;}
  // Require consecutive complete MPEG Layer III frames, not an isolated sync byte.
  function frame(i){
   if(i+4>bytes.length||bytes[i]!==255||(bytes[i+1]&224)!==224||(bytes[i+1]&6)!==2)return null;
   var v=(bytes[i+1]>>3)&3,b=(bytes[i+2]>>4)&15,r=(bytes[i+2]>>2)&3;
   if(v===1||b===0||b===15||r===3)return null;
   var rate=[44100,48000,32000][r]/(v===3?1:v===2?2:4),kb=(v===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[b];
   return {length:Math.floor((v===3?144000:72000)*kb/rate)+((bytes[i+2]>>1)&1),version:v,rate:rate};
  }
  for(var i=p;i<Math.min(bytes.length-4,p+4096);i++){var a=frame(i);if(!a||i+a.length>bytes.length)continue;var b=frame(i+a.length);if(b&&b.version===a.version&&b.rate===a.rate&&i+a.length+b.length<=bytes.length)return true;}
  return false;
 }
 function panel(){
  var el=document.getElementById('mp3-progress');if(el)el.remove();el=document.createElement('div');el.id='mp3-progress';el.style.cssText='position:fixed;inset:auto 16px 90px;z-index:10000;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;padding:16px;box-shadow:0 8px 40px #0004';
  el.innerHTML='<div role="status" id="mp3-status">Preparing MP3 on this device...</div><button id="mp3-cancel" style="min-height:44px;margin-top:8px">Cancel</button>';document.body.appendChild(el);
  el.querySelector('button').onclick=function(){cancelled=true;if(worker)worker.terminate();el.remove();};
 }
 async function coverBytes(file){
  if(!file)return null;if(file.size>12*1024*1024)throw Error('Cover must be under 12 MB');
  var image=await createImageBitmap(file);try{if(image.width*image.height>40000000)throw Error('Cover is too large');var c=document.createElement('canvas'),s=Math.min(1,800/Math.max(image.width,image.height));c.width=Math.round(image.width*s);c.height=Math.round(image.height*s);var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(image,0,0,c.width,c.height);var blob=await new Promise(function(r){c.toBlob(r,'image/jpeg',.9);});if(!blob)throw Error('Could not prepare cover');return {bytes:await blob.arrayBuffer(),type:'image/jpeg'};}finally{image.close();}
 }
 async function prepare(file,cover,meta){
  if(busy)throw Error('Another MP3 is being prepared');if(!(file instanceof File))throw Error('Select an audio file');if(cover&&!(cover instanceof Blob))cover=null;if(file.size>64*1024*1024)throw Error('MP3 preparation supports files up to 64 MB on this device');busy=true;cancelled=false;panel();
  try{
   var data=await file.arrayBuffer(),picture=await coverBytes(cover),payload={audio:data,title:meta.title,artist:meta.artist,album:meta.album,cover:picture&&picture.bytes,coverType:picture&&picture.type};
   if(!mp3(new Uint8Array(data))){
    if(file.size>32*1024*1024)throw Error('Audio conversion supports source files up to 32 MB');
    var context=new (window.AudioContext||window.webkitAudioContext)();try{var decoded=await context.decodeAudioData(data);if(decoded.duration>600||decoded.numberOfChannels>2)throw Error('Conversion supports up to 10 minutes and stereo audio');payload.sampleRate=decoded.sampleRate;payload.channels=[];for(var n=0;n<decoded.numberOfChannels;n++)payload.channels.push(decoded.getChannelData(n).slice());delete payload.audio;}finally{await context.close();}
   }
   if(cancelled||!document.getElementById('mp3-cancel'))throw Error('Cancelled');
   var result=await new Promise(function(resolve,reject){worker=new Worker('/js/music-mp3-worker.js?v=202610141421');var timer=setTimeout(function(){worker.terminate();reject(Error('MP3 preparation timed out'));},180000);var cancel=document.getElementById('mp3-cancel');cancel.onclick=function(){cancelled=true;worker.terminate();clearTimeout(timer);reject(Error('Cancelled'));};worker.onerror=function(){clearTimeout(timer);reject(Error('Could not load the local MP3 encoder'));};worker.onmessage=function(e){if(e.data.error){clearTimeout(timer);reject(Error(e.data.error));}else if(e.data.audio){clearTimeout(timer);resolve(e.data.audio);}else{var label=document.getElementById('mp3-status');if(label)label.textContent='Preparing MP3: '+Math.round(e.data.progress*100)+'%';}};worker.postMessage(payload);});
   return new File([result],(meta.title||file.name.replace(/\.[^.]+$/,'')).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,120)+'.mp3',{type:'audio/mpeg'});
  }finally{if(worker)worker.terminate();worker=null;busy=false;var el=document.getElementById('mp3-progress');if(el)el.remove();}
 }
 window.MUSIC_prepareMP3=prepare;
 async function getFile(url,name,max,expected){
  var u=new URL(url,location.origin),local=u.origin===location.origin&&u.pathname.startsWith('/api/media/'),remote=expected&&u.href===new URL(expected,location.origin).href&&u.protocol==='https:'&&u.pathname==='/media';
  if(!local&&!remote)throw Error('This track cannot be downloaded safely');var chunks=[],total=0,offset=0,contentType='';
  do{var r=await fetch(u.href,{credentials:local?'include':'omit',cache:'no-store',headers:remote&&!u.searchParams.has('thumb')?{Range:'bytes='+offset+'-'+(offset+524287)}:{}});if(!r.ok)throw Error(r.status===403?'Downloading is not allowed for this audio':r.status===404?'Audio is unavailable or is not a music file':'Track is unavailable');
   contentType=r.headers.get('Content-Type')||contentType;var range=r.headers.get('Content-Range'),match=range&&range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);if(r.status===206&&(!match||Number(match[1])!==offset||Number(match[3])>max))throw Error('Incomplete or oversized audio download');if(Number(r.headers.get('Content-Length'))>max)throw Error('File is too large for local preparation');if(!r.body)throw Error('Streaming download is unavailable');var reader=r.body.getReader(),read=0;try{while(true){var part=await reader.read();if(part.done)break;read+=part.value.length;total+=part.value.length;if(total>max){await reader.cancel();throw Error('File is too large for local preparation');}chunks.push(part.value);}}finally{reader.releaseLock();}
   if(r.status!==206)break;if(!remote||read!==Number(match[2])-offset+1||!read)throw Error('Incomplete audio download');offset=Number(match[2])+1;if(offset===Number(match[3]))break;if(offset>Number(match[3]))throw Error('Invalid audio range');
  }while(true);return new File(chunks,name,{type:contentType});}

 window.MUSIC_getMP3File=getFile;
 if(!document.getElementById('screen-music'))return;
 window.downloadMusicMP3=async function(id){try{var t=MUSIC_allTracks.find(function(x){return x.id===id;});if(!t||!t.audio_url)throw Error('Track is unavailable');if(busy)throw Error('Another MP3 is being prepared');toast('Loading track for local MP3 download...');var audio=await getFile(t.audio_url,'track',64*1024*1024),cover=t.cover_url?await getFile(t.cover_url,'cover',12*1024*1024):null,out=await prepare(audio,cover,{title:t.title,artist:t.artist,album:t.album_name}),url=URL.createObjectURL(out),a=document.createElement('a');a.href=url;a.download=out.name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},60000);toast('MP3 ready. Original unchanged.');}catch(e){toast(e.message||'Could not prepare MP3');}};
 var post=api.post;api.post=function(path,body,form){if(path!=='/music'||!form||!(body instanceof FormData))return post.apply(this,arguments);var self=this;return prepare(body.get('audio'),body.get('cover'),{title:body.get('title'),artist:body.get('artist'),album:body.get('album_name')}).then(function(audio){body.set('audio',audio);return post.call(self,path,body,form);});};
 var notice=document.createElement('p');notice.style.cssText='font-size:11px;color:var(--text-secondary);padding:8px 16px';notice.innerHTML='MP3 downloads are prepared on this device. Originals stay unchanged. Conversion: up to 10 minutes / 32 MB; existing MP3: 64 MB. Uses <a href="https://lame.sourceforge.net/" target="_blank" rel="noopener">LAME</a> (<a href="/js/vendor/LAME-LICENSE.txt">license</a>) and <a href="/js/vendor/MP3TAG-LICENSE.txt">mp3tag.js</a>.';var screen=document.getElementById('screen-music');if(screen)screen.appendChild(notice);
 var build=window.buildTracks;window.buildTracks=function(id,list){build(id,list);var el=document.getElementById(id);if(!el)return;el.querySelectorAll('.track-item').forEach(function(row,i){if(!list[i])return;var button=document.createElement('button');button.textContent='MP3';button.title='Download MP3 with cover';button.setAttribute('aria-label','Download '+list[i].title+' as MP3 with cover');button.style.cssText='min-width:44px;min-height:44px;border:0;background:transparent;color:var(--blue);font-size:12px;cursor:pointer';button.onclick=function(e){e.stopPropagation();downloadMusicMP3(list[i].id);};row.appendChild(button);});};
})();

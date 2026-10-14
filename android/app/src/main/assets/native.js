(function(){
 'use strict';
 if(window.__ypNativeReady||!window.YidplusNative)return;window.__ypNativeReady=true;
 var bridge=window.YidplusNative, active=null;
 function send(m){bridge.postMessage(JSON.stringify(m));}
 function wait(){return new Promise(function(resolve,reject){var timeout=setTimeout(function(){active=null;reject(Error('Save timed out'));},125000);active=function(m){clearTimeout(timeout);active=null;if(m.error)reject(Error(m.error));else resolve(m);};});}
 bridge.onmessage=function(e){try{if(active)active(JSON.parse(e.data));}catch(_){};};
 window.YidplusSaveBlob=async function(blob,name){
  if(active||window.__ypSaving)throw Error('Another save is in progress');window.__ypSaving=true;if(blob.size>64*1024*1024){window.__ypSaving=false;throw Error('File exceeds 64 MB');}
  var id=crypto.randomUUID(),pending=wait();send({type:'saveBegin',id:id,size:blob.size,name:name});
  try{await pending;for(var i=0;i<blob.size;i+=49152){var bytes=new Uint8Array(await blob.slice(i,i+49152).arrayBuffer()),binary='';for(var j=0;j<bytes.length;j++)binary+=String.fromCharCode(bytes[j]);pending=wait();send({type:'saveChunk',id:id,data:btoa(binary)});await pending;}pending=wait();send({type:'saveEnd',id:id});await pending;}catch(e){send({type:'saveAbort'});throw e;}finally{window.__ypSaving=false;}
 };
 document.addEventListener('click',async function(e){var a=e.target.closest&&e.target.closest('a[download]');if(!a||!a.href.startsWith('blob:'))return;e.preventDefault();try{await window.YidplusSaveBlob(await(await fetch(a.href)).blob(),a.download||'download');}catch(error){if(window.toast)toast(error.message);}},true);
 // Web Push is browser-owned. This standalone app uses its native push setup.
 if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});
 window.addEventListener('offline',function(){if(window.toast)toast('Offline. Private chats and media need an internet connection.');});
})();
(function(){
 if(!window.__ypNativeReady)return;
 var restored=false;var device=localStorage.getItem('ypNativeDevice');var button=document.createElement('button');button.textContent='Enable app notifications';button.style.cssText='position:fixed;bottom:80px;right:12px;z-index:1000;border:0;border-radius:20px;padding:12px;background:#087c91;color:white;font:14px system-ui';
 async function refresh(){try{var response=await fetch('/api/auth/me',{cache:'no-store'}),body=await response.json(),signed=!!(body.ok&&body.user);YidplusNative.postMessage(JSON.stringify({type:'pushSignedIn',value:signed}));button.hidden=!signed;if(signed&&!button.isConnected)document.body.appendChild(button);if(signed&&device&&!restored&&!button.disabled){restored=true;button.onclick();}}catch(_){button.hidden=true;}}
 button.onclick=function(){if(window.__ypSaving)return;if(button.disabled)return;button.disabled=true;
  var previous=YidplusNative.onmessage;
  YidplusNative.onmessage=async function(e){try{var m=JSON.parse(e.data);if(m.error){if(window.toast)toast(m.error);YidplusNative.onmessage=previous;button.disabled=false;return;}if(!m.token)return previous&&previous(e);var r=await fetch('/api/push/native-device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:m.id,token:m.token})});if(!r.ok)throw Error('Could not register notifications');device=m.id;localStorage.setItem('ypNativeDevice',device);button.textContent='Notifications enabled';if(window.toast)toast('App notifications enabled');}catch(error){if(window.toast)toast(error.message);}finally{button.disabled=false;YidplusNative.onmessage=previous;}};
  YidplusNative.postMessage(JSON.stringify({type:'pushSetup'}));
 };
 var originalFetch=window.fetch;window.fetch=async function(input,options){if(String(input).includes('/api/auth/logout')&&device){try{await originalFetch('/api/push/native-device',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:device})});}catch(_){}YidplusNative.postMessage(JSON.stringify({type:'pushSignedIn',value:false}));}var response=await originalFetch.apply(this,arguments);if(String(input).match(/\/api\/auth\/(login|logout|google-2fa)(\?|$)/)&&response.ok)setTimeout(refresh,0);return response;};refresh();document.addEventListener("visibilitychange",function(){if(!document.hidden)refresh();});
})();

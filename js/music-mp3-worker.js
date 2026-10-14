importScripts('vendor/1-lame-1.2.1.min.js','vendor/2-mp3tag-3.17.0.min.js');
self.onmessage=function(e){
 try{
  var d=e.data,audio=d.audio;
  if(d.channels){
   var enc=new lamejs.Mp3Encoder(d.channels.length,d.sampleRate,192),parts=[];
   for(var i=0;i<d.channels[0].length;i+=1152){
    var chunks=d.channels.map(function(ch){return Int16Array.from(ch.subarray(i,i+1152),function(v){v=Math.max(-1,Math.min(1,v));return Math.round(v*(v<0?32768:32767));});});
    var out=enc.encodeBuffer(chunks[0],chunks[1]);if(out.length)parts.push(new Uint8Array(out));
    if(i%115200===0)self.postMessage({progress:i/d.channels[0].length});
   }
   parts.push(new Uint8Array(enc.flush()));var size=parts.reduce(function(n,p){return n+p.length;},0),bytes=new Uint8Array(size),off=0;parts.forEach(function(p){bytes.set(p,off);off+=p.length;});audio=bytes.buffer;
  }
  var tag=new MP3Tag(audio);tag.read({unsupported:true});if(tag.error)throw Error(tag.error);
  tag.tags.v2=tag.tags.v2||{};
  if(d.title)tag.tags.v2.TIT2=d.title;if(d.artist)tag.tags.v2.TPE1=d.artist;if(d.album)tag.tags.v2.TALB=d.album;
  if(d.cover)tag.tags.v2.APIC=[{format:d.coverType,type:3,description:'Front cover',data:Array.from(new Uint8Array(d.cover))}];
  tag.save({id3v2:{include:true,version:3,padding:0,unsupported:true,encoding:'utf16'}});if(tag.error)throw Error(tag.error);
  var check=new MP3Tag(tag.buffer);check.read();if(check.error)throw Error(check.error);
  if(d.cover&&(!check.tags.v2.APIC||!check.tags.v2.APIC[0].data.length))throw Error('Cover verification failed');
  self.postMessage({audio:tag.buffer},[tag.buffer]);
 }catch(err){self.postMessage({error:err.message||'MP3 preparation failed'});}
};

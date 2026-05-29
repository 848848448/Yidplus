// js/home.js — Home Dashboard with Supabase Realtime broadcasts
import { supabase, T } from '../supabase/client.js';

const STATUSES = [
  { nick:'MosheMusic', emoji:'🎹', slides:[{bg:'#1a0a2e',text:'New niggun dropping Friday! 🎵',color:'#F0D080'},{bg:'#0a1a1a',text:'Studio was fire 🎧',color:'#5DCAA5'}], time:'5m', viewed:false },
  { nick:'RebbeVibes', emoji:'📖', slides:[{bg:'#1a0f00',text:'Torah thought: Be kind 💛',color:'#F0D080'}], time:'12m', viewed:false },
  { nick:'ShlomoBeats',emoji:'🎤', slides:[{bg:'#001020',text:'Live performance SUNDAY! 🎤',color:'#85B7EB'}], time:'2h',  viewed:false },
  { nick:'KosherChef', emoji:'🥘', slides:[{bg:'#1a0a0a',text:'Cholent reveal TOMORROW 👀',color:'#F09595'}], time:'3h',  viewed:true  },
];
const ADS = [
  { title:"Moshe's Judaica",  sub:"Free worldwide shipping!",          icon:"🕎",  bg:"#1a1000", dur:5000 },
  { title:"Kosher Vacations", sub:"Exclusive glatt kosher resorts",     icon:"🏖️", bg:"#001a1a", dur:6000 },
  { title:"Torah Academy",    sub:"Learn with the best · Free trial!",  icon:"📚", bg:"#0a001a", dur:5000 },
];

let adIdx=0, adRaf=null, adStart=0, svUser=null, svSlide=0, svTimer=null, bcChannel=null;

window.init_home = function() {
  loadDynamicFeed();
  buildStatusRow(); buildAds(); buildShortsPrev(); buildChannelsPrev(); buildFeed();
  listenBroadcasts();
  applyRoleUI();
};

/* ── BROADCASTS ── */
async function listenBroadcasts() {
  const { data } = await supabase.from('broadcasts').select('text').order('created_at',{ascending:false}).limit(1);
  if (data?.[0]) showBroadcast(data[0].text);
  if (bcChannel) supabase.removeChannel(bcChannel);
  bcChannel = supabase.channel('public:broadcasts')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'broadcasts'}, p => showBroadcast(p.new.text))
    .subscribe();
}
function showBroadcast(text) {
  const bar = document.getElementById('broadcast-bar'); if (!bar) return;
  bar.innerHTML = `<div style="margin:.5rem .75rem;background:rgba(201,168,76,.08);border:.5px solid var(--border2);border-radius:10px;padding:.65rem 1rem;display:flex;align-items:flex-start;gap:.6rem"><span style="font-size:1rem;flex-shrink:0">📢</span><span style="font-size:.8rem;color:var(--gold-l);line-height:1.4;flex:1">${text}</span><button style="background:none;border:none;color:var(--muted);cursor:pointer" onclick="this.parentElement.remove()">✕</button></div>`;
}

/* ── STATUS ROW ── */
function buildStatusRow() {
  const row = document.getElementById('status-row'); if (!row) return;
  row.innerHTML = `<div class="status-item" onclick="toast('Upload a status!')"><div class="status-ring mine"><div class="status-inner">👤<div class="status-plus">+</div></div></div><div class="status-name">My Status</div></div>`;
  STATUSES.forEach((s,i) => {
    const el=document.createElement('div'); el.className='status-item'; el.onclick=()=>openSV(i);
    el.innerHTML=`<div class="status-ring${s.viewed?' viewed':''}"><div class="status-inner">${s.emoji}</div></div><div class="status-name">${s.nick}</div>`;
    row.appendChild(el);
  });
}

/* ── ADS ── */
function buildAds() {
  const frame=document.getElementById('ad-frame'), dots=document.getElementById('ad-dots'); if(!frame||!dots)return;
  ADS.forEach((ad,i)=>{
    const s=document.createElement('div'); s.className='ad-slide'+(i===0?' active':''); s.style.background=ad.bg;
    s.innerHTML=`<div style="font-size:2.5rem">${ad.icon}</div><div class="ad-badge">Sponsored</div><div class="ad-title">${ad.title}</div><div class="ad-sub">${ad.sub}</div>`;
    frame.appendChild(s);
    const d=document.createElement('div'); d.className='ad-dot'+(i===0?' active':''); dots.appendChild(d);
  });
  runAd();
}
function runAd() {
  cancelAnimationFrame(adRaf); adStart=performance.now();
  const dur=ADS[adIdx].dur, bar=document.getElementById('ad-prog');
  function tick(now){const pct=Math.min(100,(now-adStart)/dur*100);if(bar)bar.style.width=pct+'%';if(pct<100){adRaf=requestAnimationFrame(tick);}else{adIdx=(adIdx+1)%ADS.length;document.querySelectorAll('#ad-frame .ad-slide').forEach((s,i)=>s.classList.toggle('active',i===adIdx));document.querySelectorAll('#ad-dots .ad-dot').forEach((d,i)=>d.classList.toggle('active',i===adIdx));runAd();}}
  adRaf=requestAnimationFrame(tick);
}

/* ── SHORTS / CHANNELS / FEED PREVIEW ── */
function buildShortsPrev(){const row=document.getElementById('home-shorts');if(!row)return;row.innerHTML='';[{e:'🎹',v:'12.4K',n:'@Moshe'},{e:'🕺',v:'8.7K',n:'@YidDancer'},{e:'🎤',v:'22K',n:'@Shlomo'},{e:'🥘',v:'5.1K',n:'@Chef'},{e:'📖',v:'3.2K',n:'@Rebbe'},{e:'🎻',v:'9.8K',n:'@Fiddle'}].forEach(s=>{const c=document.createElement('div');c.className='short-prev-card';c.onclick=()=>navTo('shorts');c.innerHTML=`<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:2.5rem">${s.e}</div><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);display:flex;flex-direction:column;justify-content:flex-end;padding:.5rem"><div style="font-size:.68rem;color:var(--gold-l)">${s.n}</div><div style="font-size:.65rem;color:rgba(255,255,255,.8)">👁 ${s.v}</div></div><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;background:rgba(201,168,76,.8);display:flex;align-items:center;justify-content:center">▶</div>`;row.appendChild(c);});}
function buildChannelsPrev(){const row=document.getElementById('home-channels');if(!row)return;row.innerHTML='';[{e:'🎹',n:'MosheMusic',f:'12.4K',v:true},{e:'🎤',n:'ShlomoBeats',f:'8.1K',v:false},{e:'📖',n:'RebbeVibes',f:'31K',v:true},{e:'🥘',n:'KosherFood',f:'5.6K',v:false}].forEach(c=>{const card=document.createElement('div');card.className='ch-preview-card';card.onclick=()=>openChannel(c.n);card.innerHTML=`<div style="width:50px;height:50px;border-radius:50%;background:var(--bg3);margin:0 auto .5rem;display:flex;align-items:center;justify-content:center;font-size:1.5rem;border:1.5px solid var(--border);position:relative">${c.e}${c.v?'<div style="position:absolute;top:-6px;right:-4px;font-size:.8rem">👑</div>':''}</div><div style="font-size:.8rem;font-weight:700">${c.n}</div><div style="font-size:.65rem;color:var(--muted)">${c.f} followers</div><button class="follow-pill" onclick="event.stopPropagation();this.classList.toggle('following');this.textContent=this.classList.contains('following')?'✓ Following':'+ Follow'">+ Follow</button>`;row.appendChild(card);});}
function buildFeed(){const feed=document.getElementById('home-feed');if(!feed)return;feed.innerHTML='';[{e:'🎹',n:'MosheMusic',t:'10 min ago',cap:'Just dropped a new clip! 🔥',l:142,c:23},{e:'📖',n:'RebbeVibes',t:'1 hour ago',cap:'Weekly Torah class is up!',l:87,c:11},{e:'🎤',n:'ShlomoBeats',t:'3 hours ago',cap:'Studio behind the scenes 👀',l:204,c:38}].forEach(p=>{const post=document.createElement('article');post.className='feed-post';post.innerHTML=`<div style="display:flex;align-items:center;gap:.6rem;padding:.75rem;cursor:pointer" onclick="openChannel('${p.n}')"><div style="width:38px;height:38px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--border)">${p.e}</div><div><div style="font-size:.85rem;font-weight:700">${p.n}</div><div style="font-size:.65rem;color:var(--muted)">${p.t}</div></div></div><div class="post-thumb">${p.e}<div class="post-play">▶</div></div><div style="padding:.6rem .75rem;font-size:.82rem;color:var(--muted);border-bottom:.5px solid var(--border)">${p.cap}</div><div style="display:flex;gap:1rem;padding:.75rem"><button class="post-action" onclick="this.classList.toggle('liked');this.innerHTML=this.classList.contains('liked')?'❤️ ${p.l+1}':'🤍 ${p.l}'">🤍 ${p.l}</button><button class="post-action" onclick="toast('Comments')">💬 ${p.c}</button><button class="post-action" onclick="toast('Copied!')">📤</button></div>`;feed.appendChild(post);});}

/* ── STATUS VIEWER ── */
function openSV(i){svUser=STATUSES[i];svSlide=0;STATUSES[i].viewed=true;document.querySelectorAll('#status-row .status-ring')[i+1]?.classList.add('viewed');document.getElementById('sv-avatar').textContent=svUser.emoji;document.getElementById('sv-nick').textContent='@'+svUser.nick;document.getElementById('sv-time').textContent=svUser.time+' ago';document.getElementById('sv-overlay').classList.add('open');showSVSlide(0);}
window.openStatusViewer=openSV;
function showSVSlide(idx){clearTimeout(svTimer);const sl=svUser.slides[idx],el=document.getElementById('sv-slide'),bars=document.getElementById('sv-bars');if(!el||!bars)return;bars.innerHTML=svUser.slides.map((_,j)=>`<div class="sv-bar"><div class="sv-bar-fill ${j<idx?'done':j===idx?'running':''}"></div></div>`).join('');el.style.opacity='0';el.style.background=sl.bg||'#111';el.style.color=sl.color||'#fff';setTimeout(()=>{el.textContent=sl.text||'';el.style.opacity='1';},120);svTimer=setTimeout(svNext,5000);}
window.svNext=()=>{svUser&&svSlide<svUser.slides.length-1?showSVSlide(++svSlide):closeSV();};
window.svPrev=()=>{svUser&&svSlide>0?showSVSlide(--svSlide):null;};
window.closeSV=()=>{document.getElementById('sv-overlay').classList.remove('open');clearTimeout(svTimer);};
window.svMute=()=>{const b=document.getElementById('sv-mute');if(b)b.textContent=b.textContent==='🔊'?'🔇':'🔊';};

// נייע פונקציע פאר סופאבייס פיעד
async function loadDynamicFeed() {
  const feed = document.getElementById('home-feed');
  if (!feed) return;
  
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error && data) {
    feed.innerHTML = ''; // מעק די אלטע סטאטישע זאכן
    data.forEach(p => {
      const post = document.createElement('article');
      post.className = 'feed-post';
      post.innerHTML = `<div><b>${p.username || 'User'}</b></div><div>${p.content || ''}</div>`;
      feed.appendChild(post);
    });
  }
}

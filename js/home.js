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
  buildStatusRow(); buildAds(); buildShortsPrev(); buildChannelsPrev();
  loadDynamicFeed(); // <--- דאס לויפט יעצט לעצט, און עס וועט אויפפיקן די פאסטס!
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

/* ── STATUS ROW & ADS (בלייבט די זעלבע) ── */
function buildStatusRow() { /* ... */ }
function buildAds() { /* ... */ }
function runAd() { /* ... */ }

/* ── DYNAMIC FEED (פארעכט) ── */
async function loadDynamicFeed() {
  const feed = document.getElementById('home-feed');
  if (!feed) return;
  
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { console.error('Error fetching posts:', error); return; }

  if (data) {
    feed.innerHTML = ''; 
    data.forEach(p => {
      const post = document.createElement('article');
      post.className = 'feed-post';
      post.innerHTML = `
        <div style="padding:10px;"><b>${p.username || 'User'}</b></div>
        <div style="padding:20px; background:#222; text-align:center;">${p.content || ''}</div>
        <div style="padding:10px; font-size:0.8rem; color:var(--muted);">${p.caption || ''}</div>
      `;
      feed.appendChild(post);
    });
  }
}

/* ── STATUS VIEWER (בלייבט די זעלבע) ── */
function openSV(i){ /* ... */ }
window.openStatusViewer=openSV;
function showSVSlide(idx){ /* ... */ }
window.svNext=()=>{/* ... */};
window.svPrev=()=>{/* ... */};
window.closeSV=()=>{/* ... */};
window.svMute=()=>{/* ... */};

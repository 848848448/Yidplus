// supabase/client.js — FILE 1 OF 6
// Must load FIRST — sets window.sb and all globals
(function () {
  if (typeof supabase === 'undefined') {
    console.error('[YID PLUS] Supabase CDN not loaded!');
    return;
  }
  window.sb = supabase.createClient(
    'https://plsdwsnstszatabywdfs.supabase.co',
    'sb_publishable_y0N66nnsFmaZ1sl4jH8HvA_e0tWtzL-',
    { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:localStorage } }
  );
  window.OWNER_EMAIL = 'avrumy5872877@gmail.com';
  window.ADMIN_PIN   = '1234';
  window.T = { users:'users', channels:'channels', media:'media', messages:'messages', posts:'posts', broadcasts:'broadcasts', settings:'settings' };
  window.ROLES = { member:'member', adminLimited:'admin_limited', adminSuper:'admin_super' };
  console.log('[YID PLUS] Supabase ready ✓');
})();

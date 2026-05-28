// supabase/client.js
(function() {
  // Guard: make sure CDN loaded
  if (typeof supabase === 'undefined') {
    console.error('YID PLUS: Supabase CDN not loaded yet!');
    return;
  }

  var SUPABASE_URL = 'https://plsdwsnstszatabywdfs.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_y0N66nnsFmaZ1sl4jH8HvA_e0tWtzL-';

  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      storage:            window.localStorage,
    },
  });

  window.OWNER_EMAIL = 'avrumy5872877@gmail.com';
  window.ADMIN_PIN   = '1234';
  window.T = {
    users: 'users', channels: 'channels',
    media: 'media', messages: 'messages',
  };
  window.ROLES = {
    member:       'member',
    adminLimited: 'admin_limited',
    adminSuper:   'admin_super',
  };
})();

// supabase/client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://plsdwsnstszatabywdfs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y0N66nnsFmaZ1sl4jH8HvA_e0tWtzL-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storage:            window.localStorage,
  },
});

export const OWNER_EMAIL = 'avrumy5872877@gmail.com';
export const ADMIN_PIN   = '1234';

export const T = {
  users:    'users',
  channels: 'channels',
  media:    'media',
  messages: 'messages',
};

export const ROLES = {
  member:       'member',
  adminLimited: 'admin_limited',
  adminSuper:   'admin_super',
};

export default supabase;

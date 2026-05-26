// ============================================================
// supabase/client.js
// REPLACES: firebase/config.js
// This is the ONLY connection file you need for Supabase.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://plsdwsnstszatabywdfs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y0N66nnsFmaZ1sl4jH8HvA_e0tWtzL-';

// Single shared Supabase client — import this everywhere
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // Keep users logged in across browser sessions / refreshes
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
    storage:           window.localStorage,
  },
});

// ── OWNER CONFIG (hardcoded — cannot be changed) ──
export const OWNER_EMAIL = 'avrumy5872877@gmail.com';
export const ADMIN_PIN   = '1234';

// ── TABLE NAMES ──
export const T = {
  users:    'users',
  channels: 'channels',
  media:    'media',
  messages: 'messages',
};

// ── ROLE LEVELS ──
// member         → normal user
// admin_limited  → can delete content only (no PII access)
// admin_super    → full access
export const ROLES = {
  member:        'member',
  adminLimited:  'admin_limited',
  adminSuper:    'admin_super',
};

export default supabase;

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// No hardcoded fallback. Credentials in source end up in the shipped bundle and
// in git history; a missing .env should fail loudly at boot instead.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // AGNUS uses HashRouter, so the URL fragment belongs to the router.
    detectSessionInUrl: false,
  },
});

export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

export default supabase;

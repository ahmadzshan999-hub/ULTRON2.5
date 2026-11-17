import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

const validUrl = (() => {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && !url.includes('YOUR_PROJECT');
  } catch {
    return false;
  }
})();

export const supabaseConfigured = Boolean(url && key && validUrl && !key.includes('YOUR_SUPABASE'));

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

import { createClient } from '@supabase/supabase-js';

// Env vars are injected by Vite (VITE_ prefix). Absent in builds without
// configuration -> the whole app silently falls back to local-only mode.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Persist the session in localStorage so it survives reloads in both
        // the web build and Electron (file://localhost both expose localStorage).
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  : null;

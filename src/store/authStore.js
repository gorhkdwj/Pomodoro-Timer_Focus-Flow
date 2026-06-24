import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

// Guards against double-subscribing onAuthStateChange if init() runs twice.
let _subscribed = false;

export const useAuthStore = create((set, get) => ({
  session: null,
  user: null,
  // 'disabled' (no Supabase env) | 'loading' | 'signedIn' | 'signedOut'
  status: isSupabaseConfigured ? 'loading' : 'disabled',
  error: null,
  usageBytes: 0,

  init: async () => {
    if (!isSupabaseConfigured) {
      set({ status: 'disabled' });
      return;
    }
    if (!_subscribed) {
      _subscribed = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session?.user ?? null,
          status: session ? 'signedIn' : 'signedOut',
        });
      });
    }
    const { data } = await supabase.auth.getSession();
    set({
      session: data.session ?? null,
      user: data.session?.user ?? null,
      status: data.session ? 'signedIn' : 'signedOut',
    });
  },

  signUp: async (email, password) => {
    set({ error: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) set({ error: error.message });
    return { data, error };
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) set({ error: error.message });
    return { data, error };
  },

  signInWithGoogle: async () => {
    set({ error: null });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) set({ error: error.message });
    return { data, error };
  },

  signOut: async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    set({ session: null, user: null, status: 'signedOut', usageBytes: 0 });
  },

  // Pull the cached per-user total from storage_usage (for the quota gauge).
  refreshUsage: async () => {
    if (!isSupabaseConfigured) return;
    const user = get().user;
    if (!user) {
      set({ usageBytes: 0 });
      return;
    }
    const { data } = await supabase
      .from('storage_usage')
      .select('total_bytes')
      .eq('user_id', user.id)
      .maybeSingle();
    set({ usageBytes: data?.total_bytes ?? 0 });
  },

  setError: (msg) => set({ error: msg }),
}));

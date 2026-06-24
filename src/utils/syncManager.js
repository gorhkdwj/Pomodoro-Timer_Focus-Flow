import { supabase, isSupabaseConfigured } from './supabaseClient';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLogStore } from '../store/logStore';
import { refreshAssetIndex } from './cloudAssets';

// Settings fields synced to user_settings.data (mirrors settingsStore state,
// excluding action functions). Streak fields are appended from logStore.
const SETTINGS_KEYS = [
  'focusTime', 'breakTime', 'longBreakTime', 'longBreakInterval',
  'autoStartBreaks', 'autoStartPoms', 'selectedPresetId', 'presets',
  'focusVolume', 'breakVolume', 'focusSound', 'breakSound',
  'language', 'bgTheme', 'designTheme', 'customThemes', 'customSounds',
];

const getDeviceId = () => {
  let id = localStorage.getItem('focusflow-device-id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('focusflow-device-id', id);
  }
  return id;
};

const snapshotSettings = () => {
  const st = useSettingsStore.getState();
  const data = {};
  for (const k of SETTINGS_KEYS) data[k] = st[k];
  const log = useLogStore.getState();
  data.currentStreak = log.currentStreak;
  data.lastActiveDate = log.lastActiveDate;
  return data;
};

// Union two {id,...} arrays; server entries win on id collision.
const unionById = (local = [], server = []) => {
  const map = new Map();
  for (const x of server) map.set(x.id, x);
  for (const x of local) if (!map.has(x.id)) map.set(x.id, x);
  return [...map.values()];
};

const currentUser = () => useAuthStore.getState().user;

export const pushSettings = async () => {
  if (!isSupabaseConfigured) return;
  const user = currentUser();
  if (!user) return;
  await supabase.from('user_settings').upsert(
    { user_id: user.id, data: snapshotSettings(), updated_at: new Date().toISOString(), device_id: getDeviceId() },
    { onConflict: 'user_id' },
  );
};

export const pushLogs = async () => {
  if (!isSupabaseConfigured) return;
  const user = currentUser();
  if (!user) return;
  const logs = useLogStore.getState().logs;
  if (!logs.length) return;
  const rows = logs.map((l) => ({
    user_id: user.id,
    client_id: String(l.id),
    date: new Date(l.date).toISOString(),
    type: l.type,
    duration: l.duration,
  }));
  await supabase.from('activity_logs').upsert(rows, { onConflict: 'user_id,client_id' });
};

// One-shot merge when a session becomes available.
export const pullOnLogin = async () => {
  if (!isSupabaseConfigured) return;
  const user = currentUser();
  if (!user) return;

  await refreshAssetIndex();

  // ── Settings: scalars LWW (server wins), asset arrays unioned by id ──
  const { data: srow } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  const local = snapshotSettings();
  if (srow?.data && Object.keys(srow.data).length) {
    const server = srow.data;
    const apply = {};
    for (const k of SETTINGS_KEYS) {
      if (k === 'customThemes' || k === 'customSounds') continue;
      if (server[k] !== undefined) apply[k] = server[k];
    }
    apply.customThemes = unionById(local.customThemes, server.customThemes);
    apply.customSounds = unionById(local.customSounds, server.customSounds);
    useSettingsStore.setState(apply);
  } else {
    await pushSettings(); // first upload
  }

  // ── Logs: union by client_id, then recompute streak ──
  const { data: srvLogs } = await supabase
    .from('activity_logs').select('client_id, date, type, duration').eq('user_id', user.id);
  const byKey = new Map();
  for (const l of useLogStore.getState().logs) {
    byKey.set(String(l.id), { id: l.id, date: l.date, type: l.type, duration: l.duration });
  }
  for (const r of srvLogs ?? []) {
    if (!byKey.has(r.client_id)) {
      byKey.set(r.client_id, { id: r.client_id, date: r.date, type: r.type, duration: r.duration });
    }
  }
  useLogStore.getState().setLogs([...byKey.values()]);

  // Reconcile server with the merged result.
  await pushLogs();
  await pushSettings();
};

// ── Debounced push + offline queue ──
let started = false;
let settingsTimer = null;
let logsTimer = null;
const pending = new Set();

const queueOrPush = async (fn) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    pending.add(fn);
    return;
  }
  try { await fn(); } catch (e) { console.warn('sync push failed, queued:', e?.message); pending.add(fn); }
};

const flushQueue = async () => {
  const fns = [...pending];
  pending.clear();
  for (const fn of fns) {
    try { await fn(); } catch (e) { console.warn('sync flush failed:', e?.message); pending.add(fn); }
  }
};

export const startSync = () => {
  if (!isSupabaseConfigured || started) return;
  started = true;

  useSettingsStore.subscribe(() => {
    if (useAuthStore.getState().status !== 'signedIn') return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => queueOrPush(pushSettings), 800);
  });

  useLogStore.subscribe(() => {
    if (useAuthStore.getState().status !== 'signedIn') return;
    clearTimeout(logsTimer);
    logsTimer = setTimeout(() => queueOrPush(pushLogs), 800);
  });

  if (typeof window !== 'undefined') window.addEventListener('online', flushQueue);
};

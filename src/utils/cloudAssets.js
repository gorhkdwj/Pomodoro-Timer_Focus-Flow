import { supabase, isSupabaseConfigured } from './supabaseClient';
import { useAuthStore } from '../store/authStore';

// ── Quota constants (mirrored by server: column CHECK + bucket limit + trigger) ──
export const MAX_FILE_BYTES = 5 * 1024 * 1024; //  5MB per file
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50MB per user

const BUCKET = 'user-assets';
const SIGNED_TTL = 3600; // seconds

const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
};

// path -> { url, exp(ms) }
const signedCache = new Map();
// clientId -> storage_path (filled lazily / on login)
let assetIndex = null;

const currentUser = () => useAuthStore.getState().user;

// Live total from the server (used for client-side pre-check before upload).
export const getStorageUsage = async () => {
  if (!isSupabaseConfigured) return 0;
  const user = currentUser();
  if (!user) return 0;
  const { data, error } = await supabase
    .from('storage_usage')
    .select('total_bytes')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('getStorageUsage:', error.message);
    return 0;
  }
  return data?.total_bytes ?? 0;
};

// Upload one file: Storage object first, then assets row (server re-checks quota).
// Throws 'FILE_TOO_LARGE' | 'QUOTA_EXCEEDED' | 'NOT_SIGNED_IN' | <supabase error>.
export const uploadAsset = async (file, kind) => {
  const user = currentUser();
  if (!user) throw new Error('NOT_SIGNED_IN');
  if (file.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const used = await getStorageUsage();
  if (used + file.size > MAX_TOTAL_BYTES) throw new Error('QUOTA_EXCEEDED');

  const clientId = 'custom_' + Date.now();
  const storagePath = `${user.id}/${kind}/${clientId}${extOf(file.name)}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('assets').insert({
    user_id: user.id,
    client_id: clientId,
    kind,
    name: file.name,
    storage_path: storagePath,
    byte_size: file.size,
    mime_type: file.type || null,
  });
  if (insErr) {
    // Compensating delete so the orphaned object doesn't leak into the quota.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw insErr;
  }

  if (assetIndex) assetIndex.set(clientId, storagePath);
  return { clientId, name: file.name, storagePath };
};

export const deleteAsset = async (clientId) => {
  const user = currentUser();
  if (!user) return;
  const { data: row } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle();
  if (row?.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
    signedCache.delete(row.storage_path);
  }
  await supabase.from('assets').delete().eq('user_id', user.id).eq('client_id', clientId);
  assetIndex?.delete(clientId);
};

export const getSignedUrl = async (storagePath) => {
  if (!storagePath) return null;
  const now = Date.now();
  const cached = signedCache.get(storagePath);
  if (cached && cached.exp > now + 60_000) return cached.url;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_TTL);
  if (error) {
    console.warn('getSignedUrl:', error.message);
    return null;
  }
  signedCache.set(storagePath, { url: data.signedUrl, exp: now + SIGNED_TTL * 1000 });
  return data.signedUrl;
};

// Build clientId -> storage_path map for the current user (themes & sounds).
export const refreshAssetIndex = async () => {
  assetIndex = new Map();
  if (!isSupabaseConfigured) return assetIndex;
  const user = currentUser();
  if (!user) return assetIndex;
  const { data } = await supabase
    .from('assets')
    .select('client_id, storage_path')
    .eq('user_id', user.id);
  assetIndex = new Map((data ?? []).map((r) => [r.client_id, r.storage_path]));
  return assetIndex;
};

export const clearAssetIndex = () => {
  assetIndex = null;
  signedCache.clear();
};

// Single entry point that turns a *stored* asset value into a usable URL.
//   'asset-id:<clientId>'          -> signed URL  (cloud sounds)
//   '<uid>/<kind>/<file>' (path)   -> signed URL  (cloud themes)
//   http(s)://, asset://, blob:, data:, bare name, builtins -> unchanged
export const resolveAssetValue = async (value) => {
  if (!value || typeof value !== 'string') return value;

  if (value.startsWith('asset-id:')) {
    const clientId = value.slice('asset-id:'.length);
    if (!assetIndex) await refreshAssetIndex();
    const path = assetIndex?.get(clientId);
    return path ? await getSignedUrl(path) : null;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value); // http:, asset:, blob:, data:
  if (!hasScheme && value.includes('/')) {
    // Raw storage path (cloud theme dataUrl)
    return await getSignedUrl(value);
  }

  return value; // pass-through: local fallback URLs, bare filenames, builtins
};

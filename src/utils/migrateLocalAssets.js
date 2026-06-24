import { isElectron, getAssetDirs } from './fsHelper';
import { uploadAsset } from './cloudAssets';
import { useSettingsStore } from '../store/settingsStore';

const guessMime = (p) => {
  const ext = (p.split('.').pop() || '').toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  };
  return map[ext] || 'application/octet-stream';
};

// True only in Electron when there are still asset:// (local-only) customs.
export const hasLocalAssetsToMigrate = () => {
  if (!isElectron()) return false;
  const st = useSettingsStore.getState();
  return (
    (st.customThemes || []).some((x) => x.dataUrl?.startsWith('asset://')) ||
    (st.customSounds || []).some((x) => x.dataUrl?.startsWith('asset://'))
  );
};

// Upload existing Electron AppData (asset://) customs to the cloud and rewrite
// store entries to cloud identifiers. Best-effort: individual failures skip.
export const migrateLocalAssets = async () => {
  if (!isElectron()) return 0;
  const fs = window.require('fs');
  const path = window.require('path');
  const dirs = getAssetDirs();
  if (!dirs) return 0;
  const get = useSettingsStore.getState;
  let migrated = 0;

  const localPath = (assetUrl, kind) => {
    const fileName = decodeURIComponent(assetUrl.split('/').pop());
    return path.join(kind === 'theme' ? dirs.backgrounds : dirs.sounds, fileName);
  };

  // Themes (stored as id in bgTheme; dataUrl becomes the storage path)
  for (const theme of [...(get().customThemes || [])]) {
    if (!theme.dataUrl?.startsWith('asset://')) continue;
    try {
      const p = localPath(theme.dataUrl, 'theme');
      if (!fs.existsSync(p)) continue;
      const name = theme.name || path.basename(p);
      const file = new File([fs.readFileSync(p)], name, { type: guessMime(p) });
      const { clientId, storagePath } = await uploadAsset(file, 'theme');
      const wasSelected = get().bgTheme === theme.id;
      get().removeCustomTheme(theme.id);
      get().addCustomTheme({ id: clientId, name, dataUrl: storagePath });
      if (wasSelected) get().setBgTheme(clientId);
      migrated++;
    } catch (e) {
      console.warn('migrate theme failed:', e?.message);
    }
  }

  // Sounds (focusSound/breakSound store the dataUrl value -> rewrite to asset-id:)
  for (const snd of [...(get().customSounds || [])]) {
    if (!snd.dataUrl?.startsWith('asset://')) continue;
    try {
      const p = localPath(snd.dataUrl, 'sound');
      if (!fs.existsSync(p)) continue;
      const name = snd.name || path.basename(p);
      const file = new File([fs.readFileSync(p)], name, { type: guessMime(p) });
      const oldUrl = snd.dataUrl;
      const { clientId } = await uploadAsset(file, 'focus');
      const stable = `asset-id:${clientId}`;
      get().removeCustomSound(snd.id);
      get().addCustomSound({ id: clientId, name, dataUrl: stable });
      if (get().focusSound === oldUrl) get().setFocusSound(stable);
      if (get().breakSound === oldUrl) get().setBreakSound(stable);
      migrated++;
    } catch (e) {
      console.warn('migrate sound failed:', e?.message);
    }
  }

  return migrated;
};

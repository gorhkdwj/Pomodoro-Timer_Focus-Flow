import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, UserPlus, Cloud } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getTranslation } from '../utils/i18n';
import { MAX_TOTAL_BYTES } from '../utils/cloudAssets';
import { isElectron } from '../utils/fsHelper';
import { migrateLocalAssets, hasLocalAssetsToMigrate } from '../utils/migrateLocalAssets';
import './AuthPanel.css';

const fmtMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

export default function AuthPanel({ lang }) {
  const t = (k) => getTranslation(lang, k);
  const {
    status, user, error, usageBytes,
    signIn, signUp, signInWithGoogle, signOut, refreshUsage, setError,
  } = useAuthStore();

  const [mode, setMode] = useState('signIn'); // 'signIn' | 'signUp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (status === 'signedIn') refreshUsage();
  }, [status, refreshUsage]);

  const handleMigrate = async () => {
    if (!window.confirm(t('migratePrompt'))) return;
    setMigrating(true);
    try {
      await migrateLocalAssets();
      await refreshUsage();
    } finally {
      setMigrating(false);
    }
  };

  // Supabase not configured -> render nothing (app stays in local-only mode).
  if (status === 'disabled') return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setNotice(null);
    if (mode === 'signUp') {
      const { data, error: err } = await signUp(email, password);
      // With email confirmation enabled, there is no session until confirmed.
      if (!err && !data?.session) setNotice(t('signUpCheckEmail'));
    } else {
      await signIn(email, password);
    }
    setBusy(false);
  };

  if (status === 'signedIn') {
    const pct = Math.min(100, (usageBytes / MAX_TOTAL_BYTES) * 100);
    return (
      <section className="settings-section auth-panel">
        <h4><Cloud size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />{t('account')}</h4>
        <div className="auth-signed-row">
          <div className="auth-userinfo">
            <span className="auth-label">{t('signedInAs')}</span>
            <span className="auth-email">{user?.email}</span>
          </div>
          <button className="auth-btn ghost" onClick={signOut}>
            <LogOut size={16} /> {t('signOut')}
          </button>
        </div>
        <div className="auth-usage">
          <div className="auth-usage-head">
            <span>{t('storageUsage')}</span>
            <span>{fmtMB(usageBytes)}MB / {fmtMB(MAX_TOTAL_BYTES)}MB</span>
          </div>
          <div className="auth-usage-bar">
            <div className="auth-usage-fill" style={{ width: pct + '%' }} />
          </div>
        </div>
        {isElectron() && hasLocalAssetsToMigrate() && (
          <button
            className="auth-btn ghost"
            style={{ marginTop: 12, width: '100%' }}
            onClick={handleMigrate}
            disabled={migrating}
          >
            {migrating ? t('processing') : t('migrateRun')}
          </button>
        )}
      </section>
    );
  }

  // signedOut / loading
  return (
    <section className="settings-section auth-panel">
      <h4><Cloud size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />{t('account')}</h4>
      <p className="auth-hint">{t('loginToSync')}</p>
      <form onSubmit={submit} className="auth-form">
        <input
          className="settings-select styled-select" type="email" placeholder={t('email')}
          value={email} autoComplete="email"
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
        />
        <input
          className="settings-select styled-select" type="password" placeholder={t('password')}
          value={password} autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
        />
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
        <button className="auth-btn primary" type="submit" disabled={busy || status === 'loading'}>
          {mode === 'signUp' ? <UserPlus size={16} /> : <LogIn size={16} />}
          {busy ? t('processing') : (mode === 'signUp' ? t('signUp') : t('signIn'))}
        </button>
      </form>
      <button className="auth-btn google" onClick={signInWithGoogle} disabled={busy}>
        {t('continueWithGoogle')}
      </button>
      <button
        className="auth-toggle"
        onClick={() => { setMode(mode === 'signUp' ? 'signIn' : 'signUp'); setNotice(null); if (error) setError(null); }}
      >
        {mode === 'signUp' ? t('haveAccount') : t('needAccount')}
      </button>
    </section>
  );
}

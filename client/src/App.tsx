import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchData, fetchProfileForUser, logout, putData } from './api';
import type { BrokerProfile } from './api';
import { APP_KICKER_APP, APP_NAME } from './branding';
import { LoginScreen } from './components/LoginScreen';
import { MainApp } from './components/MainApp';
import { SuperAdminPanel } from './components/SuperAdminPanel';
import { getSupabase } from './lib/supabase';
import { emptyDb, normalizeDb, type BrokerDb } from './types';

/** Eventos em que recarregamos perfil + payload (evita duplicar com getSession + SIGNED_IN). */
function authEventShouldBootstrap(
  event: string
): event is 'SIGNED_IN' | 'INITIAL_SESSION' | 'USER_UPDATED' {
  return event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<BrokerProfile | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [db, setDb] = useState<BrokerDb>(emptyDb());
  const [bootReady, setBootReady] = useState(false);
  /** Erro ao ler perfil ou empresa_dados — já não fazemos logout automático (antes parecia “volta ao login”). */
  const [syncError, setSyncError] = useState<string | null>(null);
  const skipNextPersist = useRef(true);
  /** Invalida cargas antigas (Strict Mode, eventos Auth em sequência). */
  const bootGen = useRef(0);

  const markSkipNextPersist = useCallback(() => {
    skipNextPersist.current = true;
  }, []);

  const loadFromSession = useCallback(async (s: Session) => {
    const myGen = ++bootGen.current;
    setSyncError(null);
    setBootReady(false);
    try {
      const p = await fetchProfileForUser(s.user.id);
      if (myGen !== bootGen.current) return;
      setProfile(p);
      setEmpresaId(p.empresa_id);
      if (p.role === 'superadmin') {
        setDb(emptyDb());
        setBootReady(true);
        skipNextPersist.current = true;
        return;
      }
      if (!p.empresa_id) {
        throw new Error('O perfil não está associado a uma imobiliária.');
      }
      const d = await fetchData(p.empresa_id);
      if (myGen !== bootGen.current) return;
      setDb(normalizeDb(d));
      setBootReady(true);
      skipNextPersist.current = true;
      setSyncError(null);
    } catch (e) {
      if (myGen !== bootGen.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) console.error('[App] Falha ao carregar perfil/dados:', e);
      setSyncError(msg);
      setProfile(null);
      setEmpresaId(null);
      setDb(emptyDb());
      setBootReady(false);
    }
  }, []);

  useEffect(() => {
    document.title = `${APP_NAME} · ${APP_KICKER_APP}`;
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    void sb.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, sess) => {
      setSession(sess);

      if (event === 'SIGNED_OUT' || !sess) {
        bootGen.current += 1;
        setProfile(null);
        setEmpresaId(null);
        setDb(emptyDb());
        setBootReady(false);
        setSyncError(null);
        return;
      }

      if (event === 'TOKEN_REFRESHED') return;

      if (authEventShouldBootstrap(event)) {
        void loadFromSession(sess);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadFromSession]);

  useEffect(() => {
    if (!session || !empresaId || !bootReady) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    const h = setTimeout(() => {
      void putData(db, empresaId).catch(() => {
        alert('Não foi possível salvar no Supabase. Verifique a ligação.');
      });
    }, 450);
    return () => clearTimeout(h);
  }, [db, session, empresaId, bootReady]);

  const handleLogout = useCallback(async () => {
    if (!confirm('Sair desta conta?')) return;
    bootGen.current += 1;
    await logout();
    setSession(null);
    setProfile(null);
    setEmpresaId(null);
    setDb(emptyDb());
    setBootReady(false);
    setSyncError(null);
  }, []);

  const handleRetrySync = useCallback(() => {
    const sb = getSupabase();
    if (!sb || !session) return;
    void loadFromSession(session);
  }, [session, loadFromSession]);

  if (!getSupabase()) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-hz-ink text-white px-6 text-center gap-3">
        <p className="font-bold text-emerald-300">Configuração em falta</p>
        <p className="text-sm text-white/70 max-w-md">
          Defina <code className="text-emerald-200">VITE_SUPABASE_URL</code> e{' '}
          <code className="text-emerald-200">VITE_SUPABASE_ANON_KEY</code> no ficheiro{' '}
          <code className="text-emerald-200">client/.env</code> e reinicie o Vite.
        </p>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (syncError) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-hz-cream dark:bg-neutral-950 text-hz-ink dark:text-neutral-100 gap-5 px-6 py-10">
        <div className="max-w-md w-full rounded-[2rem] border border-amber-200 dark:border-amber-800 bg-white dark:bg-neutral-900 p-8 shadow-xl space-y-4">
          <p className="text-lg font-black text-brand-dark dark:text-white">Não foi possível abrir a conta</p>
          <p className="text-sm text-gray-600 dark:text-neutral-400 leading-relaxed">
            A sessão existe, mas falhou a leitura do perfil ou dos dados da empresa no Supabase. Isto costuma ser: linha em
            falta em <code className="font-mono text-xs">profiles</code>, RLS a bloquear, ou projeto / URL errados.
          </p>
          <p className="text-xs font-mono break-words bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 rounded-xl p-3 border border-amber-100 dark:border-amber-900/50">
            {syncError}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={handleRetrySync}
              className="flex-1 min-h-[48px] rounded-2xl bg-brand-gold text-white font-bold text-sm shadow-lg shadow-brand-gold/20 active:scale-[0.98] transition-transform"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="flex-1 min-h-[48px] rounded-2xl border border-gray-200 dark:border-neutral-600 font-bold text-sm text-gray-700 dark:text-neutral-300"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bootReady && profile?.role === 'superadmin') {
    return <SuperAdminPanel profile={profile} onLogout={handleLogout} />;
  }

  if (!bootReady || !profile || !empresaId) {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center bg-hz-cream dark:bg-neutral-950 text-hz-ink dark:text-neutral-100 gap-3 px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          className="h-12 w-12 rounded-2xl border-2 border-hz-green/30 border-t-hz-green dark:border-emerald-500/30 dark:border-t-emerald-400 animate-spin"
          aria-hidden
        />
        <p className="text-sm font-semibold text-hz-green dark:text-emerald-400">A sincronizar com o Supabase…</p>
      </div>
    );
  }

  return (
    <MainApp
      db={db}
      setDb={setDb}
      onLogout={handleLogout}
      markSkipNextPersist={markSkipNextPersist}
      empresaId={empresaId}
      profile={profile}
      userEmail={session.user.email ?? ''}
    />
  );
}

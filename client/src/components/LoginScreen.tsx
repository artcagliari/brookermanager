import { FormEvent, useMemo, useState } from 'react';
import { APP_NAME, APP_TAGLINE, appNameParts } from '../branding';
import { formatLoginError, supabaseEnvSummary } from '../lib/authDiagnostics';
import { assertSupabase } from '../lib/supabase';

export function LoginScreen() {
  const brandTitle = useMemo(() => appNameParts(APP_NAME), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setErrorDetail('');
    setSubmitting(true);
    try {
      const sb = assertSupabase();
      const { error: err } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        if (import.meta.env.DEV) {
          console.error('[login] Auth resposta completa:', err);
        }
        const friendly =
          err.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : err.message;
        setError(friendly);
        setErrorDetail(formatLoginError(err));
        return;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[login] exceção:', err);
      }
      setError('Falha na autenticação (rede ou cliente).');
      setErrorDetail(formatLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-hz-ink text-white px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8 safe-pb relative overflow-hidden">
      <a href="#login-main" className="skip-link">
        Ir para o formulário de entrada
      </a>
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'url(https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200&q=80&auto=format&fit=crop)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-hz-ink/92 to-hz-ink" />
      <main
        id="login-main"
        tabIndex={-1}
        className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full py-6 relative z-10 outline-none"
      >
        <p className="text-[10px] text-emerald-300/90 font-bold uppercase tracking-[0.25em] text-center mb-2">
          Agenda imobiliária inteligente
        </p>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-center mb-2">
          {brandTitle.tail ? (
            <>
              {brandTitle.head}{' '}
              <span className="text-emerald-300 font-normal">{brandTitle.tail}</span>
            </>
          ) : (
            <span className="text-emerald-300 font-normal">{brandTitle.head}</span>
          )}
        </h1>
        <p className="text-center text-white/65 text-sm mb-10">{APP_TAGLINE}</p>

        <form
          className="space-y-4"
          autoComplete="on"
          onSubmit={handleSubmit}
          aria-busy={submitting}
        >
          <div>
            <label
              htmlFor="auth-email"
              className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1"
            >
              E-mail
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              required
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full p-4 rounded-2xl bg-white/10 border border-white/15 text-white placeholder-white/30 outline-none focus:ring-2 ring-emerald-400/50 text-base min-h-[48px]"
            />
          </div>
          <div>
            <label
              htmlFor="auth-password"
              className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-1"
            >
              Senha
            </label>
            <input
              id="auth-password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full p-4 rounded-2xl bg-white/10 border border-white/15 text-white placeholder-white/30 outline-none focus:ring-2 ring-emerald-400/50 text-base min-h-[48px]"
            />
          </div>
          {error ? (
            <div
              role="alert"
              className="space-y-2 rounded-2xl bg-red-500/10 border border-red-400/25 px-4 py-3 text-left"
            >
              <p className="text-red-200 text-sm font-semibold">{error}</p>
              {errorDetail ? (
                <p className="text-red-200/90 text-xs font-mono break-words whitespace-pre-wrap">{errorDetail}</p>
              ) : null}
              {import.meta.env.DEV ? (
                <details className="text-[11px] text-white/50">
                  <summary className="cursor-pointer text-emerald-400/90">Diagnóstico (.env efectivo)</summary>
                  <pre className="mt-2 text-[10px] text-white/60 whitespace-pre-wrap break-all">
                    {supabaseEnvSummary()}
                  </pre>
                  <p className="mt-2 text-white/45">
                    Compare o <strong className="text-white/70">Host</strong> com Project Settings → API no Supabase (caractere a
                    caractere). HTTP 500: veja Logs → Auth no painel.
                  </p>
                </details>
              ) : null}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-emerald-900/30 active:scale-[0.98] transition-transform min-h-[52px] disabled:opacity-60"
          >
            {submitting ? 'A entrar…' : 'Entrar'}
          </button>
        </form>

        <p className="w-full mt-8 text-center text-white/40 text-xs leading-relaxed px-2">
          Contas criadas pelo administrador: <strong className="text-white/60">master da empresa</strong>,{' '}
          <strong className="text-white/60">corretor</strong> ou <strong className="text-white/60">superadmin</strong>.
          Não há cadastro público.
        </p>
      </main>
    </div>
  );
}

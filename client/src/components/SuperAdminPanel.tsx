import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { BrokerProfile, RegisteredEmpresa } from '../api';
import {
  createEmpresaLogin,
  deleteEmpresaLogin,
  deleteRegisteredEmpresa,
  fetchRegisteredEmpresas,
  registerEmpresa,
} from '../api';
import { APP_NAME } from '../branding';

type Props = { profile: BrokerProfile; onLogout: () => Promise<void> };

const inputClass = 'admin-field';

function generateTemporaryPassword() {
  const words = ['local', 'imovel', 'empresa', 'corretor', 'agenda', 'visita'];
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  const word = words[(random[0] ?? 0) % words.length] ?? 'local';
  const number = String(100 + ((random[1] ?? 0) % 900));
  return `${word}${number}`;
}

function loginRoleLabel(role: 'empresa' | 'corretor') {
  return role === 'empresa' ? 'Master da empresa' : 'Corretor';
}

function loginRoleDescription(role: 'empresa' | 'corretor') {
  return role === 'empresa'
    ? 'Vê todos os dados da imobiliária e a equipe.'
    : 'Vê somente os registros atribuídos ao próprio login.';
}

type CompanyCardProps = {
  company: RegisteredEmpresa;
  busy: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onBusy: (busy: boolean) => void;
};

function CompanyCard({ company, busy, onChanged, onError, onSuccess, onBusy }: CompanyCardProps) {
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generateTemporaryPassword);
  const [role, setRole] = useState<'empresa' | 'corretor'>('empresa');

  async function handleCreateLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onBusy(true);
    onError('');
    try {
      await createEmpresaLogin(company.id, { loginName, email, password, role });
      onSuccess(`Login ${email.trim().toLowerCase()} criado para ${company.nome}.`);
      setLoginName('');
      setEmail('');
      setPassword(generateTemporaryPassword());
      setShowLoginForm(false);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      onBusy(false);
    }
  }

  async function handleDeleteLogin(userId: string, userEmail: string) {
    if (!confirm(`Remover permanentemente o login ${userEmail || userId}?`)) return;
    onBusy(true);
    onError('');
    try {
      await deleteEmpresaLogin(userId);
      onSuccess(`Login ${userEmail || userId} removido.`);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      onBusy(false);
    }
  }

  async function handleDeleteCompany() {
    if (!confirm(`Excluir permanentemente ${company.nome}? Isso remove todos os logins e dados de CRM desta imobiliária.`)) return;
    onBusy(true);
    onError('');
    try {
      await deleteRegisteredEmpresa(company.id);
      onSuccess(`${company.nome} e seus logins foram removidos.`);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      onBusy(false);
    }
  }

  return (
    <article className="admin-card">
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-black text-lg">{company.nome}</p>
          <p className="mt-1 text-[10px] text-gray-400 font-mono break-all">{company.id}</p>
          {company.created_at ? <p className="mt-2 text-xs text-gray-500">Cadastrada em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(company.created_at))}</p> : null}
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
          <button type="button" disabled={busy} onClick={() => setShowLoginForm((value) => !value)} className="admin-primary-button min-w-0">
            {showLoginForm ? 'Cancelar' : 'Novo login'}
          </button>
          <button type="button" disabled={busy} onClick={() => void handleDeleteCompany()} className="admin-danger-button min-w-0">
            Excluir imobiliária
          </button>
        </div>
      </div>

      {showLoginForm ? (
        <form onSubmit={handleCreateLogin} className="border-t border-neutral-700/60 bg-hz-ink p-4 sm:p-5 grid sm:grid-cols-2 gap-4">
          <label><span className="admin-field-label">Nome do usuário</span><input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="Ex.: Maria Silva" minLength={2} maxLength={120} required className={inputClass} /></label>
          <label><span className="admin-field-label">E-mail de login</span><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@imobiliaria.com" type="email" required className={inputClass} /></label>
          <label><span className="admin-field-label">Tipo de login</span><select value={role} onChange={(event) => setRole(event.target.value as 'empresa' | 'corretor')} className={inputClass}>
            <option className="text-black" value="empresa">Master — vê tudo da empresa</option>
            <option className="text-black" value="corretor">Corretor — vê somente os próprios registros</option>
          </select></label>
          <label className="min-w-0"><span className="admin-field-label">Senha temporária</span><span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha temporária" minLength={8} maxLength={72} required className={inputClass} /><button type="button" onClick={() => setPassword(generateTemporaryPassword())} className="min-h-[50px] px-3 rounded-xl border border-white/20 bg-white/10 text-white text-xs font-bold hover:bg-white/15">Gerar</button></span></label>
          <button type="submit" disabled={busy} className="admin-primary-button sm:col-span-2">Criar login</button>
          <p className="sm:col-span-2 text-xs text-white/55" role="status">
            <strong className="text-white">{loginRoleLabel(role)}:</strong> {loginRoleDescription(role)}
          </p>
        </form>
      ) : null}

      <div className="border-t border-gray-100 dark:border-neutral-800 p-4 sm:p-5">
        <h3 className="text-xs uppercase tracking-wide font-black text-gray-500 mb-3">Logins ({company.logins.length})</h3>
        {company.logins.length === 0 ? <p className="text-sm text-amber-600">Nenhum login vinculado.</p> : null}
        <div className="space-y-2">
          {company.logins.map((login) => (
            <div key={login.id} className="rounded-xl border border-gray-100 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-950 px-4 py-3 flex flex-col min-[380px]:flex-row min-[380px]:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">{login.nome_exibicao?.trim() || 'Usuário'}</p>
                <p className="text-xs text-gray-500 truncate">{login.email || 'E-mail indisponível'}</p>
                <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-black mt-1">{loginRoleLabel(login.role)}</p>
                <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">{loginRoleDescription(login.role)}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void handleDeleteLogin(login.id, login.email)} className="admin-danger-button shrink-0 w-full min-[380px]:w-auto">Remover</button>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function SuperAdminPanel({ profile, onLogout }: Props) {
  const [companyName, setCompanyName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generateTemporaryPassword);
  const [primaryRole, setPrimaryRole] = useState<'empresa' | 'corretor'>('empresa');
  const [companies, setCompanies] = useState<RegisteredEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      setCompanies(await fetchRegisteredEmpresas());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await registerEmpresa({ companyName, loginName, email, password, role: primaryRole });
      setSuccess(`${companyName.trim()} e o login ${email.trim().toLowerCase()} foram criados.`);
      setCompanyName('');
      setLoginName('');
      setEmail('');
      setPassword(generateTemporaryPassword());
      setPrimaryRole('empresa');
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="sticky top-0 z-20 border-b border-gray-200/80 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-lg pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[0.2em] font-black text-emerald-600">Superadmin</p><h1 className="font-display text-xl font-bold">{APP_NAME}</h1></div>
          <button type="button" onClick={() => void onLogout()} className="admin-secondary-button min-h-[44px]">Sair</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 safe-pb">
        <section className="rounded-3xl bg-hz-ink text-white p-5 sm:p-8 shadow-xl shadow-black/10 ring-1 ring-white/5">
          <p className="text-xs text-white/55 mb-1">{profile.nome_exibicao?.trim() || 'Administrador da plataforma'}</p>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">Cadastrar imobiliária e login</h2>
          <p className="text-sm text-white/60 mt-2 max-w-xl">Crie a imobiliária e informe se o primeiro acesso será um <strong className="text-white">Master da empresa</strong> ou um <strong className="text-white">Corretor</strong>.</p>
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs leading-relaxed text-emerald-50">
            <strong>Master:</strong> vê tudo da imobiliária e a equipe. <strong>Corretor:</strong> vê somente os registros atribuídos ao próprio login.
          </div>
          <form onSubmit={handleCreateCompany} className="mt-6 grid sm:grid-cols-2 gap-4" aria-busy={busy}>
            <label><span className="admin-field-label">Imobiliária</span><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Nome da imobiliária" minLength={2} maxLength={120} required className={inputClass} /></label>
            <label><span className="admin-field-label">Responsável</span><input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="Nome completo" minLength={2} maxLength={120} required className={inputClass} /></label>
            <label><span className="admin-field-label">E-mail de login</span><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="responsavel@imobiliaria.com" type="email" required className={inputClass} /></label>
            <label><span className="admin-field-label">Tipo do primeiro login</span><select value={primaryRole} onChange={(event) => setPrimaryRole(event.target.value as 'empresa' | 'corretor')} className={inputClass}><option className="text-black" value="empresa">Master — vê tudo da empresa</option><option className="text-black" value="corretor">Corretor — vê somente os próprios registros</option></select></label>
            <label className="min-w-0 sm:col-span-2"><span className="admin-field-label">Senha temporária</span><span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha temporária" minLength={8} maxLength={72} required className={inputClass} /><button type="button" onClick={() => setPassword(generateTemporaryPassword())} className="min-h-[50px] px-3 rounded-xl border border-white/20 bg-white/10 text-xs font-bold hover:bg-white/15">Gerar</button></span></label>
            <p className="sm:col-span-2 text-xs text-white/55"><strong className="text-white">{loginRoleLabel(primaryRole)}:</strong> {loginRoleDescription(primaryRole)}</p>
            <button type="submit" disabled={busy} className="admin-primary-button sm:col-span-2 min-h-[52px] rounded-2xl">{busy ? 'Processando…' : 'Cadastrar imobiliária e login'}</button>
          </form>
          {error ? <p role="alert" className="admin-message-error mt-4">{error}</p> : null}
          {success ? <p role="status" className="admin-message-success mt-4">{success}</p> : null}
        </section>

        <section aria-labelledby="companies-heading">
          <div className="flex items-end justify-between gap-4 mb-4"><div><h2 id="companies-heading" className="text-xl font-black">Imobiliárias e logins</h2><p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">Cadastros administrativos; o CRM permanece privado.</p></div><button type="button" onClick={() => void loadCompanies()} className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Atualizar</button></div>
          {loading ? <p className="py-8 text-sm text-gray-500">Carregando…</p> : null}
          {!loading && companies.length === 0 ? <p className="rounded-2xl border border-dashed border-gray-300 dark:border-neutral-700 p-8 text-center text-sm text-gray-500">Nenhuma imobiliária cadastrada.</p> : null}
          <div className="grid gap-4">
            {companies.map((company) => <CompanyCard key={company.id} company={company} busy={busy} onBusy={setBusy} onError={(message) => { setError(message || null); setSuccess(null); }} onSuccess={(message) => { setSuccess(message); setError(null); }} onChanged={loadCompanies} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

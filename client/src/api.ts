import type { BrokerDb } from './types';
import { emptyDb, normalizeDb } from './types';
import { assertSupabase, getSupabase } from './lib/supabase';

export type BrokerProfile = {
  id: string;
  empresa_id: string | null;
  role: 'superadmin' | 'empresa' | 'corretor';
  nome_exibicao: string | null;
};

function mapProfileRow(row: {
  id: string;
  empresa_id: string | null;
  role: string;
  nome_exibicao: string | null;
}): BrokerProfile {
  const role =
    row.role === 'superadmin' || row.role === 'empresa' || row.role === 'corretor'
      ? row.role
      : 'corretor';
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    role,
    nome_exibicao: row.nome_exibicao,
  };
}

export type RegisteredEmpresa = {
  id: string;
  nome: string;
  created_at: string | null;
  logins: RegisteredLogin[];
};

export type RegisteredLogin = {
  id: string;
  email: string;
  nome_exibicao: string | null;
  role: 'empresa' | 'corretor';
};

type CreateLoginInput = {
  loginName: string;
  email: string;
  password: string;
  role: 'empresa' | 'corretor';
};

async function invokeSuperAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const sb = assertSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await sb.auth.refreshSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session?.access_token) {
    throw new Error('A sessão expirou. Saia e entre novamente para continuar.');
  }

  const { data, error } = await sb.functions.invoke('superadmin-admin', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let message = error.message;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // Mantém a mensagem do cliente Supabase.
      }
    }
    throw new Error(message);
  }
  const payload = data as T & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

/** Lista dados cadastrais e logins; o payload do CRM nunca é consultado. */
export async function fetchRegisteredEmpresas(): Promise<RegisteredEmpresa[]> {
  const data = await invokeSuperAdmin<{ companies: RegisteredEmpresa[] }>({ action: 'list' });
  return data.companies;
}

export async function registerEmpresa(input: {
  companyName: string;
  loginName: string;
  email: string;
  password: string;
  role: 'empresa' | 'corretor';
}): Promise<RegisteredEmpresa> {
  const data = await invokeSuperAdmin<{ company: RegisteredEmpresa }>({
    action: 'create_company',
    ...input,
  });
  return data.company;
}

export async function createEmpresaLogin(
  companyId: string,
  input: CreateLoginInput
): Promise<RegisteredLogin> {
  const data = await invokeSuperAdmin<{ login: RegisteredLogin }>({
    action: 'create_login',
    companyId,
    ...input,
  });
  return data.login;
}

export async function deleteEmpresaLogin(userId: string): Promise<void> {
  await invokeSuperAdmin<{ ok: true }>({ action: 'delete_login', userId });
}

export async function deleteRegisteredEmpresa(companyId: string): Promise<void> {
  await invokeSuperAdmin<{ ok: true }>({ action: 'delete_company', companyId });
}

export async function fetchProfileForUser(userId: string): Promise<BrokerProfile> {
  const sb = assertSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('id, empresa_id, role, nome_exibicao')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      'Perfil não encontrado. O administrador deve criar o seu utilizador e perfil (empresa ou corretor) no Supabase.'
    );
  }
  return mapProfileRow(data as BrokerProfile & { role: string });
}

export async function fetchEmpresaPayload(empresaId: string): Promise<BrokerDb> {
  const sb = assertSupabase();
  const { data, error } = await sb
    .from('empresa_dados')
    .select('payload')
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.payload) {
    const empty = emptyDb();
    const { error: upErr } = await sb.from('empresa_dados').upsert(
      {
        empresa_id: empresaId,
        payload: empty as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'empresa_id' }
    );
    if (upErr) throw new Error(upErr.message);
    return empty;
  }
  return normalizeDb(data.payload);
}

export async function logout(): Promise<void> {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

export async function fetchData(empresaId: string): Promise<BrokerDb> {
  return fetchEmpresaPayload(empresaId);
}

export type TeamMemberProfile = {
  id: string;
  role: 'empresa' | 'corretor';
  nome_exibicao: string | null;
};

/** Só funciona com política + função `user_is_empresa_for_company` (migrações 007–009) para a persona empresa. */
export async function fetchTeamProfiles(empresaId: string): Promise<TeamMemberProfile[]> {
  const sb = assertSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('id, role, nome_exibicao')
    .eq('empresa_id', empresaId)
    .order('role', { ascending: true })
    .order('nome_exibicao', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; role: string; nome_exibicao: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    role: row.role === 'empresa' ? 'empresa' : 'corretor',
    nome_exibicao: row.nome_exibicao,
  }));
}

export async function putData(db: BrokerDb, empresaId: string): Promise<void> {
  const sb = assertSupabase();
  const { error } = await sb.from('empresa_dados').upsert(
    {
      empresa_id: empresaId,
      payload: db as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'empresa_id' }
  );
  if (error) throw new Error(error.message);
}

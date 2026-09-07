import { createClient } from 'npm:@supabase/supabase-js@2.100.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-user-token, apikey, content-type',
};

type Action =
  | { action: 'list' }
  | {
      action: 'create_company';
      companyName: string;
      loginName: string;
      email: string;
      password: string;
      role: 'empresa' | 'corretor';
    }
  | {
      action: 'create_login';
      companyId: string;
      loginName: string;
      email: string;
      password: string;
      role: 'empresa' | 'corretor';
    }
  | { action: 'delete_login'; userId: string }
  | { action: 'delete_company'; companyId: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, label: string, min = 2, max = 120): string {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return text;
}

function cleanEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Informe um e-mail válido.');
  }
  return email;
}

function cleanPassword(value: unknown): string {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 72) {
    throw new Error('A senha temporária deve ter entre 8 e 72 caracteres.');
  }
  return password;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  const forwardedUserToken = request.headers.get('X-User-Token');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Servidor não configurado.' }, 500);
  if (!forwardedUserToken && !authorization?.startsWith('Bearer ')) {
    return json({ error: 'Sessão ausente.' }, 401);
  }

  const token = forwardedUserToken || authorization!.slice('Bearer '.length);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role, empresa_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: profileError.message }, 500);
  if (callerProfile?.role !== 'superadmin' || callerProfile.empresa_id !== null) {
    return json({ error: 'Apenas o superadmin pode executar esta operação.' }, 403);
  }

  let body: Action;
  try {
    body = (await request.json()) as Action;
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  try {
    if (body.action === 'list') {
      const [{ data: companies, error: companyError }, { data: profiles, error: profilesError }] =
        await Promise.all([
          admin.from('empresas').select('id, nome, created_at').order('created_at', { ascending: false }),
          admin.from('profiles').select('id, empresa_id, role, nome_exibicao').not('empresa_id', 'is', null),
        ]);
      if (companyError) throw companyError;
      if (profilesError) throw profilesError;

      const authUsers = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        authUsers.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const emailById = new Map(authUsers.map((user) => [user.id, user.email ?? '']));
      const loginsByCompany = new Map<string, unknown[]>();
      for (const profile of profiles ?? []) {
        if (!profile.empresa_id) continue;
        const current = loginsByCompany.get(profile.empresa_id) ?? [];
        current.push({
          id: profile.id,
          email: emailById.get(profile.id) ?? '',
          nome_exibicao: profile.nome_exibicao,
          role: profile.role,
        });
        loginsByCompany.set(profile.empresa_id, current);
      }
      return json({
        companies: (companies ?? []).map((company) => ({
          ...company,
          logins: loginsByCompany.get(company.id) ?? [],
        })),
      });
    }

    if (body.action === 'create_company') {
      const companyName = cleanText(body.companyName, 'O nome da imobiliária');
      const loginName = cleanText(body.loginName, 'O nome do responsável');
      const email = cleanEmail(body.email);
      const password = cleanPassword(body.password);
      const role = body.role === 'corretor' ? 'corretor' : 'empresa';

      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome_exibicao: loginName },
      });
      if (authError || !authData.user) throw authError ?? new Error('Falha ao criar o login.');

      let companyId: string | null = null;
      try {
        const { data: company, error: companyError } = await admin
          .from('empresas')
          .insert({ nome: companyName })
          .select('id, nome, created_at')
          .single();
        if (companyError) throw companyError;
        companyId = company.id;

        const { error: dataError } = await admin.from('empresa_dados').insert({
          empresa_id: company.id,
          payload: {},
        });
        if (dataError) throw dataError;

        const { error: newProfileError } = await admin.from('profiles').insert({
          id: authData.user.id,
          empresa_id: company.id,
          role,
          nome_exibicao: loginName,
        });
        if (newProfileError) throw newProfileError;
        return json({ company: { ...company, logins: [{ id: authData.user.id, email, nome_exibicao: loginName, role }] } });
      } catch (error) {
        if (companyId) await admin.from('empresas').delete().eq('id', companyId);
        await admin.auth.admin.deleteUser(authData.user.id);
        throw error;
      }
    }

    if (body.action === 'create_login') {
      const companyId = cleanText(body.companyId, 'A imobiliária', 36, 36);
      const loginName = cleanText(body.loginName, 'O nome do usuário');
      const email = cleanEmail(body.email);
      const password = cleanPassword(body.password);
      const role = body.role === 'corretor' ? 'corretor' : 'empresa';

      const { data: company, error: companyError } = await admin
        .from('empresas')
        .select('id')
        .eq('id', companyId)
        .maybeSingle();
      if (companyError) throw companyError;
      if (!company) return json({ error: 'Imobiliária não encontrada.' }, 404);

      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome_exibicao: loginName },
      });
      if (authError || !authData.user) throw authError ?? new Error('Falha ao criar o login.');
      const { error: newProfileError } = await admin.from('profiles').insert({
        id: authData.user.id,
        empresa_id: companyId,
        role,
        nome_exibicao: loginName,
      });
      if (newProfileError) {
        await admin.auth.admin.deleteUser(authData.user.id);
        throw newProfileError;
      }
      return json({ login: { id: authData.user.id, email, nome_exibicao: loginName, role } });
    }

    if (body.action === 'delete_login') {
      const userId = cleanText(body.userId, 'O usuário', 36, 36);
      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('id, empresa_id, role')
        .eq('id', userId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target?.empresa_id || target.role === 'superadmin') {
        return json({ error: 'Login não encontrado ou protegido.' }, 404);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === 'delete_company') {
      const companyId = cleanText(body.companyId, 'A imobiliária', 36, 36);
      const { data: company, error: companyError } = await admin
        .from('empresas')
        .select('id, nome')
        .eq('id', companyId)
        .maybeSingle();
      if (companyError) throw companyError;
      if (!company) return json({ error: 'Imobiliária não encontrada.' }, 404);

      const { data: companyProfiles, error: companyProfilesError } = await admin
        .from('profiles')
        .select('id')
        .eq('empresa_id', companyId);
      if (companyProfilesError) throw companyProfilesError;
      for (const profile of companyProfiles ?? []) {
        const { error } = await admin.auth.admin.deleteUser(profile.id);
        if (error) throw error;
      }
      const { error: deleteError } = await admin.from('empresas').delete().eq('id', companyId);
      if (deleteError) throw deleteError;
      return json({ ok: true, deleted: company.nome });
    }

    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /already|registered|unique/i.test(message) ? 409 : 400;
    return json({ error: message }, status);
  }
});

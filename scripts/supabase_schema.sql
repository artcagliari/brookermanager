-- =============================================================================
-- Setup Supabase — executar UMA vez em projeto novo (SQL Editor).
-- Utilizadores: Authentication → Add user; depois linhas em public.profiles
-- (mesmo empresa_id, role empresa | corretor). Não commite seeds com senhas.
-- =============================================================================

-- --------------------------------------------------------------------------- 001
create extension if not exists "pgcrypto";

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Imobiliária',
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  role text not null check (role in ('empresa', 'corretor')),
  nome_exibicao text,
  created_at timestamptz default now()
);

create index if not exists profiles_empresa_id_idx on public.profiles (empresa_id);

create table if not exists public.empresa_dados (
  empresa_id uuid primary key references public.empresas (id) on delete cascade,
  payload jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table public.empresas enable row level security;
alter table public.profiles enable row level security;
alter table public.empresa_dados enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);

drop policy if exists "empresas_select_member" on public.empresas;
create policy "empresas_select_member" on public.empresas for select using (
  id in (select empresa_id from public.profiles where id = auth.uid())
);

drop policy if exists "empresa_dados_all" on public.empresa_dados;
create policy "empresa_dados_all" on public.empresa_dados for all using (
  empresa_id in (select empresa_id from public.profiles where id = auth.uid())
)
with check (
  empresa_id in (select empresa_id from public.profiles where id = auth.uid())
);

-- --------------------------------------------------------------------------- 002 (bucket + políticas iniciais)
insert into storage.buckets (id, name, public)
values ('imovel-fotos', 'imovel-fotos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "imovel_fotos_public_read" on storage.objects;
drop policy if exists "imovel_fotos_auth_upload" on storage.objects;
drop policy if exists "imovel_fotos_auth_update" on storage.objects;
drop policy if exists "imovel_fotos_auth_delete" on storage.objects;

create policy "imovel_fotos_public_read"
  on storage.objects for select
  using (bucket_id = 'imovel-fotos');

create policy "imovel_fotos_auth_upload"
  on storage.objects for insert
  with check (bucket_id = 'imovel-fotos' and auth.role() = 'authenticated');

create policy "imovel_fotos_auth_update"
  on storage.objects for update
  using (bucket_id = 'imovel-fotos' and auth.role() = 'authenticated');

create policy "imovel_fotos_auth_delete"
  on storage.objects for delete
  using (bucket_id = 'imovel-fotos' and auth.role() = 'authenticated');

-- --------------------------------------------------------------------------- 005
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  recovery_token = coalesce(recovery_token, '')
where confirmation_token is null
   or email_change is null
   or email_change_token_new is null
   or recovery_token is null;

-- --------------------------------------------------------------------------- 006
drop policy if exists "imovel_fotos_public_read" on storage.objects;
drop policy if exists "imovel_fotos_auth_upload" on storage.objects;
drop policy if exists "imovel_fotos_auth_update" on storage.objects;
drop policy if exists "imovel_fotos_auth_delete" on storage.objects;

create policy "imovel_fotos_public_read"
  on storage.objects for select
  using (bucket_id = 'imovel-fotos');

create policy "imovel_fotos_auth_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'imovel-fotos' and auth.uid() is not null);

create policy "imovel_fotos_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'imovel-fotos' and auth.uid() is not null)
  with check (bucket_id = 'imovel-fotos' and auth.uid() is not null);

create policy "imovel_fotos_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'imovel-fotos' and auth.uid() is not null);

-- --------------------------------------------------------------------------- 009 (equipa / sem recursão RLS)
create or replace function public.user_is_empresa_for_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'empresa'
      and p.empresa_id = target_company
  );
$$;

revoke all on function public.user_is_empresa_for_company(uuid) from public;
grant execute on function public.user_is_empresa_for_company(uuid) to authenticated;
grant execute on function public.user_is_empresa_for_company(uuid) to service_role;

drop policy if exists "profiles_select_team_if_empresa" on public.profiles;

create policy "profiles_select_team_if_empresa" on public.profiles
for select using (public.user_is_empresa_for_company(empresa_id));

-- --------------------------------------------------------------------------- 010 (seed exemplo: nova empresa + 1 corretor)
-- Troque o UUID abaixo pelo `id` real de um utilizador já criado em Authentication.
-- Exemplo:
-- select id, email from auth.users order by created_at desc;

insert into public.empresas (id, nome)
values ('2c4b9f2c-2fdb-4783-a4e7-20dbca1d8f99', 'Horizonte Prime Imóveis')
on conflict (id) do update
set nome = excluded.nome;

insert into public.empresa_dados (empresa_id, payload)
values (
  '2c4b9f2c-2fdb-4783-a4e7-20dbca1d8f99',
  '{}'::jsonb
)
on conflict (empresa_id) do nothing;

insert into public.profiles (id, empresa_id, role, nome_exibicao)
values (
  '11111111-1111-1111-1111-111111111111', -- <- substituir pelo auth.users.id do corretor
  '2c4b9f2c-2fdb-4783-a4e7-20dbca1d8f99',
  'corretor',
  'Corretor Seed'
)
on conflict (id) do update
set
  empresa_id = excluded.empresa_id,
  role = excluded.role,
  nome_exibicao = excluded.nome_exibicao;

-- --------------------------------------------------------------------------- 011 (superadmin restrito ao cadastro de imobiliárias)
-- O superadmin não pertence a uma empresa e não recebe acesso a empresa_dados.
alter table public.profiles alter column empresa_id drop not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('superadmin', 'empresa', 'corretor'));

alter table public.profiles drop constraint if exists profiles_role_company_check;
alter table public.profiles
  add constraint profiles_role_company_check check (
    (role = 'superadmin' and empresa_id is null)
    or (role in ('empresa', 'corretor') and empresa_id is not null)
  );

create or replace function public.current_user_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'superadmin'
      and p.empresa_id is null
  );
$$;

revoke all on function public.current_user_is_superadmin() from public;
grant execute on function public.current_user_is_superadmin() to authenticated;
grant execute on function public.current_user_is_superadmin() to service_role;

create or replace function public.current_user_is_operational_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('empresa', 'corretor')
      and p.empresa_id is not null
  );
$$;

revoke all on function public.current_user_is_operational_member() from public;
grant execute on function public.current_user_is_operational_member() to authenticated;
grant execute on function public.current_user_is_operational_member() to service_role;

-- Permite ao superadmin ver apenas id, nome e data das empresas. Não há política
-- de UPDATE/DELETE e o INSERT direto continua bloqueado.
drop policy if exists "empresas_select_superadmin" on public.empresas;
create policy "empresas_select_superadmin"
on public.empresas for select
to authenticated
using (public.current_user_is_superadmin());

create or replace function public.register_empresa(company_name text)
returns public.empresas
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(company_name);
  created_company public.empresas;
begin
  if not public.current_user_is_superadmin() then
    raise exception 'Apenas o superadmin pode cadastrar imobiliárias.'
      using errcode = '42501';
  end if;

  if clean_name is null or char_length(clean_name) < 2 then
    raise exception 'Informe um nome com pelo menos 2 caracteres.'
      using errcode = '22023';
  end if;

  if char_length(clean_name) > 120 then
    raise exception 'O nome deve ter no máximo 120 caracteres.'
      using errcode = '22023';
  end if;

  insert into public.empresas (nome)
  values (clean_name)
  returning * into created_company;

  insert into public.empresa_dados (empresa_id, payload)
  values (created_company.id, '{}'::jsonb);

  return created_company;
end;
$$;

revoke all on function public.register_empresa(text) from public;
revoke all on function public.register_empresa(text) from anon;
grant execute on function public.register_empresa(text) to authenticated;
grant execute on function public.register_empresa(text) to service_role;

-- O bucket é público para leitura, mas superadmin não pode gravar ou apagar fotos.
drop policy if exists "imovel_fotos_auth_upload" on storage.objects;
drop policy if exists "imovel_fotos_auth_update" on storage.objects;
drop policy if exists "imovel_fotos_auth_delete" on storage.objects;

create policy "imovel_fotos_auth_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'imovel-fotos'
    and auth.uid() is not null
    and public.current_user_is_operational_member()
  );

create policy "imovel_fotos_auth_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'imovel-fotos'
    and auth.uid() is not null
    and public.current_user_is_operational_member()
  )
  with check (
    bucket_id = 'imovel-fotos'
    and auth.uid() is not null
    and public.current_user_is_operational_member()
  );

create policy "imovel_fotos_auth_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'imovel-fotos'
    and auth.uid() is not null
    and public.current_user_is_operational_member()
  );

-- Para criar a primeira conta superadmin:
-- 1. Crie o utilizador em Authentication -> Users.
-- 2. Copie o UUID e execute, substituindo os valores abaixo:
-- insert into public.profiles (id, empresa_id, role, nome_exibicao)
-- values ('UUID_DO_AUTH_USERS', null, 'superadmin', 'Super Admin');

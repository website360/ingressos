-- =============================================================================
-- 20260801090300_tenancy
-- Empresas (tenants), perfis de usuário, vínculos e convites.
-- Base do isolamento multiempresa (docs/07, seção 2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 120),
  slug          citext not null,
  document      text,                                   -- CNPJ (somente dígitos)
  logo_url      text,
  brand_color   text default '#2563eb' check (brand_color ~* '^#[0-9a-f]{6}$'),
  plan          text not null default 'trial',
  status        public.tenant_status not null default 'trial',
  timezone      text not null default 'America/Sao_Paulo',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz,

  constraint uq_tenant_slug unique (slug),
  constraint uq_tenant_document unique (document),
  constraint chk_tenant_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.tenants is 'Empresas da plataforma. Raiz do isolamento multi-tenant.';

create index ix_tenants_status on public.tenants (status) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- profiles — 1:1 com auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null default '',
  email             citext not null,
  phone             text,
  avatar_url        text,
  locale            text not null default 'pt-BR',
  active_tenant_id  uuid references public.tenants (id) on delete set null,
  is_platform_admin boolean not null default false,
  mfa_enabled       boolean not null default false,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.profiles.active_tenant_id is
  'Empresa ativa na sessão. Entra no JWT via custom access token hook (ADR-004).';
comment on column public.profiles.is_platform_admin is
  'Super admin da plataforma. Fora da RLS de tenant — conceder com extremo critério.';

create index ix_profiles_email on public.profiles (email);

-- Cria o profile automaticamente ao criar o usuário no Auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger tg_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- memberships — usuário × tenant × papel
-- -----------------------------------------------------------------------------
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.user_role not null default 'organizador',
  status      public.membership_status not null default 'ativo',
  is_owner    boolean not null default false,
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_membership_user_tenant unique (tenant_id, user_id)
);

comment on table public.memberships is
  'Um usuário pode operar N empresas com papéis distintos (RF-01.2).';

create index ix_memberships_user on public.memberships (user_id) where status = 'ativo';
create index ix_memberships_tenant on public.memberships (tenant_id, role) where status = 'ativo';

-- Garante ao menos um owner ativo por tenant.
create unique index uq_membership_owner
  on public.memberships (tenant_id)
  where is_owner and status = 'ativo';

-- -----------------------------------------------------------------------------
-- tenant_invitations — convite de usuário por e-mail (RF-02.2)
-- -----------------------------------------------------------------------------
create table public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  email       citext not null,
  role        public.user_role not null default 'organizador',
  token_hash  bytea not null,                 -- SHA-256 do token; o token só existe no e-mail
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at  timestamptz,
  invited_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint uq_invitation_token unique (token_hash)
);

create unique index uq_invitation_pending
  on public.tenant_invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;

create index ix_invitations_expiry on public.tenant_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

-- -----------------------------------------------------------------------------
-- tenant_settings — configurações tipadas por empresa
-- -----------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,

  primary key (tenant_id, key)
);

-- -----------------------------------------------------------------------------
-- Triggers de updated_at
-- -----------------------------------------------------------------------------
create trigger tg_tenants_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger tg_profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger tg_memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger tg_tenants_created_by before insert on public.tenants
  for each row execute function private.set_created_by();

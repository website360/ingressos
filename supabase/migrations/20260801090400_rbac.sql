-- =============================================================================
-- 20260801090400_rbac
-- Catálogo de permissões, mapa papel→permissões (customizável por tenant),
-- exceções por usuário e escopo por evento (docs/07, seção 3).
-- =============================================================================

create table public.permissions (
  code        text primary key,
  module      text not null,
  description text not null,
  created_at  timestamptz not null default now()
);

comment on table public.permissions is 'Catálogo global de permissões. Somente leitura para os tenants.';

create table public.role_permissions (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  role            public.user_role not null,
  permission_code text not null references public.permissions (code) on delete cascade,
  created_at      timestamptz not null default now(),

  primary key (tenant_id, role, permission_code)
);

comment on table public.role_permissions is
  'Permissões por papel, por empresa. Semeado a partir do padrão e customizável.';

create table public.user_permission_overrides (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  granted         boolean not null,          -- true = concede, false = revoga
  reason          text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,

  primary key (tenant_id, user_id, permission_code)
);

-- Escopo por evento (recepção/organizador restritos). A tabela `events` chega no
-- M1; a FK é adicionada naquela migration para manter a ordem de dependências.
create table public.user_event_scopes (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,

  primary key (tenant_id, user_id, event_id)
);

create index ix_user_event_scopes_user on public.user_event_scopes (tenant_id, user_id);

-- -----------------------------------------------------------------------------
-- Catálogo de permissões (seed estrutural — faz parte do schema, não de dados)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('event.read',           'eventos',       'Visualizar eventos'),
  ('event.create',         'eventos',       'Criar eventos'),
  ('event.update',         'eventos',       'Editar eventos'),
  ('event.delete',         'eventos',       'Arquivar eventos'),
  ('event.publish',        'eventos',       'Publicar e despublicar eventos'),
  ('registration.read',    'inscricoes',    'Visualizar inscrições e participantes'),
  ('registration.create',  'inscricoes',    'Criar inscrições manualmente'),
  ('registration.update',  'inscricoes',    'Editar dados de inscrição'),
  ('registration.cancel',  'inscricoes',    'Cancelar inscrições'),
  ('registration.import',  'inscricoes',    'Importar participantes em massa'),
  ('registration.export',  'inscricoes',    'Exportar lista de participantes'),
  ('attendee.read_sensitive','inscricoes',  'Visualizar CPF e dados sensíveis sem máscara'),
  ('checkin.execute',      'checkin',       'Realizar check-in'),
  ('checkin.read',         'checkin',       'Visualizar check-ins'),
  ('checkin.override',     'checkin',       'Validar check-in fora do raio permitido'),
  ('waitlist.manage',      'inscricoes',    'Gerenciar lista de espera'),
  ('report.read',          'relatorios',    'Visualizar relatórios'),
  ('report.export',        'relatorios',    'Exportar relatórios'),
  ('dashboard.read',       'dashboard',     'Visualizar o dashboard'),
  ('support.read',         'suporte',       'Visualizar chamados'),
  ('support.write',        'suporte',       'Criar e responder chamados'),
  ('support.manage',       'suporte',       'Atribuir e encerrar chamados'),
  ('user.read',            'usuarios',      'Visualizar usuários da empresa'),
  ('user.manage',          'usuarios',      'Convidar, editar e remover usuários'),
  ('permission.manage',    'usuarios',      'Alterar permissões de papéis'),
  ('settings.read',        'configuracoes', 'Visualizar configurações'),
  ('settings.manage',      'configuracoes', 'Alterar configurações da empresa'),
  ('audit.read',           'auditoria',     'Consultar a trilha de auditoria'),
  ('api.manage',           'integracoes',   'Gerenciar chaves de API e webhooks')
on conflict (code) do update
  set module = excluded.module, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Permissões padrão por papel, aplicadas a cada novo tenant.
-- -----------------------------------------------------------------------------
create or replace function private.default_permissions(p_role public.user_role)
returns text[]
language sql
immutable
as $$
  select case p_role
    when 'admin' then
      array(select code from public.permissions)
    when 'organizador' then
      array[
        'event.read','event.create','event.update','event.publish',
        'registration.read','registration.create','registration.update','registration.cancel',
        'registration.import','registration.export','attendee.read_sensitive',
        'checkin.read','waitlist.manage',
        'report.read','report.export','dashboard.read',
        'support.read','support.write','user.read'
      ]
    when 'recepcao' then
      array['event.read','registration.read','checkin.execute','checkin.read','dashboard.read']
    when 'suporte' then
      array[
        'event.read','registration.read','registration.update',
        'checkin.read','report.read','dashboard.read',
        'support.read','support.write','support.manage','user.read'
      ]
  end;
$$;

-- Semeia role_permissions ao criar um tenant.
create or replace function private.seed_tenant_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role public.user_role;
begin
  foreach v_role in array enum_range(null::public.user_role) loop
    insert into public.role_permissions (tenant_id, role, permission_code)
    select new.id, v_role, unnest(private.default_permissions(v_role))
    on conflict do nothing;
  end loop;
  return new;
end;
$$;

create trigger tg_tenant_seed_permissions
  after insert on public.tenants
  for each row execute function private.seed_tenant_permissions();

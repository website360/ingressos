-- =============================================================================
-- 20260801090700_rls_policies
-- Row Level Security de todas as tabelas do M0.
-- Regra do projeto: nenhuma tabela existe sem RLS + FORCE (docs/07, seção 2).
-- =============================================================================

alter table public.tenants                   enable row level security;
alter table public.tenants                   force  row level security;
alter table public.profiles                  enable row level security;
alter table public.profiles                  force  row level security;
alter table public.memberships               enable row level security;
alter table public.memberships               force  row level security;
alter table public.tenant_invitations        enable row level security;
alter table public.tenant_invitations        force  row level security;
alter table public.tenant_settings           enable row level security;
alter table public.tenant_settings           force  row level security;
alter table public.permissions               enable row level security;
alter table public.permissions               force  row level security;
alter table public.role_permissions          enable row level security;
alter table public.role_permissions          force  row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.user_permission_overrides force  row level security;
alter table public.user_event_scopes         enable row level security;
alter table public.user_event_scopes         force  row level security;
alter table audit.audit_logs                 enable row level security;
alter table audit.audit_logs                 force  row level security;
alter table audit.auth_events                enable row level security;
alter table audit.auth_events                force  row level security;

-- -----------------------------------------------------------------------------
-- tenants
-- O usuário enxerga apenas as empresas às quais pertence (necessário para o
-- seletor de empresa). A escrita é restrita ao tenant ativo.
-- -----------------------------------------------------------------------------
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    (select private.is_platform_admin())
    -- `IN (SELECT unnest(...))` e não `= ANY (SELECT ...)`: o segundo é lido
    -- pelo parser como subconsulta de linhas e falha com "uuid = uuid[]", já
    -- que tenant_ids() devolve um array. A subconsulta aqui é não-correlacionada,
    -- então o planner a avalia uma única vez (InitPlan).
    or (id in (select unnest(private.tenant_ids())) and deleted_at is null)
  );

create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select private.current_tenant()) and (select private.has_perm('settings.manage')))
  with check (id = (select private.current_tenant()));

-- INSERT/DELETE de tenant é operação de plataforma (service role / super admin).
create policy tenants_admin_all on public.tenants
  for all to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- profiles
-- Cada um vê e edita o próprio perfil; colegas de empresa são visíveis para
-- quem tem user.read (necessário para exibir "criado por", responsáveis etc).
-- -----------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_teammates on public.profiles
  for select to authenticated
  using (
    (select private.has_perm('user.read'))
    and exists (
      select 1
        from public.memberships m
       where m.user_id = public.profiles.id
         and m.tenant_id = (select private.current_tenant())
         and m.status = 'ativo'
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- `is_platform_admin` não pode ser auto-concedido.
create or replace function private.guard_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and not coalesce((select private.is_platform_admin()), false) then
    raise exception 'Alteração de privilégio de plataforma não permitida.'
      using errcode = 'IG005';
  end if;
  return new;
end;
$$;

create trigger tg_profiles_guard_privileges
  before update on public.profiles
  for each row execute function private.guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- memberships
-- `select_own` é o que permite montar o seletor de empresas ANTES de existir
-- um tenant ativo — sem ele, o primeiro login fica sem contexto.
-- -----------------------------------------------------------------------------
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy memberships_select_tenant on public.memberships
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.read'))
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  );

-- Ninguém edita o próprio vínculo (impede autoescalonamento de papel).
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
    and user_id <> (select auth.uid())
  )
  with check (tenant_id = (select private.current_tenant()));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
    and user_id <> (select auth.uid())
    and not is_owner
  );

-- -----------------------------------------------------------------------------
-- tenant_invitations
-- -----------------------------------------------------------------------------
create policy invitations_select on public.tenant_invitations
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  );

create policy invitations_write on public.tenant_invitations
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  );

-- -----------------------------------------------------------------------------
-- tenant_settings
-- -----------------------------------------------------------------------------
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.read'))
  );

create policy tenant_settings_write on public.tenant_settings
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  );

-- -----------------------------------------------------------------------------
-- permissions — catálogo global, somente leitura
-- -----------------------------------------------------------------------------
create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

revoke insert, update, delete on public.permissions from authenticated, anon;

-- -----------------------------------------------------------------------------
-- role_permissions / user_permission_overrides / user_event_scopes
-- -----------------------------------------------------------------------------
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (tenant_id = (select private.current_tenant()));

create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('permission.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('permission.manage'))
  );

create policy overrides_select on public.user_permission_overrides
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (user_id = (select auth.uid()) or (select private.has_perm('user.read')))
  );

create policy overrides_write on public.user_permission_overrides
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('permission.manage'))
    and user_id <> (select auth.uid())
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('permission.manage'))
    and user_id <> (select auth.uid())
  );

create policy event_scopes_select on public.user_event_scopes
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (user_id = (select auth.uid()) or (select private.has_perm('user.read')))
  );

create policy event_scopes_write on public.user_event_scopes
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('user.manage'))
  );

-- -----------------------------------------------------------------------------
-- Auditoria — leitura restrita, escrita apenas por SECURITY DEFINER.
-- A ausência deliberada de policies de INSERT/UPDATE/DELETE é o que torna a
-- trilha inviolável a partir da API.
-- -----------------------------------------------------------------------------
grant select on audit.audit_logs, audit.auth_events to authenticated;
revoke insert, update, delete on audit.audit_logs, audit.auth_events from authenticated, anon;

create policy audit_logs_select on audit.audit_logs
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('audit.read'))
  );

create policy auth_events_select on audit.auth_events
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      tenant_id = (select private.current_tenant())
      and (select private.has_perm('audit.read'))
    )
  );

-- -----------------------------------------------------------------------------
-- O papel anônimo não tem nenhum acesso às tabelas do M0.
-- (A área pública do M1 usará views e RPCs específicas.)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.tenants to anon;   -- necessário para resolver /{tenant} na landing

create policy tenants_public_read on public.tenants
  for select to anon
  using (status in ('trial','ativo') and deleted_at is null);

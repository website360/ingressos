-- =============================================================================
-- 20260801090500_auth_hook
-- Custom Access Token Hook + helpers de RLS (ADR-004).
--
-- O JWT carrega tenant ativo, lista de tenants e permissões efetivas. Isso evita
-- um JOIN em `memberships` a cada política de RLS — a diferença é de ordem de
-- grandeza em tabelas grandes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissões efetivas do usuário em um tenant:
--   role_permissions  ∪  overrides concedidos  −  overrides revogados
-- -----------------------------------------------------------------------------
create or replace function private.effective_permissions(p_user_id uuid, p_tenant_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, private
as $$
  with base as (
    select rp.permission_code as code
      from public.memberships m
      join public.role_permissions rp
        on rp.tenant_id = m.tenant_id and rp.role = m.role
     where m.user_id = p_user_id
       and m.tenant_id = p_tenant_id
       and m.status = 'ativo'
  ),
  granted as (
    select o.permission_code as code
      from public.user_permission_overrides o
     where o.user_id = p_user_id and o.tenant_id = p_tenant_id and o.granted
  ),
  revoked as (
    select o.permission_code as code
      from public.user_permission_overrides o
     where o.user_id = p_user_id and o.tenant_id = p_tenant_id and not o.granted
  )
  select coalesce(array_agg(distinct code), '{}')
    from (
      select code from base
      union
      select code from granted
      except
      select code from revoked
    ) final;
$$;

-- -----------------------------------------------------------------------------
-- Hook chamado pelo GoTrue a cada emissão/refresh de token.
-- Configurado em supabase/config.toml → [auth.hook.custom_access_token]
-- -----------------------------------------------------------------------------
create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_user_id       uuid := (event ->> 'user_id')::uuid;
  v_claims        jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_app_metadata  jsonb := coalesce(v_claims -> 'app_metadata', '{}'::jsonb);
  v_tenant_ids    uuid[];
  v_active_tenant uuid;
  v_role          public.user_role;
  v_perms         text[];
  v_platform      boolean;
begin
  select coalesce(array_agg(m.tenant_id order by m.created_at), '{}')
    into v_tenant_ids
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = v_user_id
     and m.status = 'ativo'
     and t.deleted_at is null
     and t.status in ('trial','ativo');

  select p.active_tenant_id, p.is_platform_admin
    into v_active_tenant, v_platform
    from public.profiles p
   where p.id = v_user_id;

  -- Tenant ativo precisa pertencer ao usuário; senão cai no primeiro disponível.
  if v_active_tenant is null or not (v_active_tenant = any (v_tenant_ids)) then
    v_active_tenant := v_tenant_ids[1];
  end if;

  if v_active_tenant is not null then
    select m.role into v_role
      from public.memberships m
     where m.user_id = v_user_id and m.tenant_id = v_active_tenant and m.status = 'ativo';

    v_perms := private.effective_permissions(v_user_id, v_active_tenant);
  else
    v_perms := '{}';
  end if;

  v_app_metadata := v_app_metadata || jsonb_build_object(
    'tenant_ids',        to_jsonb(v_tenant_ids),
    'active_tenant',     v_active_tenant,
    'tenant_role',       v_role,
    'perms',             to_jsonb(coalesce(v_perms, '{}')),
    'is_platform_admin', coalesce(v_platform, false)
  );

  return jsonb_set(v_claims, '{app_metadata}', v_app_metadata);
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function private.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- O hook precisa ler estas tabelas com o papel do GoTrue.
grant select on public.memberships, public.profiles, public.tenants,
                public.role_permissions, public.user_permission_overrides
  to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Helpers de RLS. Sempre usados como (SELECT private.x()) nas políticas para
-- que o planner avalie uma única vez por query (InitPlan).
-- -----------------------------------------------------------------------------
create or replace function private.current_tenant()
returns uuid
language sql
stable
as $$
  select nullif(private.jwt_claims() -> 'app_metadata' ->> 'active_tenant', '')::uuid;
$$;

create or replace function private.tenant_ids()
returns uuid[]
language sql
stable
as $$
  select coalesce(
    array(
      select value::uuid
        from jsonb_array_elements_text(
          coalesce(private.jwt_claims() -> 'app_metadata' -> 'tenant_ids', '[]'::jsonb)
        ) as value
    ),
    '{}'::uuid[]
  );
$$;

create or replace function private.has_perm(p_code text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (private.jwt_claims() -> 'app_metadata' -> 'perms') ? p_code,
    false
  );
$$;

create or replace function private.current_role()
returns public.user_role
language sql
stable
as $$
  select nullif(private.jwt_claims() -> 'app_metadata' ->> 'tenant_role', '')::public.user_role;
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce((private.jwt_claims() -> 'app_metadata' ->> 'is_platform_admin')::boolean, false);
$$;

create or replace function private.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select p_tenant_id = any (private.tenant_ids());
$$;

comment on function private.current_tenant() is
  'Tenant ativo do JWT. Base de toda política de RLS.';

-- -----------------------------------------------------------------------------
-- Privilégios do schema `private`.
--
-- Políticas de RLS são avaliadas com o papel de quem consulta: sem USAGE no
-- schema + EXECUTE na função, toda query falharia com "permission denied".
-- Por isso: USAGE liberado, EXECUTE revogado em bloco e concedido apenas para
-- os helpers de leitura de claim. O schema continua fora da API (não está em
-- `[api].schemas` no config.toml), então nada aqui vira endpoint.
-- -----------------------------------------------------------------------------
grant usage on schema private to anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

grant execute on function private.jwt_claims()            to anon, authenticated;
grant execute on function private.request_headers()       to anon, authenticated;
grant execute on function private.request_context()       to anon, authenticated;
grant execute on function private.current_tenant()        to anon, authenticated;
grant execute on function private.tenant_ids()            to anon, authenticated;
grant execute on function private.has_perm(text)          to anon, authenticated;
grant execute on function private.current_role()          to anon, authenticated;
grant execute on function private.is_platform_admin()     to anon, authenticated;
grant execute on function private.is_member_of(uuid)      to anon, authenticated;

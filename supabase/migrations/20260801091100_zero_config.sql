-- =============================================================================
-- 20260801091100_zero_config
--
-- Elimina as duas configurações que só existiam no painel do Supabase e que,
-- por não estarem em migration nenhuma, quebravam qualquer ambiente novo:
--
--   1. "Exposed schemas" precisava listar `api`  → a fachada de RPC passa
--      para `public`, que é exposto por padrão.
--   2. "Custom Access Token Hook" precisava estar ligado → os helpers de RLS
--      passam a ler do JWT COM FALLBACK no banco.
--
-- Depois desta migration, um `db push` em projeto novo entrega o sistema
-- funcionando, sem nenhum clique. O hook continua valendo a pena (evita uma
-- consulta por query), mas virou otimização, não pré-requisito.
--
-- Reversão: ver 20260801090500_auth_hook.sql e 20260801090800_api_rpcs.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helpers de RLS: claim do JWT primeiro, banco como rede de segurança.
--
-- SECURITY DEFINER + dono `postgres` (que tem BYPASSRLS) é o que impede
-- recursão: sem isso, ler `profiles` dentro do helper dispararia a política de
-- `profiles`, que chama o helper de novo.
-- -----------------------------------------------------------------------------
create or replace function private.current_tenant()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    nullif(private.jwt_claims() -> 'app_metadata' ->> 'active_tenant', '')::uuid,
    (select p.active_tenant_id from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function private.tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    nullif(
      array(
        select value::uuid
          from jsonb_array_elements_text(
            coalesce(private.jwt_claims() -> 'app_metadata' -> 'tenant_ids', '[]'::jsonb)
          ) as value
      ),
      '{}'::uuid[]
    ),
    (
      select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
        from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where m.user_id = auth.uid()
         and m.status = 'ativo'
         and t.deleted_at is null
    )
  );
$$;

create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    nullif(private.jwt_claims() -> 'app_metadata' ->> 'tenant_role', '')::public.user_role,
    (
      select m.role
        from public.memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = private.current_tenant()
         and m.status = 'ativo'
    )
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (private.jwt_claims() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function private.has_perm(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    -- Com o hook ativo, resolve direto do token: nenhuma consulta.
    when private.jwt_claims() -> 'app_metadata' ? 'perms'
      then coalesce((private.jwt_claims() -> 'app_metadata' -> 'perms') ? p_code, false)
    -- Sem o hook, consulta o RBAC. Como a chamada é envolvida em (SELECT ...)
    -- nas políticas, o planner avalia uma vez por query, não por linha.
    else coalesce(
      p_code = any (private.effective_permissions(auth.uid(), private.current_tenant())),
      false
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Fachada de RPC em `public`
--
-- O schema `public` é exposto por padrão pelo PostgREST. Manter a fachada em
-- `api` exigia uma configuração de painel que nenhuma migration captura — o
-- tipo de passo manual que funciona no ambiente de quem configurou e falha em
-- todos os outros. A implementação continua sendo única.
-- -----------------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_active  uuid;
  v_result  jsonb;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = 'IG005';
  end if;

  select p.active_tenant_id into v_active from public.profiles p where p.id = v_user_id;

  -- Primeiro acesso sem empresa ativa definida: assume a primeira disponível.
  if v_active is null then
    select m.tenant_id into v_active
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where m.user_id = v_user_id and m.status = 'ativo' and t.deleted_at is null
     order by m.created_at
     limit 1;

    if v_active is not null then
      update public.profiles set active_tenant_id = v_active where id = v_user_id;
    end if;
  end if;

  select jsonb_build_object(
    'user', (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name,
        'avatar_url', p.avatar_url, 'locale', p.locale,
        'mfa_enabled', p.mfa_enabled, 'is_platform_admin', p.is_platform_admin
      )
      from public.profiles p where p.id = v_user_id
    ),
    'active_tenant_id', v_active,
    'tenants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'slug', t.slug,
        'logo_url', t.logo_url, 'brand_color', t.brand_color,
        'status', t.status, 'role', m.role, 'is_owner', m.is_owner
      ) order by t.name)
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_user_id and m.status = 'ativo' and t.deleted_at is null
    ), '[]'::jsonb),
    'permissions', coalesce(
      to_jsonb(private.effective_permissions(v_user_id, v_active)), '[]'::jsonb
    ),
    'role', (
      select m.role from public.memberships m
       where m.user_id = v_user_id and m.tenant_id = v_active and m.status = 'ativo'
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.switch_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_role    public.user_role;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = 'IG005';
  end if;

  select m.role into v_role
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = v_user_id
     and m.tenant_id = p_tenant_id
     and m.status = 'ativo'
     and t.deleted_at is null;

  if v_role is null then
    raise exception 'Você não tem acesso a esta empresa.' using errcode = 'IG005';
  end if;

  update public.profiles
     set active_tenant_id = p_tenant_id, updated_at = now()
   where id = v_user_id;

  perform audit.log('update', 'session.tenant', p_tenant_id, null, p_tenant_id);

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'role', v_role,
    'permissions', to_jsonb(private.effective_permissions(v_user_id, p_tenant_id))
  );
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_email   citext;
  v_inv     public.tenant_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = 'IG005';
  end if;

  select p.email into v_email from public.profiles p where p.id = v_user_id;

  select * into v_inv
    from public.tenant_invitations i
   where i.token_hash = digest(p_token, 'sha256')
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > now();

  if v_inv.id is null then
    raise exception 'Convite inválido ou expirado.' using errcode = 'IG003';
  end if;

  if lower(v_inv.email::text) <> lower(v_email::text) then
    raise exception 'Este convite foi enviado para outro e-mail.' using errcode = 'IG005';
  end if;

  insert into public.memberships (tenant_id, user_id, role, status, invited_by, accepted_at)
  values (v_inv.tenant_id, v_user_id, v_inv.role, 'ativo', v_inv.invited_by, now())
  on conflict (tenant_id, user_id) do update
    set status = 'ativo', accepted_at = now();

  update public.tenant_invitations set accepted_at = now() where id = v_inv.id;

  update public.profiles
     set active_tenant_id = coalesce(active_tenant_id, v_inv.tenant_id)
   where id = v_user_id;

  perform audit.log('permission_change', 'membership', v_user_id,
                    jsonb_build_object('role', v_inv.role, 'via', 'invitation'),
                    v_inv.tenant_id);

  return jsonb_build_object('tenant_id', v_inv.tenant_id, 'role', v_inv.role);
end;
$$;

create or replace function public.log_auth_event(
  p_event_type text,
  p_success    boolean default true,
  p_email      text default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private, audit
as $$
declare
  v_ctx jsonb := private.request_context();
begin
  if p_event_type not in ('login','logout','login_failed','password_reset','mfa_enrolled','mfa_failed') then
    raise exception 'Tipo de evento inválido.' using errcode = 'IG003';
  end if;

  insert into audit.auth_events (user_id, tenant_id, email, event_type, success, ip, user_agent, metadata)
  values (
    auth.uid(),
    private.current_tenant(),
    coalesce(p_email, nullif(private.jwt_claims() ->> 'email', ''))::citext,
    p_event_type,
    p_success,
    nullif(v_ctx ->> 'ip', '')::inet,
    nullif(v_ctx ->> 'user_agent', ''),
    coalesce(p_metadata, '{}'::jsonb)
  );

  if p_event_type = 'login' and auth.uid() is not null then
    update public.profiles set last_login_at = now() where id = auth.uid();
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Grants e remoção da fachada antiga (superfície única)
-- -----------------------------------------------------------------------------
grant execute on function public.my_context()            to authenticated;
grant execute on function public.switch_tenant(uuid)     to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.log_auth_event(text, boolean, text, jsonb) to anon, authenticated;

drop function if exists api.my_context();
drop function if exists api.switch_tenant(uuid);
drop function if exists api.accept_invitation(text);
drop function if exists api.log_auth_event(text, boolean, text, jsonb);

comment on schema api is
  'Reservado para a REST pública versionada (Sprint 10). A fachada de RPC do painel vive em public.';

comment on function public.my_context() is
  'Contexto completo da sessão em uma chamada: usuário, empresas, empresa ativa, papel e permissões.';

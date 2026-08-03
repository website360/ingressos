-- =============================================================================
-- 20260801090800_api_rpcs
-- Fachada de RPCs do M0: troca de empresa, contexto da sessão, convites e
-- registro de eventos de autenticação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- api.switch_tenant — troca a empresa ativa.
-- Após a chamada, o cliente DEVE renovar a sessão (refreshSession) para que o
-- novo tenant entre no JWT. Trocar cookie no cliente não muda nada (ADR-004).
-- -----------------------------------------------------------------------------
create or replace function api.switch_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, api
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

-- -----------------------------------------------------------------------------
-- api.my_context — contexto completo da sessão em uma única chamada.
-- Evita 3 round-trips no boot do painel.
-- -----------------------------------------------------------------------------
create or replace function api.my_context()
returns jsonb
language plpgsql
security definer
set search_path = public, private, api
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

-- -----------------------------------------------------------------------------
-- api.accept_invitation — aceita convite de empresa.
-- O token viaja apenas no e-mail; o banco guarda somente o hash.
-- -----------------------------------------------------------------------------
create or replace function api.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, api, extensions
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

-- -----------------------------------------------------------------------------
-- api.log_auth_event — trilha de autenticação (login, logout, falha).
-- Executável por anônimo para registrar tentativas de login malsucedidas.
-- -----------------------------------------------------------------------------
create or replace function api.log_auth_event(
  p_event_type text,
  p_success    boolean default true,
  p_email      text default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private, audit, api
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
-- Grants: apenas o schema `api` é chamável pelo cliente.
-- -----------------------------------------------------------------------------
grant execute on function api.switch_tenant(uuid)      to authenticated;
grant execute on function api.my_context()             to authenticated;
grant execute on function api.accept_invitation(text)  to authenticated;
grant execute on function api.log_auth_event(text, boolean, text, jsonb) to anon, authenticated;

revoke all on function private.effective_permissions(uuid, uuid) from anon, authenticated;

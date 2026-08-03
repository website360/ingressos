-- =============================================================================
-- 20260801090600_audit
-- Trilha de auditoria append-only, particionada por mês (docs/07, seção 10).
-- =============================================================================

create table audit.audit_logs (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid,
  actor_id    uuid,
  actor_email text,
  actor_role  text,
  action      audit.audit_action not null,
  entity_type text not null,
  entity_id   uuid,
  changes     jsonb,                       -- { before: {...}, after: {...}, fields: [...] }
  ip          inet,
  user_agent  text,
  device_id   text,
  location    geography(Point, 4326),
  request_id  uuid,
  created_at  timestamptz not null default now(),

  primary key (id, created_at)
) partition by range (created_at);

comment on table audit.audit_logs is
  'Append-only. Nenhum papel possui UPDATE/DELETE — garantido por policy e por trigger.';

create index ix_audit_tenant_time on audit.audit_logs (tenant_id, created_at desc);
create index ix_audit_entity      on audit.audit_logs (tenant_id, entity_type, entity_id, created_at desc);
create index ix_audit_actor       on audit.audit_logs (tenant_id, actor_id, created_at desc);
create index ix_audit_request     on audit.audit_logs (request_id);

-- -----------------------------------------------------------------------------
-- Partições: cria a do mês informado (idempotente).
-- -----------------------------------------------------------------------------
create or replace function audit.ensure_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = audit, public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
begin
  if to_regclass(format('audit.%I', v_name)) is null then
    execute format(
      'create table audit.%I partition of audit.audit_logs for values from (%L) to (%L)',
      v_name, v_start, v_end
    );
  end if;
end;
$$;

-- Partições do mês corrente e dos dois seguintes.
select audit.ensure_partition(current_date);
select audit.ensure_partition((current_date + interval '1 month')::date);
select audit.ensure_partition((current_date + interval '2 months')::date);

-- -----------------------------------------------------------------------------
-- Eventos de autenticação (login, logout, falhas, MFA)
-- -----------------------------------------------------------------------------
create table audit.auth_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  tenant_id  uuid,
  email      citext,
  event_type text not null,               -- login | logout | login_failed | mfa_enrolled | ...
  success    boolean not null default true,
  ip         inet,
  user_agent text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ix_auth_events_user on audit.auth_events (user_id, created_at desc);
create index ix_auth_events_email on audit.auth_events (email, created_at desc);

-- -----------------------------------------------------------------------------
-- Escrita da trilha. Única porta de entrada — SECURITY DEFINER.
-- -----------------------------------------------------------------------------
create or replace function audit.log(
  p_action      audit.audit_action,
  p_entity_type text,
  p_entity_id   uuid,
  p_changes     jsonb default null,
  p_tenant_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = audit, public, private
as $$
declare
  v_ctx    jsonb := private.request_context();
  v_claims jsonb := private.jwt_claims();
begin
  insert into audit.audit_logs (
    tenant_id, actor_id, actor_email, actor_role, action,
    entity_type, entity_id, changes, ip, user_agent, device_id, location, request_id
  )
  values (
    coalesce(p_tenant_id, private.current_tenant()),
    auth.uid(),
    nullif(v_claims ->> 'email', ''),
    nullif(v_claims -> 'app_metadata' ->> 'tenant_role', ''),
    p_action,
    p_entity_type,
    p_entity_id,
    p_changes,
    nullif(v_ctx ->> 'ip', '')::inet,
    nullif(v_ctx ->> 'user_agent', ''),
    nullif(v_ctx ->> 'device_id', ''),
    case
      when (v_ctx ->> 'longitude') is not null and (v_ctx ->> 'latitude') is not null
      then st_setsrid(
             st_makepoint((v_ctx ->> 'longitude')::float8, (v_ctx ->> 'latitude')::float8),
             4326
           )::geography
    end,
    nullif(v_ctx ->> 'request_id', '')::uuid
  );
exception
  when others then
    -- Auditoria jamais derruba a operação de negócio; a falha é registrada no log do servidor.
    raise warning 'Falha ao gravar auditoria (%): %', p_entity_type, sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger genérico de auditoria de dados (ADR-013).
-- Uso: create trigger tg_audit_<tabela> after insert or update or delete on <t>
--        for each row execute function audit.track_changes('<entity_type>');
-- -----------------------------------------------------------------------------
create or replace function audit.track_changes()
returns trigger
language plpgsql
security definer
set search_path = audit, public, private
as $$
declare
  v_entity   text := coalesce(tg_argv[0], tg_table_name);
  v_action   audit.audit_action;
  v_before   jsonb;
  v_after    jsonb;
  v_changed  text[];
  v_tenant   uuid;
  v_id       uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_after  := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    select coalesce(array_agg(key), '{}')
      into v_changed
      from jsonb_each(v_after) e(key, value)
     where v_before -> e.key is distinct from e.value
       and e.key not in ('updated_at', 'updated_by');
    if v_changed = '{}' then
      return coalesce(new, old);      -- nada relevante mudou: não polui a trilha
    end if;
  else
    v_action := 'delete';
    v_before := to_jsonb(old);
  end if;

  v_tenant := coalesce((v_after ->> 'tenant_id')::uuid, (v_before ->> 'tenant_id')::uuid);
  v_id     := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);

  perform audit.log(
    v_action,
    v_entity,
    v_id,
    jsonb_strip_nulls(jsonb_build_object(
      'before', v_before,
      'after',  v_after,
      'fields', to_jsonb(v_changed)
    )),
    v_tenant
  );

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- Imutabilidade: nem o dono da tabela altera a trilha.
-- -----------------------------------------------------------------------------
create or replace function audit.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A trilha de auditoria é imutável (append-only).'
    using errcode = 'IG005';
end;
$$;

create trigger tg_audit_logs_immutable
  before update or delete on audit.audit_logs
  for each statement execute function audit.prevent_mutation();

create trigger tg_auth_events_immutable
  before update or delete on audit.auth_events
  for each statement execute function audit.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Auditoria das tabelas do M0
-- -----------------------------------------------------------------------------
create trigger tg_audit_tenants
  after insert or update or delete on public.tenants
  for each row execute function audit.track_changes('tenant');

create trigger tg_audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function audit.track_changes('membership');

create trigger tg_audit_role_permissions
  after insert or update or delete on public.role_permissions
  for each row execute function audit.track_changes('role_permission');

create trigger tg_audit_user_overrides
  after insert or update or delete on public.user_permission_overrides
  for each row execute function audit.track_changes('user_permission_override');

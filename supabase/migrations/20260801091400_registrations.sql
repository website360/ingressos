-- =============================================================================
-- 20260801091400_registrations
-- Módulo M2/M3 — participantes, inscrições, ingressos, lista de espera,
-- cancelamentos e check-in, com as RPCs transacionais (docs/02, seções 4 a 6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Segredo de assinatura dos ingressos
-- Vive em `private`, fora da API. Sprint 7 troca por Ed25519 (chave pública
-- distribuível) para permitir validação offline; o HMAC já impede falsificação.
-- -----------------------------------------------------------------------------
create table private.signing_secrets (
  id         int primary key default 1 check (id = 1),
  secret     bytea not null default gen_random_bytes(32),
  created_at timestamptz not null default now()
);

insert into private.signing_secrets (id) values (1) on conflict do nothing;

create or replace function private.sign_code(p_code text)
returns text
language sql
stable
security definer
set search_path = private, extensions
as $$
  -- convert_to é obrigatório: pgcrypto expõe hmac(bytea,bytea,text) e
  -- hmac(text,text,text); misturar text com bytea não resolve sobrecarga.
  select substr(
    encode(
      hmac(
        convert_to(p_code, 'UTF8'),
        (select secret from private.signing_secrets where id = 1),
        'sha256'
      ),
      'hex'
    ),
    1, 32
  );
$$;

-- -----------------------------------------------------------------------------
-- attendees — a pessoa, deduplicada por CPF
-- -----------------------------------------------------------------------------
create table public.attendees (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  first_name     text not null,
  last_name      text not null default '',
  cpf            text not null check (cpf ~ '^[0-9]{11}$'),
  email          citext not null,
  phone          text,
  birth_date     date,
  gender         text,
  city           text,
  state          char(2),
  country        text not null default 'BR',
  company        text,
  job_title      text,
  photo_url      text,
  metadata       jsonb not null default '{}'::jsonb,
  anonymized_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint uq_attendee_cpf unique (tenant_id, cpf)
);

create index ix_attendees_email on public.attendees (tenant_id, email);
create index ix_attendees_cpf   on public.attendees (tenant_id, cpf);

-- `unaccent(text)` é STABLE (depende do dicionário em uso) e o Postgres recusa
-- expressões não-imutáveis em índice. A forma de dois argumentos, com o
-- dicionário fixado, é IMMUTABLE — daí o wrapper.
create or replace function private.unaccent_immutable(text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1);
$$;

create index ix_attendees_search on public.attendees
  using gin ((private.unaccent_immutable(lower(first_name || ' ' || last_name))) gin_trgm_ops);

create trigger tg_attendees_updated_at before update on public.attendees
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- registrations
-- -----------------------------------------------------------------------------
create table public.registrations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  event_id        uuid not null references public.events (id) on delete cascade,
  attendee_id     uuid not null references public.attendees (id) on delete cascade,
  ticket_type_id  uuid references public.ticket_types (id) on delete set null,

  number          text not null,
  status          public.registration_status not null default 'confirmada',
  source          text not null default 'landing',
  referral        text,
  custom_fields   jsonb not null default '{}'::jsonb,

  confirmed_at    timestamptz,
  cancelled_at    timestamptz,

  ip              inet,
  user_agent      text,
  idempotency_key text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_registration_number unique (tenant_id, number)
);

-- RN-02: um CPF, uma inscrição ativa por evento. Índice parcial permite
-- reinscrição após cancelamento sem abrir brecha para duplicidade.
create unique index uq_registration_active_cpf
  on public.registrations (event_id, attendee_id)
  where status in ('pendente', 'confirmada');

create unique index uq_registration_idem
  on public.registrations (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index ix_registrations_listing  on public.registrations (tenant_id, event_id, status, created_at desc);
create index ix_registrations_attendee on public.registrations (tenant_id, attendee_id);

create trigger tg_registrations_updated_at before update on public.registrations
  for each row execute function private.set_updated_at();

-- Numeração legível e sequencial por evento (EVT-2026-000123).
create or replace function private.generate_registration_number()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_seq int;
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;

  select count(*) + 1 into v_seq from public.registrations where event_id = new.event_id;
  new.number := 'EVT-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

create trigger tg_registration_number before insert on public.registrations
  for each row execute function private.generate_registration_number();

-- -----------------------------------------------------------------------------
-- Contadores materializados — o que faz a constraint de capacidade funcionar.
-- -----------------------------------------------------------------------------
create or replace function private.sync_event_counters()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_old public.registration_status := case when tg_op = 'INSERT' then null else old.status end;
  v_new public.registration_status := case when tg_op = 'DELETE' then null else new.status end;
  v_event uuid := coalesce(new.event_id, old.event_id);
begin
  if v_old is not distinct from v_new then
    return coalesce(new, old);
  end if;

  update public.events
     set seats_taken = seats_taken
           - (case when v_old in ('pendente','confirmada') then 1 else 0 end)
           + (case when v_new in ('pendente','confirmada') then 1 else 0 end),
         seats_waitlist = seats_waitlist
           - (case when v_old = 'lista_espera' then 1 else 0 end)
           + (case when v_new = 'lista_espera' then 1 else 0 end),
         cancelled_count = cancelled_count
           + (case when v_new = 'cancelada' then 1 else 0 end)
           - (case when v_old = 'cancelada' then 1 else 0 end)
   where id = v_event;

  return coalesce(new, old);
end;
$$;

create trigger tg_registration_counters
  after insert or update of status or delete on public.registrations
  for each row execute function private.sync_event_counters();

-- -----------------------------------------------------------------------------
-- consents — LGPD versionado
-- -----------------------------------------------------------------------------
create table public.consents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  registration_id  uuid not null references public.registrations (id) on delete cascade,
  document_type    text not null,
  document_version int not null default 1,
  accepted         boolean not null,
  accepted_at      timestamptz not null default now(),
  ip               inet,
  user_agent       text
);

create index ix_consents_registration on public.consents (registration_id);

-- -----------------------------------------------------------------------------
-- tickets
-- -----------------------------------------------------------------------------
create table public.tickets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  event_id        uuid not null references public.events (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,

  code            text not null unique,
  signature       text not null,
  status          public.ticket_status not null default 'valido',

  issued_at       timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,

  pdf_path        text,
  reissued_from   uuid references public.tickets (id) on delete set null,

  created_at      timestamptz not null default now()
);

create index ix_tickets_event        on public.tickets (tenant_id, event_id, status);
create index ix_tickets_registration on public.tickets (registration_id);

-- -----------------------------------------------------------------------------
-- waitlist
-- -----------------------------------------------------------------------------
create table public.waitlist (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants (id) on delete cascade,
  event_id                 uuid not null references public.events (id) on delete cascade,
  attendee_id              uuid not null references public.attendees (id) on delete cascade,
  status                   public.waitlist_status not null default 'aguardando',
  invited_at               timestamptz,
  expires_at               timestamptz,
  notified_count           int not null default 0,
  converted_registration_id uuid references public.registrations (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index uq_waitlist_active
  on public.waitlist (event_id, attendee_id)
  where status in ('aguardando', 'convocado');

create index ix_waitlist_queue on public.waitlist (tenant_id, event_id, status, created_at);

create trigger tg_waitlist_updated_at before update on public.waitlist
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- cancellations
-- -----------------------------------------------------------------------------
create table public.cancellations (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants (id) on delete cascade,
  event_id                  uuid not null references public.events (id) on delete cascade,
  registration_id           uuid not null references public.registrations (id) on delete cascade,
  ticket_id                 uuid references public.tickets (id) on delete set null,
  reason_code               text,
  reason_text               text,
  cancelled_by_type         text not null default 'participante'
    check (cancelled_by_type in ('participante', 'operador', 'sistema')),
  cancelled_by_user         uuid references public.profiles (id) on delete set null,
  ip                        inet,
  user_agent                text,
  seat_released             boolean not null default true,
  replaced_by_registration_id uuid references public.registrations (id) on delete set null,
  created_at                timestamptz not null default now()
);

create index ix_cancellations_listing on public.cancellations (tenant_id, event_id, created_at desc);

-- -----------------------------------------------------------------------------
-- checkins
-- -----------------------------------------------------------------------------
create table public.checkins (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  event_id           uuid not null references public.events (id) on delete cascade,
  ticket_id          uuid references public.tickets (id) on delete cascade,
  registration_id    uuid references public.registrations (id) on delete cascade,

  result             public.checkin_result not null,
  checked_in_at      timestamptz not null default now(),
  synced_at          timestamptz not null default now(),

  operator_id        uuid references public.profiles (id) on delete set null,
  device_id          text,
  device_info        text,
  user_agent         text,
  ip                 inet,

  location           geography(Point, 4326),
  accuracy_m         numeric,
  city               text,
  state              char(2),
  country            text,
  within_geofence    boolean,
  distance_m         numeric,
  override_confirmed boolean not null default false,
  override_reason    text,

  offline_captured   boolean not null default false,
  idempotency_key    text,
  source             text not null default 'scanner',

  created_at         timestamptz not null default now()
);

-- RN-03: um único check-in válido por ingresso. É este índice que torna
-- "ingresso já utilizado" impossível de burlar, inclusive na sincronização
-- de dois dispositivos offline.
create unique index uq_checkin_valid on public.checkins (ticket_id) where result = 'sucesso';
create unique index uq_checkin_idem  on public.checkins (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index ix_checkins_event on public.checkins (tenant_id, event_id, checked_in_at desc);
create index ix_checkins_geo   on public.checkins using gist (location);

create or replace function private.sync_checkin_counter()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.result = 'sucesso' then
    update public.events set checked_in_count = checked_in_count + 1 where id = new.event_id;
  end if;
  return new;
end;
$$;

create trigger tg_checkin_counter after insert on public.checkins
  for each row execute function private.sync_checkin_counter();

-- =============================================================================
-- RPCs transacionais
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_registration — inscrição atômica (docs/02, seção 4)
-- -----------------------------------------------------------------------------
create or replace function public.create_registration(
  p_event_id uuid,
  p_attendee jsonb,
  p_consents jsonb default '[]'::jsonb,
  p_context  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_event       public.events%rowtype;
  v_tenant      uuid;
  v_attendee_id uuid;
  v_reg_id      uuid;
  v_ticket_id   uuid;
  v_code        text;
  v_full        boolean;
  v_consent     jsonb;
  v_position    int;
begin
  perform private.set_request_context(p_context);

  -- FOR UPDATE serializa as inscrições concorrentes deste evento. Sem o lock,
  -- dois pedidos leem 99/100 e ambos inserem.
  select * into v_event from public.events where id = p_event_id for update;

  if v_event.id is null or v_event.deleted_at is not null then
    raise exception 'Evento não encontrado.' using errcode = 'IG003';
  end if;

  if v_event.status <> 'publicado' then
    raise exception 'As inscrições para este evento não estão abertas.' using errcode = 'IG001';
  end if;

  if v_event.registration_deadline is not null and v_event.registration_deadline < now() then
    raise exception 'O prazo de inscrição terminou.' using errcode = 'IG001';
  end if;

  v_tenant := v_event.tenant_id;
  v_full := v_event.seats_taken >= floor(v_event.capacity * (1 + v_event.overbooking_pct / 100.0));

  -- Participante: deduplicado por CPF, dados sempre atualizados.
  insert into public.attendees (
    tenant_id, first_name, last_name, cpf, email, phone, birth_date,
    gender, city, state, company, job_title
  )
  values (
    v_tenant,
    p_attendee ->> 'first_name',
    coalesce(p_attendee ->> 'last_name', ''),
    regexp_replace(coalesce(p_attendee ->> 'cpf', ''), '\D', '', 'g'),
    p_attendee ->> 'email',
    p_attendee ->> 'phone',
    nullif(p_attendee ->> 'birth_date', '')::date,
    p_attendee ->> 'gender',
    p_attendee ->> 'city',
    nullif(p_attendee ->> 'state', ''),
    p_attendee ->> 'company',
    p_attendee ->> 'job_title'
  )
  on conflict (tenant_id, cpf) do update
    set email      = excluded.email,
        phone      = coalesce(excluded.phone, public.attendees.phone),
        first_name = excluded.first_name,
        last_name  = excluded.last_name,
        city       = coalesce(excluded.city, public.attendees.city),
        state      = coalesce(excluded.state, public.attendees.state),
        company    = coalesce(excluded.company, public.attendees.company),
        job_title  = coalesce(excluded.job_title, public.attendees.job_title),
        updated_at = now()
  returning id into v_attendee_id;

  -- Evento lotado: entra na fila em vez de recusar.
  if v_full then
    if not v_event.waitlist_enabled then
      raise exception 'As vagas se esgotaram.' using errcode = 'IG002';
    end if;

    insert into public.waitlist (tenant_id, event_id, attendee_id)
    values (v_tenant, p_event_id, v_attendee_id)
    on conflict do nothing;

    select count(*) into v_position
      from public.waitlist
     where event_id = p_event_id and status = 'aguardando';

    return jsonb_build_object('status', 'lista_espera', 'position', v_position);
  end if;

  insert into public.registrations (
    tenant_id, event_id, attendee_id, ticket_type_id, status, source, referral,
    custom_fields, confirmed_at, ip, user_agent, idempotency_key
  )
  values (
    v_tenant, p_event_id, v_attendee_id,
    nullif(p_attendee ->> 'ticket_type_id', '')::uuid,
    'confirmada',
    coalesce(p_context ->> 'source', 'landing'),
    p_attendee ->> 'referral',
    coalesce(p_attendee -> 'custom_fields', '{}'::jsonb),
    now(),
    nullif(p_context ->> 'ip', '')::inet,
    p_context ->> 'user_agent',
    nullif(p_context ->> 'idempotency_key', '')
  )
  returning id into v_reg_id;

  -- Código legível de 12 caracteres, sem sequência, com assinatura HMAC.
  v_code := upper(substr(encode(gen_random_bytes(16), 'hex'), 1, 12));

  insert into public.tickets (tenant_id, event_id, registration_id, code, signature, expires_at)
  values (v_tenant, p_event_id, v_reg_id, v_code, private.sign_code(v_code), v_event.ends_at)
  returning id into v_ticket_id;

  for v_consent in select * from jsonb_array_elements(coalesce(p_consents, '[]'::jsonb))
  loop
    insert into public.consents (
      tenant_id, registration_id, document_type, document_version, accepted, ip, user_agent
    )
    values (
      v_tenant, v_reg_id,
      v_consent ->> 'type',
      coalesce((v_consent ->> 'version')::int, 1),
      coalesce((v_consent ->> 'accepted')::boolean, true),
      nullif(p_context ->> 'ip', '')::inet,
      p_context ->> 'user_agent'
    );
  end loop;

  perform audit.log('create', 'registration', v_reg_id,
                    jsonb_build_object('event_id', p_event_id), v_tenant);

  return jsonb_build_object(
    'status', 'confirmada',
    'registration_id', v_reg_id,
    'ticket_id', v_ticket_id,
    'ticket_code', v_code,
    'token', v_code || '.' || private.sign_code(v_code),
    'number', (select number from public.registrations where id = v_reg_id)
  );
exception
  when check_violation then
    -- A constraint de capacidade estourou entre a leitura e o insert.
    raise exception 'As vagas se esgotaram.' using errcode = 'IG002';
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_registration
-- -----------------------------------------------------------------------------
create or replace function public.cancel_registration(
  p_registration_id uuid,
  p_reason_code     text default null,
  p_reason_text     text default null,
  p_context         jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reg    public.registrations%rowtype;
  v_ticket uuid;
begin
  perform private.set_request_context(p_context);

  select * into v_reg from public.registrations where id = p_registration_id for update;

  if v_reg.id is null then
    raise exception 'Inscrição não encontrada.' using errcode = 'IG003';
  end if;

  if v_reg.status = 'cancelada' then
    raise exception 'Esta inscrição já foi cancelada.' using errcode = 'IG003';
  end if;

  update public.registrations
     set status = 'cancelada', cancelled_at = now()
   where id = p_registration_id;

  update public.tickets
     set status = 'cancelado', revoked_at = now(), revoked_reason = coalesce(p_reason_code, 'cancelamento')
   where registration_id = p_registration_id and status = 'valido'
  returning id into v_ticket;

  insert into public.cancellations (
    tenant_id, event_id, registration_id, ticket_id, reason_code, reason_text,
    cancelled_by_type, cancelled_by_user, ip, user_agent
  )
  values (
    v_reg.tenant_id, v_reg.event_id, p_registration_id, v_ticket, p_reason_code, p_reason_text,
    case when auth.uid() is null then 'participante' else 'operador' end,
    auth.uid(),
    nullif(p_context ->> 'ip', '')::inet,
    p_context ->> 'user_agent'
  );

  perform audit.log('cancel', 'registration', p_registration_id,
                    jsonb_build_object('reason', p_reason_code), v_reg.tenant_id);

  return jsonb_build_object('status', 'cancelada', 'registration_id', p_registration_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- checkin — valida assinatura, status, duplicidade e geofence
-- -----------------------------------------------------------------------------
create or replace function public.checkin(
  p_token   text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_code      text := split_part(p_token, '.', 1);
  v_sig       text := split_part(p_token, '.', 2);
  v_ticket    public.tickets%rowtype;
  v_reg       public.registrations%rowtype;
  v_attendee  public.attendees%rowtype;
  v_event     public.events%rowtype;
  v_previous  public.checkins%rowtype;
  v_result    public.checkin_result;
  v_within    boolean;
  v_distance  numeric;
  v_point     geography;
begin
  perform private.set_request_context(p_context);

  select * into v_ticket from public.tickets where code = v_code;

  -- Assinatura inválida: o código não foi emitido por este sistema.
  if v_ticket.id is null or v_sig is distinct from private.sign_code(v_code) then
    return jsonb_build_object('result', 'invalido', 'message', 'Ingresso inválido.');
  end if;

  select * into v_event    from public.events        where id = v_ticket.event_id;
  select * into v_reg      from public.registrations where id = v_ticket.registration_id;
  select * into v_attendee from public.attendees     where id = v_reg.attendee_id;

  if (p_context ->> 'latitude') is not null then
    v_point := st_setsrid(
      st_makepoint((p_context ->> 'longitude')::float8, (p_context ->> 'latitude')::float8), 4326
    )::geography;

    if v_event.location is not null then
      v_distance := st_distance(v_event.location, v_point);
      v_within := v_distance <= v_event.allowed_radius_m;
    end if;
  end if;

  if v_ticket.status = 'cancelado' or v_reg.status = 'cancelada' then
    v_result := 'cancelado';
  else
    select * into v_previous
      from public.checkins
     where ticket_id = v_ticket.id and result = 'sucesso'
     limit 1;

    if v_previous.id is not null then
      v_result := 'duplicado';
    elsif v_within is false and not coalesce((p_context ->> 'override')::boolean, false) then
      v_result := 'fora_do_raio';
    else
      v_result := 'sucesso';
    end if;
  end if;

  insert into public.checkins (
    tenant_id, event_id, ticket_id, registration_id, result, operator_id,
    device_id, user_agent, ip, location, accuracy_m, within_geofence, distance_m,
    override_confirmed, override_reason, offline_captured, idempotency_key, source,
    checked_in_at
  )
  values (
    v_ticket.tenant_id, v_ticket.event_id, v_ticket.id, v_ticket.registration_id, v_result, auth.uid(),
    p_context ->> 'device_id', p_context ->> 'user_agent', nullif(p_context ->> 'ip', '')::inet,
    v_point, nullif(p_context ->> 'accuracy_m', '')::numeric, v_within, v_distance,
    coalesce((p_context ->> 'override')::boolean, false), p_context ->> 'override_reason',
    coalesce((p_context ->> 'offline')::boolean, false),
    nullif(p_context ->> 'idempotency_key', ''),
    coalesce(p_context ->> 'source', 'scanner'),
    coalesce(nullif(p_context ->> 'checked_in_at', '')::timestamptz, now())
  );

  if v_result = 'sucesso' then
    update public.tickets set status = 'utilizado' where id = v_ticket.id;
  end if;

  perform audit.log('checkin', 'ticket', v_ticket.id,
                    jsonb_build_object('result', v_result), v_ticket.tenant_id);

  return jsonb_build_object(
    'result', v_result,
    'ticket_code', v_ticket.code,
    'event', jsonb_build_object('id', v_event.id, 'name', v_event.name),
    'attendee', jsonb_build_object(
      'name', v_attendee.first_name || ' ' || v_attendee.last_name,
      'cpf_masked', '***.' || substr(v_attendee.cpf, 4, 3) || '.' || substr(v_attendee.cpf, 7, 3) || '-**',
      'photo_url', v_attendee.photo_url
    ),
    'registration_number', v_reg.number,
    'within_geofence', v_within,
    'distance_m', v_distance,
    -- Em caso de duplicidade, devolve a prova da primeira entrada (RF-07.4).
    'first_checkin', case when v_result = 'duplicado' then jsonb_build_object(
      'at', v_previous.checked_in_at,
      'operator', (select full_name from public.profiles where id = v_previous.operator_id)
    ) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- promote_waitlist — convoca N próximos da fila
-- -----------------------------------------------------------------------------
create or replace function public.promote_waitlist(p_event_id uuid, p_slots int default 1)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event public.events%rowtype;
  v_count int := 0;
  v_row   record;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'IG003';
  end if;

  for v_row in
    select * from public.waitlist
     where event_id = p_event_id and status = 'aguardando'
     order by created_at
     limit greatest(p_slots, 0)
  loop
    update public.waitlist
       set status = 'convocado',
           invited_at = now(),
           expires_at = now() + make_interval(hours => v_event.waitlist_hold_hours),
           notified_count = notified_count + 1
     where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_ticket — acesso do participante ao próprio ingresso, sem sessão
-- -----------------------------------------------------------------------------
create or replace function public.get_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_code   text := split_part(p_token, '.', 1);
  v_sig    text := split_part(p_token, '.', 2);
  v_result jsonb;
begin
  if v_sig is distinct from private.sign_code(v_code) then
    return null;
  end if;

  select jsonb_build_object(
    'ticket', jsonb_build_object('code', t.code, 'status', t.status, 'issued_at', t.issued_at),
    'registration', jsonb_build_object('id', r.id, 'number', r.number, 'status', r.status),
    'attendee', jsonb_build_object(
      'name', a.first_name || ' ' || a.last_name, 'email', a.email
    ),
    'event', jsonb_build_object(
      'id', e.id, 'name', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'venue_name', e.venue_name, 'address', e.address, 'city', e.city, 'state', e.state,
      'google_maps_url', e.google_maps_url, 'banner_url', e.banner_url, 'timezone', e.timezone
    )
  ) into v_result
    from public.tickets t
    join public.registrations r on r.id = t.registration_id
    join public.attendees a     on a.id = r.attendee_id
    join public.events e        on e.id = t.event_id
   where t.code = v_code;

  return v_result;
end;
$$;

grant execute on function public.create_registration(uuid, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.cancel_registration(uuid, text, text, jsonb)   to anon, authenticated;
grant execute on function public.get_ticket(text)                               to anon, authenticated;
grant execute on function public.checkin(text, jsonb)                           to authenticated;
grant execute on function public.promote_waitlist(uuid, int)                    to authenticated;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'attendees','registrations','consents','tickets','waitlist','cancellations','checkins'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end;
$$;

create policy attendees_select on public.attendees
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy attendees_write on public.attendees
  for all to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.update')))
  with check (tenant_id = (select private.current_tenant()));

create policy registrations_select on public.registrations
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy registrations_write on public.registrations
  for all to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.update')))
  with check (tenant_id = (select private.current_tenant()));

create policy tickets_select on public.tickets
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy consents_select on public.consents
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy waitlist_select on public.waitlist
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy waitlist_write on public.waitlist
  for all to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('waitlist.manage')))
  with check (tenant_id = (select private.current_tenant()));

create policy cancellations_select on public.cancellations
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('registration.read')));

create policy checkins_select on public.checkins
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('checkin.read')));

-- =============================================================================
-- Reversão de 20260801094300_whatsapp_escala_fila
-- Devolve as definições anteriores (copiadas das migrations de origem) e remove
-- as funções novas. As notificações já gravadas ficam (some só com 094100).
-- =============================================================================

-- 20260801093300_ticket_token_nas_mensagens
create or replace function private.enqueue_confirmation_messages()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reg      public.registrations%rowtype;
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
  v_token    text;
  v_whatsapp boolean;
begin
  select * into v_reg from public.registrations where id = new.registration_id;

  if v_reg.id is null or v_reg.status <> 'confirmada' then
    return new;
  end if;

  select * into v_event    from public.events    where id = v_reg.event_id;
  select * into v_attendee from public.attendees where id = v_reg.attendee_id;

  v_token := new.code || '.' || new.signature;

  select exists (
    select 1 from public.whatsapp_connections where tenant_id = v_reg.tenant_id
  ) into v_whatsapp;

  insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
  values (
    v_reg.tenant_id,
    'email.registration_confirmed',
    jsonb_build_object(
      'registration_id', v_reg.id,
      'to', v_attendee.email,
      'name', v_attendee.first_name,
      'event_name', v_event.name,
      'event_starts_at', v_event.starts_at,
      'venue', coalesce(v_event.venue_name, ''),
      'city', coalesce(v_event.city, ''),
      'number', v_reg.number,
      'ticket_code', new.code,
      'token', v_token
    ),
    'reg-confirmed-' || v_reg.id
  )
  on conflict (dedupe_key) do nothing;

  if v_whatsapp and coalesce(v_attendee.phone, '') <> '' then
    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
    values (
      v_reg.tenant_id,
      'whatsapp.registration_confirmed',
      jsonb_build_object(
        'registration_id', v_reg.id,
        'phone', v_attendee.phone,
        'name', v_attendee.first_name,
        'event_name', v_event.name,
        'event_starts_at', v_event.starts_at,
        'venue', coalesce(v_event.venue_name, ''),
        'city', coalesce(v_event.city, ''),
        'number', v_reg.number,
        'ticket_code', new.code,
        'token', v_token
      ),
      'wa-reg-confirmed-' || v_reg.id
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

create or replace function private.enqueue_cancellation_messages()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
  v_whatsapp boolean;
begin
  if new.status <> 'cancelada' or old.status = 'cancelada' then
    return new;
  end if;

  select * into v_event    from public.events    where id = new.event_id;
  select * into v_attendee from public.attendees where id = new.attendee_id;

  select exists (
    select 1 from public.whatsapp_connections where tenant_id = new.tenant_id
  ) into v_whatsapp;

  insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
  values (
    new.tenant_id,
    'email.registration_cancelled',
    jsonb_build_object(
      'registration_id', new.id,
      'to', v_attendee.email,
      'name', v_attendee.first_name,
      'event_name', v_event.name,
      'number', new.number
    ),
    'reg-cancelled-' || new.id
  )
  on conflict (dedupe_key) do nothing;

  if v_whatsapp and coalesce(v_attendee.phone, '') <> '' then
    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
    values (
      new.tenant_id,
      'whatsapp.registration_cancelled',
      jsonb_build_object(
        'registration_id', new.id,
        'phone', v_attendee.phone,
        'name', v_attendee.first_name,
        'event_name', v_event.name,
        'number', new.number
      ),
      'wa-reg-cancelled-' || new.id
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

-- 20260801092500_simplify
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
  v_consent     jsonb;
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

  -- Sem fila: lotou, recusa. Quem cancelar libera a vaga para o próximo que
  -- chegar — não há reserva nem convocação.
  if v_event.seats_taken >= floor(v_event.capacity * (1 + v_event.overbooking_pct / 100.0)) then
    raise exception 'As vagas se esgotaram.' using errcode = 'IG002';
  end if;

  v_tenant := v_event.tenant_id;

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
        updated_at = now()
  returning id into v_attendee_id;

  insert into public.registrations (
    tenant_id, event_id, attendee_id, status, source, referral,
    custom_fields, confirmed_at, ip, user_agent, idempotency_key
  )
  values (
    v_tenant, p_event_id, v_attendee_id,
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
    raise exception 'As vagas se esgotaram.' using errcode = 'IG002';
end;
$$;

grant execute on function public.create_registration(uuid, jsonb, jsonb, jsonb) to anon, authenticated;

-- 20260801093600_segunda_via (+ 093800)
create or replace function public.request_ticket_code(
  p_cpf     text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  c_ttl           constant interval := interval '15 minutes';
  c_max_por_cpf   constant int := 3;
  c_max_por_ip    constant int := 10;

  v_tenant   uuid;
  v_digits   text;
  v_cpf_hash text;
  v_ip       inet;
  v_attendee public.attendees%rowtype;
  v_whatsapp boolean;
  v_phone    text;
  v_bytes    bytea;
  v_code     text;
  v_id       uuid;
  v_count    int;
begin
  v_digits := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');

  if length(v_digits) <> 11 then
    raise exception 'CPF inválido.' using errcode = 'IG003';
  end if;

  v_tenant   := private.company_id();
  v_cpf_hash := encode(extensions.digest(v_digits, 'sha256'), 'hex');

  begin
    v_ip := nullif(p_context->>'ip', '')::inet;
  exception when others then
    v_ip := null;
  end;

  if v_ip is not null then
    select count(*) into v_count
      from public.ticket_access_codes
     where request_ip = v_ip
       and created_at > now() - interval '1 hour';

    if v_count >= c_max_por_ip then
      raise exception 'Muitos pedidos deste dispositivo.' using errcode = 'IG007';
    end if;
  end if;

  select count(*) into v_count
    from public.ticket_access_codes
   where cpf_hash = v_cpf_hash
     and created_at > now() - c_ttl;

  if v_count >= c_max_por_cpf then
    raise exception 'Muitos pedidos para este CPF.' using errcode = 'IG007';
  end if;

  -- Limpeza oportunista: a tabela só serve para contar pedidos recentes.
  delete from public.ticket_access_codes where created_at < now() - interval '30 days';

  select a.* into v_attendee
    from public.attendees a
   where a.tenant_id = v_tenant
     and a.cpf = v_digits;

  -- Sem inscrição confirmada em evento que ainda vai acontecer não há segunda
  -- via a emitir. Grava o pedido mesmo assim: é o que faz o limite por IP valer
  -- também para quem está testando CPFs.
  if v_attendee.id is null or not exists (
    select 1
      from public.registrations r
      join public.events e on e.id = r.event_id
     where r.attendee_id = v_attendee.id
       and r.status = 'confirmada'
       and e.starts_at > now()
  ) then
    insert into public.ticket_access_codes (tenant_id, cpf_hash, request_ip)
    values (v_tenant, v_cpf_hash, v_ip);

    return jsonb_build_object('found', false, 'email_mask', null, 'phone_mask', null);
  end if;

  -- Pedido novo invalida o anterior: dois códigos vivos ao mesmo tempo dobram a
  -- chance de acerto no chute e confundem quem recebeu as duas mensagens.
  update public.ticket_access_codes
     set consumed_at = now()
   where attendee_id = v_attendee.id
     and consumed_at is null;

  v_bytes := extensions.gen_random_bytes(4);
  v_code := lpad(((
      get_byte(v_bytes, 0)::bigint * 16777216 +
      get_byte(v_bytes, 1)::bigint * 65536 +
      get_byte(v_bytes, 2)::bigint * 256 +
      get_byte(v_bytes, 3)::bigint
    ) % 1000000)::text, 6, '0');

  insert into public.ticket_access_codes
    (tenant_id, cpf_hash, attendee_id, code_hash, expires_at, request_ip)
  values
    (v_tenant, v_cpf_hash, v_attendee.id,
     encode(extensions.digest(v_attendee.id::text || ':' || v_code, 'sha256'), 'hex'),
     now() + c_ttl, v_ip)
  returning id into v_id;

  select exists (
    select 1 from public.whatsapp_connections where tenant_id = v_tenant
  ) into v_whatsapp;

  v_phone := nullif(coalesce(v_attendee.phone, ''), '');

  insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
  values (
    v_tenant,
    'email.ticket_code',
    jsonb_build_object('to', v_attendee.email, 'name', v_attendee.first_name, 'code', v_code),
    'ticket-code-' || v_id
  );

  if v_whatsapp and v_phone is not null then
    -- `run_at` no futuro escapa de propósito do alocador de ritmo
    -- (private.schedule_whatsapp_job, que só reescreve `run_at <= now()`).
    -- Ritmo existe para não parecer disparo em massa; isto é resposta 1:1 a um
    -- toque de botão, e um código que chega em dez minutos é um código morto.
    -- O volume continua preso aos limites por CPF e por IP acima.
    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key, run_at)
    values (
      v_tenant,
      'whatsapp.ticket_code',
      jsonb_build_object('phone', v_phone, 'name', v_attendee.first_name, 'code', v_code),
      'wa-ticket-code-' || v_id,
      now() + interval '1 second'
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'email_mask', private.mask_email(v_attendee.email::text),
    'phone_mask', case when v_whatsapp and v_phone is not null
                       then private.mask_phone(v_phone) end
  );
end;
$$;

revoke execute on function public.request_ticket_code(text, jsonb) from public, anon, authenticated;
grant execute on function public.request_ticket_code(text, jsonb) to service_role;

-- 20260801093400_log_envios_e_ritmo
create or replace function private.schedule_whatsapp_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.type like 'whatsapp.%' and new.tenant_id is not null and new.run_at <= now() then
    new.run_at := private.next_whatsapp_slot(new.tenant_id);
  end if;
  return new;
end;
$$;

-- A view volta sem o terceiro ramo; trocar o conjunto de ramos exige recriar.
drop view if exists public.v_message_log;
create view public.v_message_log with (security_invoker = true) as
select
  m.id,
  m.job_id,
  m.tenant_id,
  'email'::text                             as channel,
  m.to_email::text                          as recipient,
  m.template,
  m.status,
  m.attempts,
  m.last_error,
  m.sent_at,
  m.created_at,
  j.run_at                                  as scheduled_at,
  j.status::text                            as job_status,
  e.id                                      as event_id,
  e.name                                    as event_name
from public.email_messages m
left join public.outbox_jobs j on j.id = m.job_id
left join public.registrations r on r.id = nullif(m.payload ->> 'registration_id', '')::uuid
left join public.events e on e.id = r.event_id

union all

select
  m.id,
  m.job_id,
  m.tenant_id,
  'whatsapp'::text,
  m.to_phone,
  m.template,
  m.status,
  m.attempts,
  m.last_error,
  m.sent_at,
  m.created_at,
  j.run_at,
  j.status::text,
  e.id,
  e.name
from public.whatsapp_messages m
left join public.outbox_jobs j on j.id = m.job_id
left join public.registrations r on r.id = nullif(m.payload ->> 'registration_id', '')::uuid
left join public.events e on e.id = r.event_id;

grant select on public.v_message_log to authenticated;


drop function if exists public.whatsapp_queue_stats(uuid, timestamptz, timestamptz);
drop function if exists public.whatsapp_update_capacity(int, int, int);
drop function if exists public.whatsapp_optout_set(text, boolean);
drop function if exists public.whatsapp_retry(uuid, timestamptz, timestamptz, boolean);
drop function if exists public.whatsapp_cancel_pending(uuid, timestamptz, timestamptz);
drop function if exists public.whatsapp_set_paused(boolean, text);
drop function if exists private.whatsapp_permanent_recipient_codes();
drop function if exists private.whatsapp_require(text);
drop function if exists private.enqueue_whatsapp_notification(uuid, uuid, uuid, public.whatsapp_notification_kind, text, text, boolean, jsonb);
drop function if exists private.whatsapp_provider(uuid);

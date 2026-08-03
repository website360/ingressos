-- =============================================================================
-- 20260801092500_simplify
--
-- Duas funcionalidades saem do produto:
--
--   · TIPOS DE INGRESSO — o evento é gratuito e tem uma entrada só.
--   · LISTA DE ESPERA — sem convocação nem aviso. Cancelou, a vaga volta para
--     o público; quem chegar primeiro se inscreve. Menos promessa ao
--     participante e nenhuma fila para operar.
--
-- O que isso apaga de complexidade: uma fila com estados, prazo de reserva,
-- job de expiração, e-mail de convocação e um contador extra em `events`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Gatilhos e funções que dependem do que será removido
-- -----------------------------------------------------------------------------
drop trigger if exists tg_waitlist_email on public.waitlist;
drop trigger if exists tg_waitlist_updated_at on public.waitlist;
drop function if exists private.enqueue_waitlist_email();
drop function if exists public.promote_waitlist(uuid, int);

-- A view precisa cair ANTES das colunas: o Postgres registra a dependência e
-- recusa remover uma coluna que uma view projeta. Ela é recriada na seção 6.
drop view if exists public.v_event_stats;

-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------
drop table if exists public.waitlist;

alter table public.registrations drop column if exists ticket_type_id;
drop table if exists public.ticket_types;

-- -----------------------------------------------------------------------------
-- 3. Colunas de evento que só existiam para a fila
-- -----------------------------------------------------------------------------
alter table public.events drop constraint if exists chk_counts;

alter table public.events
  drop column if exists seats_waitlist,
  drop column if exists waitlist_enabled,
  drop column if exists waitlist_hold_hours;

alter table public.events add constraint chk_counts check (
  seats_taken >= 0 and checked_in_count >= 0
  and cancelled_count >= 0
  and checked_in_count <= seats_taken
);

drop type if exists public.waitlist_status;

-- -----------------------------------------------------------------------------
-- 4. Contadores sem a fila
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
         cancelled_count = cancelled_count
           + (case when v_new = 'cancelada' then 1 else 0 end)
           - (case when v_old = 'cancelada' then 1 else 0 end)
   where id = v_event;

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Inscrição: lotado agora é recusa, não fila
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

-- -----------------------------------------------------------------------------
-- 6. Views e KPIs sem a fila
-- -----------------------------------------------------------------------------
drop view if exists public.v_event_stats;

create view public.v_event_stats with (security_invoker = true) as
select
  e.id                as event_id,
  e.tenant_id,
  e.name,
  e.slug,
  e.status,
  e.starts_at,
  e.ends_at,
  e.city,
  e.state,
  e.cover_url,
  e.banner_url,
  e.capacity,
  e.seats_taken,
  e.checked_in_count,
  e.cancelled_count,
  greatest(e.capacity - e.seats_taken, 0)                         as seats_available,
  round(100.0 * e.seats_taken / nullif(e.capacity, 0), 1)         as occupancy_pct,
  round(100.0 * e.checked_in_count / nullif(e.seats_taken, 0), 1) as attendance_pct
from public.events e
where e.deleted_at is null;

create or replace function public.dashboard_kpis(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  with scope as (select private.current_tenant() as tenant_id),
  ev as (
    select * from public.events e, scope s
     where e.tenant_id = s.tenant_id and e.deleted_at is null
       and (p_from is null or e.starts_at >= p_from)
       and (p_to   is null or e.starts_at <= p_to)
  )
  select jsonb_build_object(
    'events_total',     (select count(*) from ev),
    'events_active',    (select count(*) from ev where status = 'publicado' and ends_at >= now()),
    'events_finished',  (select count(*) from ev where ends_at < now() or status = 'encerrado'),
    'registrations',    (select coalesce(sum(seats_taken), 0) from ev),
    'checkins',         (select coalesce(sum(checked_in_count), 0) from ev),
    'cancellations',    (select coalesce(sum(cancelled_count), 0) from ev),
    'attendance_pct',   (select round(100.0 * coalesce(sum(checked_in_count), 0)
                                      / nullif(coalesce(sum(seats_taken), 0), 0), 1) from ev),
    'attendees_unique', (select count(*) from public.attendees a, scope s where a.tenant_id = s.tenant_id),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'total', total) order by day)
        from (
          select to_char(r.created_at, 'YYYY-MM-DD') as day, count(*) as total
            from public.registrations r, scope s
           where r.tenant_id = s.tenant_id
             and r.created_at >= coalesce(p_from, now() - interval '30 days')
           group by 1
        ) x
    ), '[]'::jsonb),
    'by_state', coalesce((
      select jsonb_agg(jsonb_build_object('state', state, 'total', total) order by total desc)
        from (
          select a.state, count(*) as total
            from public.attendees a, scope s
           where a.tenant_id = s.tenant_id and a.state is not null
           group by a.state limit 10
        ) y
    ), '[]'::jsonb),
    'top_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'seats_taken', seats_taken,
               'capacity', capacity, 'checked_in', checked_in_count
             ) order by seats_taken desc)
        from (select * from ev order by seats_taken desc limit 5) z
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.dashboard_kpis(timestamptz, timestamptz) to authenticated;

-- Permissão de fila deixa de existir.
delete from public.role_permissions where permission_code = 'waitlist.manage';
delete from public.permissions where code = 'waitlist.manage';

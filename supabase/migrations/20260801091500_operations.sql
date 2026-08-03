-- =============================================================================
-- 20260801091500_operations
-- Notificações, suporte, fila de e-mail (outbox) e views de leitura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notificações
-- -----------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index ix_notifications_inbox
  on public.notifications (tenant_id, user_id, created_at desc)
  where read_at is null;

-- -----------------------------------------------------------------------------
-- Suporte
-- -----------------------------------------------------------------------------
create table public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  number       text not null,
  subject      text not null,
  description  text not null,
  category     text not null default 'geral',
  priority     public.support_priority not null default 'media',
  status       public.support_status not null default 'aberto',
  requester_id uuid references public.profiles (id) on delete set null,
  assignee_id  uuid references public.profiles (id) on delete set null,
  event_id     uuid references public.events (id) on delete set null,
  sla_due_at   timestamptz,
  resolved_at  timestamptz,
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint uq_support_number unique (tenant_id, number)
);

create index ix_support_listing on public.support_tickets (tenant_id, status, priority, created_at desc);

create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null,
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);

create index ix_support_messages on public.support_messages (ticket_id, created_at);

create trigger tg_support_updated_at before update on public.support_tickets
  for each row execute function private.set_updated_at();

-- SLA por prioridade, aplicado na criação.
create or replace function private.set_support_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_seq int;
begin
  if new.number is null or new.number = '' then
    select count(*) + 1 into v_seq from public.support_tickets where tenant_id = new.tenant_id;
    new.number := 'SUP-' || lpad(v_seq::text, 5, '0');
  end if;

  if new.sla_due_at is null then
    new.sla_due_at := now() + case new.priority
      when 'critica' then interval '4 hours'
      when 'alta'    then interval '1 day'
      when 'media'   then interval '3 days'
      else                interval '7 days'
    end;
  end if;

  return new;
end;
$$;

create trigger tg_support_defaults before insert on public.support_tickets
  for each row execute function private.set_support_defaults();

-- -----------------------------------------------------------------------------
-- Outbox e e-mails (ADR-003)
-- -----------------------------------------------------------------------------
create table public.outbox_jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants (id) on delete cascade,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  status       public.job_status not null default 'pendente',
  run_at       timestamptz not null default now(),
  attempts     int not null default 0,
  max_attempts int not null default 5,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text unique,
  created_at   timestamptz not null default now()
);

create index ix_outbox_pending on public.outbox_jobs (status, run_at) where status = 'pendente';

create table public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  template            text not null,
  to_email            citext not null,
  subject             text not null,
  payload             jsonb not null default '{}'::jsonb,
  status              public.email_status not null default 'fila',
  provider_message_id text,
  attempts            int not null default 0,
  last_error          text,
  sent_at             timestamptz,
  opened_at           timestamptz,
  entity_type         text,
  entity_id           uuid,
  created_at          timestamptz not null default now()
);

create index ix_emails_listing on public.email_messages (tenant_id, status, created_at desc);

-- =============================================================================
-- Views de leitura
-- security_invoker: a view herda a RLS das tabelas base, em vez de contorná-la.
-- =============================================================================

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
  e.capacity,
  e.seats_taken,
  e.seats_waitlist,
  e.checked_in_count,
  e.cancelled_count,
  greatest(e.capacity - e.seats_taken, 0)                       as seats_available,
  round(100.0 * e.seats_taken / nullif(e.capacity, 0), 1)       as occupancy_pct,
  round(100.0 * e.checked_in_count / nullif(e.seats_taken, 0), 1) as attendance_pct
from public.events e
where e.deleted_at is null;

create view public.v_registration_full with (security_invoker = true) as
select
  r.id              as registration_id,
  r.tenant_id,
  r.event_id,
  r.number,
  r.status,
  r.source,
  r.referral,
  r.created_at,
  r.cancelled_at,
  a.id              as attendee_id,
  a.first_name,
  a.last_name,
  a.first_name || ' ' || a.last_name as full_name,
  a.cpf,
  a.email,
  a.phone,
  a.city,
  a.state,
  a.company,
  a.job_title,
  a.birth_date,
  e.name            as event_name,
  e.starts_at       as event_starts_at,
  t.code            as ticket_code,
  t.status          as ticket_status,
  c.checked_in_at,
  (c.id is not null) as checked_in
from public.registrations r
join public.attendees a on a.id = r.attendee_id
join public.events e    on e.id = r.event_id
left join public.tickets t  on t.registration_id = r.id
left join public.checkins c on c.ticket_id = t.id and c.result = 'sucesso';

create view public.v_checkin_alerts with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.event_id,
  e.name as event_name,
  c.result,
  c.checked_in_at,
  c.within_geofence,
  c.distance_m,
  c.override_confirmed,
  c.device_id,
  p.full_name as operator_name,
  a.first_name || ' ' || a.last_name as attendee_name
from public.checkins c
join public.events e            on e.id = c.event_id
left join public.registrations r on r.id = c.registration_id
left join public.attendees a     on a.id = r.attendee_id
left join public.profiles p      on p.id = c.operator_id
where c.result <> 'sucesso' or c.within_geofence is false or c.override_confirmed;

-- KPIs do dashboard numa chamada só.
create or replace function public.dashboard_kpis(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  with scope as (
    select private.current_tenant() as tenant_id
  ),
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
    'waitlist',         (select coalesce(sum(seats_waitlist), 0) from ev),
    'attendance_pct',   (select round(100.0 * coalesce(sum(checked_in_count), 0)
                                      / nullif(coalesce(sum(seats_taken), 0), 0), 1) from ev),
    'attendees_unique', (select count(*) from public.attendees a, scope s where a.tenant_id = s.tenant_id),
    -- Agrupa primeiro, monta o JSON depois: `group by` sobre uma expressão que
    -- contém agregado é inválido.
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

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'notifications','support_tickets','support_messages','outbox_jobs','email_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end;
$$;

-- Notificação é pessoal: cada um vê a sua.
create policy notifications_select on public.notifications
  for select to authenticated
  using (tenant_id = (select private.current_tenant()) and user_id = (select auth.uid()));

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy support_select on public.support_tickets
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('support.read')));

create policy support_write on public.support_tickets
  for all to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('support.write')))
  with check (tenant_id = (select private.current_tenant()));

create policy support_messages_select on public.support_messages
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('support.read')));

create policy support_messages_write on public.support_messages
  for insert to authenticated
  with check (tenant_id = (select private.current_tenant())
              and (select private.has_perm('support.write')));

-- Fila e log de e-mail: leitura para quem administra configurações.
create policy outbox_select on public.outbox_jobs
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('settings.read')));

create policy emails_select on public.email_messages
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('settings.read')));

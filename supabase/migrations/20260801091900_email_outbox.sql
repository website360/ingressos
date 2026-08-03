-- =============================================================================
-- 20260801091900_email_outbox
-- Enfileiramento automático de e-mails transacionais (ADR-003).
--
-- A transação de negócio NUNCA chama o provedor de e-mail: ela apenas insere
-- na fila. Se o Resend estiver fora do ar, a inscrição continua sendo criada e
-- o e-mail sai depois — em vez de a pessoa ver erro por causa de um serviço
-- externo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enfileira e-mail + notificação quando uma inscrição é confirmada
-- -----------------------------------------------------------------------------
create or replace function private.enqueue_registration_emails()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
  v_ticket   public.tickets%rowtype;
begin
  select * into v_event    from public.events    where id = new.event_id;
  select * into v_attendee from public.attendees where id = new.attendee_id;
  select * into v_ticket   from public.tickets   where registration_id = new.id limit 1;

  if tg_op = 'INSERT' and new.status = 'confirmada' then
    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
    values (
      new.tenant_id,
      'email.registration_confirmed',
      jsonb_build_object(
        'registration_id', new.id,
        'to', v_attendee.email,
        'name', v_attendee.first_name,
        'event_name', v_event.name,
        'event_starts_at', v_event.starts_at,
        'venue', coalesce(v_event.venue_name, ''),
        'city', coalesce(v_event.city, ''),
        'number', new.number,
        'ticket_code', v_ticket.code,
        'token', v_ticket.code || '.' || v_ticket.signature
      ),
      'reg-confirmed-' || new.id
    )
    on conflict (dedupe_key) do nothing;

    -- Notifica quem administra a empresa sobre o novo inscrito.
    insert into public.notifications (tenant_id, user_id, type, title, body, link, entity_type, entity_id)
    select new.tenant_id, m.user_id, 'registration.created',
           'Nova inscrição em ' || v_event.name,
           v_attendee.first_name || ' ' || v_attendee.last_name || ' — ' || new.number,
           '/eventos/' || v_event.id, 'registration', new.id
      from public.memberships m
     where m.tenant_id = new.tenant_id and m.status = 'ativo' and m.role in ('admin', 'organizador');
  end if;

  if tg_op = 'UPDATE' and new.status = 'cancelada' and old.status <> 'cancelada' then
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
  end if;

  return new;
end;
$$;

create trigger tg_registration_emails
  after insert or update of status on public.registrations
  for each row execute function private.enqueue_registration_emails();

-- -----------------------------------------------------------------------------
-- Evento lotado: avisa a organização uma única vez
-- -----------------------------------------------------------------------------
create or replace function private.notify_event_full()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_limit int := floor(new.capacity * (1 + new.overbooking_pct / 100.0));
begin
  if new.seats_taken >= v_limit and coalesce(old.seats_taken, 0) < v_limit then
    insert into public.notifications (tenant_id, user_id, type, title, body, link, entity_type, entity_id)
    select new.tenant_id, m.user_id, 'event.full',
           'Evento lotado: ' || new.name,
           'Todas as ' || new.capacity || ' vagas foram preenchidas.',
           '/eventos/' || new.id, 'event', new.id
      from public.memberships m
     where m.tenant_id = new.tenant_id and m.status = 'ativo' and m.role in ('admin', 'organizador');
  end if;

  return new;
end;
$$;

create trigger tg_event_full
  after update of seats_taken on public.events
  for each row execute function private.notify_event_full();

-- -----------------------------------------------------------------------------
-- Convocação da lista de espera
-- -----------------------------------------------------------------------------
create or replace function private.enqueue_waitlist_email()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  if new.status = 'convocado' and coalesce(old.status::text, '') <> 'convocado' then
    select * into v_event    from public.events    where id = new.event_id;
    select * into v_attendee from public.attendees where id = new.attendee_id;

    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
    values (
      new.tenant_id,
      'email.waitlist_invited',
      jsonb_build_object(
        'to', v_attendee.email,
        'name', v_attendee.first_name,
        'event_name', v_event.name,
        'event_slug', v_event.slug,
        'expires_at', new.expires_at
      ),
      'waitlist-invited-' || new.id || '-' || new.notified_count
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger tg_waitlist_email
  after update of status on public.waitlist
  for each row execute function private.enqueue_waitlist_email();

-- -----------------------------------------------------------------------------
-- claim_outbox_jobs — o worker pega um lote com trava
--
-- FOR UPDATE SKIP LOCKED permite vários workers em paralelo sem que dois peguem
-- o mesmo job, e sem que um worker travado bloqueie a fila inteira.
-- -----------------------------------------------------------------------------
create or replace function private.claim_outbox_jobs(p_limit int default 20, p_worker text default 'worker')
returns setof public.outbox_jobs
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return query
  with claimed as (
    select id
      from public.outbox_jobs
     where status = 'pendente'
       and run_at <= now()
       and attempts < max_attempts
     order by run_at
     limit p_limit
     for update skip locked
  )
  update public.outbox_jobs j
     set status = 'processando', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
    from claimed
   where j.id = claimed.id
  returning j.*;
end;
$$;

-- Backoff exponencial: 1min, 2min, 4min, 8min... até desistir.
create or replace function private.complete_outbox_job(
  p_id uuid,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.outbox_jobs%rowtype;
begin
  select * into v_job from public.outbox_jobs where id = p_id;
  if v_job.id is null then return; end if;

  if p_success then
    update public.outbox_jobs
       set status = 'concluido', locked_at = null, last_error = null
     where id = p_id;
  elsif v_job.attempts >= v_job.max_attempts then
    update public.outbox_jobs
       set status = 'falhou', locked_at = null, last_error = p_error
     where id = p_id;
  else
    update public.outbox_jobs
       set status = 'pendente',
           locked_at = null,
           last_error = p_error,
           run_at = now() + make_interval(secs => 60 * power(2, v_job.attempts)::int)
     where id = p_id;
  end if;
end;
$$;

grant execute on function private.claim_outbox_jobs(int, text) to service_role;
grant execute on function private.complete_outbox_job(uuid, boolean, text) to service_role;

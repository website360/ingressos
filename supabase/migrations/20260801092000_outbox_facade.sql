-- =============================================================================
-- 20260801092000_outbox_facade
--
-- As funções do worker viviam em `private`, que não é exposto pelo PostgREST —
-- o worker não conseguiria chamá-las (ADR-014, terceira ocorrência do mesmo
-- padrão). Vão para `public`, mas com EXECUTE concedido SOMENTE ao
-- `service_role`: ficam visíveis na API e inacessíveis para anon e
-- authenticated. Estar em `public` não é o mesmo que estar público.
-- =============================================================================

create or replace function public.claim_outbox_jobs(
  p_limit  int default 20,
  p_worker text default 'worker'
)
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

create or replace function public.complete_outbox_job(
  p_id      uuid,
  p_success boolean,
  p_error   text default null
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
    -- Backoff exponencial: 1min, 2min, 4min, 8min, 16min.
    update public.outbox_jobs
       set status = 'pendente',
           locked_at = null,
           last_error = p_error,
           run_at = now() + make_interval(secs => 60 * power(2, v_job.attempts)::int)
     where id = p_id;
  end if;
end;
$$;

-- Jobs presos em 'processando' (worker morreu no meio) voltam para a fila.
create or replace function public.requeue_stale_outbox_jobs(p_older_than interval default '10 minutes')
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count int;
begin
  update public.outbox_jobs
     set status = 'pendente', locked_at = null, locked_by = null
   where status = 'processando'
     and locked_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Superfície fechada: apenas o worker (service role) executa.
revoke execute on function public.claim_outbox_jobs(int, text)             from public, anon, authenticated;
revoke execute on function public.complete_outbox_job(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.requeue_stale_outbox_jobs(interval)      from public, anon, authenticated;

grant execute on function public.claim_outbox_jobs(int, text)             to service_role;
grant execute on function public.complete_outbox_job(uuid, boolean, text) to service_role;
grant execute on function public.requeue_stale_outbox_jobs(interval)      to service_role;

drop function if exists private.claim_outbox_jobs(int, text);
drop function if exists private.complete_outbox_job(uuid, boolean, text);

comment on function public.claim_outbox_jobs(int, text) is
  'Worker da fila. EXECUTE apenas para service_role — não é chamável pelo cliente.';

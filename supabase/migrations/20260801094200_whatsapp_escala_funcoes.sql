-- =============================================================================
-- 20260801094200_whatsapp_escala_funcoes
-- WhatsApp em escala — funções do worker.
--
-- Reversão: supabase/rollbacks/20260801094200_whatsapp_escala_funcoes.down.sql
--
-- Todas com EXECUTE só para `service_role` (e o dono, que é quem o worker usa
-- pela conexão direta): ficam fora do alcance de anon e authenticated.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Telefone brasileiro em E.164
--
-- Gêmea de `toE164Br` (shared/whatsapp/phone-e164.ts). O `55` inicial é
-- ambíguo — DDI do Brasil e DDD de Santa Maria/RS — e só é tratado como DDI
-- quando sobra um telefone válido sem ele.
-- -----------------------------------------------------------------------------
create or replace function private.to_e164_br(p_input text)
returns text
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_digits text := regexp_replace(coalesce(p_input, ''), '\D', '', 'g');
  v_ddd    int;
begin
  if v_digits like '55%' and length(v_digits) > 11 then
    v_digits := substr(v_digits, 3);
  end if;

  if length(v_digits) not in (10, 11) then
    return null;
  end if;

  v_ddd := substr(v_digits, 1, 2)::int;
  if v_ddd < 11 or v_ddd > 99 then
    return null;
  end if;

  if length(v_digits) = 11 and substr(v_digits, 3, 1) <> '9' then
    return null;
  end if;

  return '+55' || v_digits;
end;
$$;

-- -----------------------------------------------------------------------------
-- Token bucket global
--
-- Capacidade = 1 segundo de vazão: o worker não acumula "crédito" parado e
-- depois dispara uma rajada. A linha é travada (FOR UPDATE) durante o
-- cálculo; como cada worker pede um LOTE de fichas por vez, a disputa é de
-- uma escrita por lote, não por mensagem.
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_take_tokens(p_tenant uuid, p_want int)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rate     double precision;
  v_bucket   public.whatsapp_rate_buckets%rowtype;
  v_now      timestamptz := clock_timestamp();
  v_factor   double precision;
  v_capacity double precision;
  v_tokens   double precision;
  v_granted  int;
begin
  if coalesce(p_want, 0) <= 0 then
    return 0;
  end if;

  select rate_per_second into v_rate
    from public.whatsapp_connections where tenant_id = p_tenant;
  if v_rate is null then
    return 0;
  end if;

  insert into public.whatsapp_rate_buckets (tenant_id, tokens, refilled_at)
  values (p_tenant, v_rate, v_now)
  on conflict (tenant_id) do nothing;

  select * into v_bucket from public.whatsapp_rate_buckets where tenant_id = p_tenant for update;

  v_factor := case when v_bucket.throttle_until > v_now then v_bucket.throttle_factor else 1 end;
  v_capacity := greatest(v_rate * v_factor, 1);
  v_tokens := least(
    v_capacity,
    v_bucket.tokens + greatest(extract(epoch from v_now - v_bucket.refilled_at), 0) * v_rate * v_factor
  );

  v_granted := least(p_want, floor(v_tokens)::int);

  update public.whatsapp_rate_buckets
     set tokens = v_tokens - v_granted, refilled_at = v_now
   where tenant_id = p_tenant;

  return v_granted;
end;
$$;

-- Freio pedido pela Meta (429): vazão × fator por N segundos. As fichas que
-- sobravam caem junto, para o freio valer já.
create or replace function public.whatsapp_throttle(p_tenant uuid, p_factor double precision, p_seconds int)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.whatsapp_rate_buckets (tenant_id, tokens, refilled_at)
  values (p_tenant, 0, clock_timestamp())
  on conflict (tenant_id) do nothing;

  update public.whatsapp_rate_buckets
     set throttle_factor = least(greatest(p_factor, 0.01), 1),
         throttle_until  = clock_timestamp() + make_interval(secs => p_seconds),
         tokens          = 0,
         refilled_at     = clock_timestamp()
   where tenant_id = p_tenant;
end;
$$;

-- -----------------------------------------------------------------------------
-- Claim: pendentes vencidas, sem duplicar entre workers
--
-- Empresa pausada ou com breaker aberto não entrega nada — a checagem fica
-- aqui, no mesmo lugar do claim, para nenhum worker "esquecer" de olhar.
-- -----------------------------------------------------------------------------
create or replace function public.claim_whatsapp_notifications(
  p_tenant uuid,
  p_limit  int,
  p_worker text
)
returns setof public.whatsapp_notifications
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (
    select 1 from public.whatsapp_connections c
     where c.tenant_id = p_tenant
       and not c.paused
       and (c.breaker_open_until is null or c.breaker_open_until <= now())
  ) then
    return;
  end if;

  return query
  with picked as (
    select n.id
      from public.whatsapp_notifications n
     where n.status = 'pendente'
       and n.tenant_id = p_tenant
       and n.next_attempt_at <= now()
     order by n.next_attempt_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.whatsapp_notifications n
     set status = 'processando',
         locked_at = clock_timestamp(),
         locked_by = p_worker,
         request_started_at = null
    from picked
   where n.id = picked.id
  returning n.*;
end;
$$;

-- A partir daqui, a requisição pode ter chegado à Meta: perder o worker
-- agora deixa a notificação "incerta", não "pendente".
create or replace function public.mark_whatsapp_request_started(p_ids uuid[])
returns void
language sql
security definer
set search_path = public, private
as $$
  update public.whatsapp_notifications
     set request_started_at = clock_timestamp()
   where id = any (p_ids) and status = 'processando';
$$;

-- -----------------------------------------------------------------------------
-- Resultado de uma tentativa
--
-- p_outcome:
--   aceita    → a Meta devolveu wamid
--   retry     → tenta de novo em p_retry_at (p_count_attempt decide se gasta)
--   falhou    → definitivo
--   incerta   → pode ter saído; não reenvia sozinha
--   devolver  → volta para a fila sem gastar tentativa (pausa, breaker, sobra)
--   cancelada → não faz mais sentido enviar (ingresso cancelado)
--   bloqueada → opt-out ou telefone inválido descoberto na hora (p_error = motivo)
--
-- Se o webhook já avançou a notificação (casou pelo biz_opaque_callback_data
-- antes de o worker gravar), a situação NÃO é rebaixada; só o wamid entra.
-- -----------------------------------------------------------------------------
create or replace function public.record_whatsapp_result(
  p_id            uuid,
  p_outcome       text,
  p_wamid         text default null,
  p_error_code    int default null,
  p_error         text default null,
  p_retry_at      timestamptz default null,
  p_count_attempt boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row      public.whatsapp_notifications%rowtype;
  v_attempts int;
begin
  select * into v_row from public.whatsapp_notifications where id = p_id for update;
  if v_row.id is null then
    return;
  end if;

  if v_row.status <> 'processando' then
    if p_outcome = 'aceita' and p_wamid is not null then
      -- A reconciliação pode ter marcado "incerta" enquanto a resposta estava a
      -- caminho: com o wamid em mãos, deixa de ser incerta (senão um "reenviar
      -- incertas" mandaria de novo o que a Meta aceitou).
      update public.whatsapp_notifications
         set status          = case when status = 'incerta' then 'aceita' else status end,
             last_error      = case when status = 'incerta' then null else last_error end,
             meta_message_id = coalesce(meta_message_id, p_wamid),
             accepted_at     = coalesce(accepted_at, clock_timestamp()),
             attempts        = greatest(attempts, v_row.attempts + 1),
             locked_at = null, locked_by = null
       where id = p_id;
    end if;
    return;
  end if;

  v_attempts := v_row.attempts + case when p_count_attempt then 1 else 0 end;

  case p_outcome
    when 'aceita' then
      update public.whatsapp_notifications
         set status = 'aceita', meta_message_id = p_wamid, accepted_at = clock_timestamp(),
             attempts = v_attempts, last_error = null, last_error_code = null,
             locked_at = null, locked_by = null
       where id = p_id;

    when 'retry' then
      if v_attempts >= v_row.max_attempts then
        update public.whatsapp_notifications
           set status = 'falhou', failed_at = clock_timestamp(), attempts = v_attempts,
               last_error = p_error, last_error_code = p_error_code,
               locked_at = null, locked_by = null, request_started_at = null
         where id = p_id;
      else
        update public.whatsapp_notifications
           set status = 'pendente', attempts = v_attempts,
               next_attempt_at = coalesce(p_retry_at, now()),
               last_error = p_error, last_error_code = p_error_code,
               locked_at = null, locked_by = null, request_started_at = null
         where id = p_id;
      end if;

    when 'falhou' then
      update public.whatsapp_notifications
         set status = 'falhou', failed_at = clock_timestamp(), attempts = v_attempts,
             last_error = p_error, last_error_code = p_error_code,
             locked_at = null, locked_by = null
       where id = p_id;

    when 'incerta' then
      update public.whatsapp_notifications
         set status = 'incerta', attempts = v_attempts,
             last_error = p_error, last_error_code = p_error_code,
             locked_at = null, locked_by = null
       where id = p_id;

    when 'devolver' then
      update public.whatsapp_notifications
         set status = 'pendente', next_attempt_at = coalesce(p_retry_at, now()),
             locked_at = null, locked_by = null, request_started_at = null
       where id = p_id;

    when 'cancelada' then
      update public.whatsapp_notifications
         set status = 'cancelada', cancelled_at = clock_timestamp(), last_error = p_error,
             locked_at = null, locked_by = null
       where id = p_id;

    when 'bloqueada' then
      update public.whatsapp_notifications
         set status = 'bloqueada', block_reason = p_error,
             locked_at = null, locked_by = null
       where id = p_id;

    else
      raise exception 'Resultado desconhecido: %', p_outcome;
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reconciliação de travas abandonadas
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_whatsapp(p_stale interval default '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_requeued  int;
  v_uncertain int;
begin
  -- Pegou e morreu ANTES de enviar: seguro voltar para a fila.
  update public.whatsapp_notifications
     set status = 'pendente', locked_at = null, locked_by = null
   where status = 'processando'
     and request_started_at is null
     and locked_at < now() - p_stale;
  get diagnostics v_requeued = row_count;

  -- Enviou e morreu antes da resposta: pode ter chegado. Não reenviar.
  update public.whatsapp_notifications
     set status = 'incerta', locked_at = null, locked_by = null, attempts = attempts + 1,
         last_error = 'Worker interrompido durante o envio; aguardando confirmação da Meta.'
   where status = 'processando'
     and request_started_at is not null
     and request_started_at < now() - p_stale;
  get diagnostics v_uncertain = row_count;

  return jsonb_build_object('requeued', v_requeued, 'uncertain', v_uncertain);
end;
$$;

-- -----------------------------------------------------------------------------
-- Teto de destinatários únicos em 24h (limite de mensagens da conta na Meta)
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_unique_recipients_24h(p_tenant uuid)
returns int
language sql
stable
security definer
set search_path = public, private
as $$
  select count(distinct phone_e164)::int
    from public.whatsapp_notifications
   where tenant_id = p_tenant
     and accepted_at > now() - interval '24 hours';
$$;

-- -----------------------------------------------------------------------------
-- Batimento e breaker
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_heartbeat(p_worker text, p_stats jsonb)
returns void
language sql
security definer
set search_path = public, private
as $$
  insert into public.whatsapp_worker_heartbeats (worker_id, last_seen_at, stats)
  values (p_worker, now(), coalesce(p_stats, '{}'::jsonb))
  on conflict (worker_id) do update
    set last_seen_at = excluded.last_seen_at, stats = excluded.stats;
$$;

-- Manual = erro sistêmico (token, modelo, conta): pausa até alguém retomar.
-- Automático = taxa de erro alta: fecha sozinho quando a janela passa.
create or replace function public.whatsapp_open_breaker(
  p_tenant uuid,
  p_until  timestamptz,
  p_reason text,
  p_manual boolean
)
returns void
language sql
security definer
set search_path = public, private
as $$
  update public.whatsapp_connections
     set breaker_open_until = case when p_manual then null else p_until end,
         breaker_manual     = p_manual,
         paused             = paused or p_manual,
         paused_at          = case when p_manual and not paused then now() else paused_at end,
         paused_reason      = p_reason
   where tenant_id = p_tenant;
$$;

-- -----------------------------------------------------------------------------
-- Superfície fechada
-- -----------------------------------------------------------------------------
revoke execute on function public.whatsapp_take_tokens(uuid, int)                                   from public, anon, authenticated;
revoke execute on function public.whatsapp_throttle(uuid, double precision, int)                    from public, anon, authenticated;
revoke execute on function public.claim_whatsapp_notifications(uuid, int, text)                     from public, anon, authenticated;
revoke execute on function public.mark_whatsapp_request_started(uuid[])                             from public, anon, authenticated;
revoke execute on function public.record_whatsapp_result(uuid, text, text, int, text, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.reconcile_whatsapp(interval)                                      from public, anon, authenticated;
revoke execute on function public.whatsapp_unique_recipients_24h(uuid)                              from public, anon, authenticated;
revoke execute on function public.whatsapp_heartbeat(text, jsonb)                                   from public, anon, authenticated;
revoke execute on function public.whatsapp_open_breaker(uuid, timestamptz, text, boolean)           from public, anon, authenticated;
revoke execute on function private.to_e164_br(text)                                                 from public, anon, authenticated;

grant execute on function public.whatsapp_take_tokens(uuid, int)                                   to service_role;
grant execute on function public.whatsapp_throttle(uuid, double precision, int)                    to service_role;
grant execute on function public.claim_whatsapp_notifications(uuid, int, text)                     to service_role;
grant execute on function public.mark_whatsapp_request_started(uuid[])                             to service_role;
grant execute on function public.record_whatsapp_result(uuid, text, text, int, text, timestamptz, boolean) to service_role;
grant execute on function public.reconcile_whatsapp(interval)                                      to service_role;
grant execute on function public.whatsapp_unique_recipients_24h(uuid)                              to service_role;
grant execute on function public.whatsapp_heartbeat(text, jsonb)                                   to service_role;
grant execute on function public.whatsapp_open_breaker(uuid, timestamptz, text, boolean)           to service_role;
grant execute on function private.to_e164_br(text)                                                 to service_role;

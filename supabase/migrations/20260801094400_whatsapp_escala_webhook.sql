-- =============================================================================
-- 20260801094400_whatsapp_escala_webhook
-- WhatsApp em escala — processamento do webhook da Meta.
--
-- Reversão: supabase/rollbacks/20260801094400_whatsapp_escala_webhook.down.sql
--
-- A rota valida a assinatura e chama `whatsapp_ingest_webhook`, que GRAVA o
-- corpo cru e DEPOIS processa. Se o processamento falhar, o evento fica
-- guardado com o erro e o worker reprocessa (`whatsapp_reprocess_webhooks`).
--
-- Tudo aqui é idempotente: a situação só avança, e cada marco guarda a
-- PRIMEIRA hora em que foi visto — o mesmo POST duas vezes não muda nada, e
-- "lida" antes de "entregue" (comum) não rebaixa nada.
-- =============================================================================

-- Ordem de avanço. Estados fora do caminho feliz valem 0: um "sent" que chega
-- para uma notificação incerta, cancelada no meio ou marcada como falha pelo
-- worker é a prova de que ela saiu — e ganha.
create or replace function private.whatsapp_status_rank(p_status public.whatsapp_notification_status)
returns int
language sql
immutable
as $$
  select case p_status
    when 'aceita'   then 1
    when 'enviada'  then 2
    when 'entregue' then 3
    when 'lida'     then 4
    else 0
  end;
$$;

-- Empresa do evento: pelo id do número; sem ele (eventos de conta/qualidade),
-- a única empresa com Meta — o sistema é de empresa única.
create or replace function private.whatsapp_webhook_tenant(p_phone_number_id text)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select tenant_id from public.whatsapp_connections
      where provider = 'meta' and meta_phone_number_id = p_phone_number_id),
    (select min(tenant_id::text)::uuid from public.whatsapp_connections
      where provider = 'meta'
     having count(*) = 1)
  );
$$;

-- Bloqueia o número e as pendentes dele.
create or replace function private.whatsapp_block_number(
  p_tenant uuid, p_phone text, p_reason text, p_source text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_phone is null then
    return;
  end if;

  insert into public.whatsapp_optouts (tenant_id, phone_e164, reason, source)
  values (p_tenant, p_phone, p_reason, p_source)
  on conflict (tenant_id, phone_e164) do nothing;

  update public.whatsapp_notifications
     set status = 'bloqueada', block_reason = 'optout'
   where tenant_id = p_tenant and phone_e164 = p_phone and status = 'pendente';
end;
$$;

-- -----------------------------------------------------------------------------
-- Situação de uma mensagem (sent / delivered / read / failed)
--
-- Casa pelo wamid OU pelo `biz_opaque_callback_data` (o id da notificação,
-- mandado pelo worker no envio). O segundo cobre a corrida em que a Meta
-- avisa antes de o worker gravar o wamid — e é o que resolve as "incertas".
-- -----------------------------------------------------------------------------
create or replace function private.whatsapp_apply_status(p_tenant uuid, p_status jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_next  public.whatsapp_notification_status;
  v_ts    timestamptz;
  v_cb    uuid;
  v_wamid text := p_status ->> 'id';
  v_row   public.whatsapp_notifications%rowtype;
  v_code  int;
  v_error text;
begin
  v_next := case p_status ->> 'status'
              when 'sent'      then 'enviada'
              when 'delivered' then 'entregue'
              when 'read'      then 'lida'
              when 'failed'    then 'falhou'
            end;
  if v_next is null then
    return;
  end if;

  v_ts := coalesce(to_timestamp(nullif(p_status ->> 'timestamp', '')::bigint), now());

  if (p_status ->> 'biz_opaque_callback_data') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_cb := (p_status ->> 'biz_opaque_callback_data')::uuid;
  end if;

  select * into v_row
    from public.whatsapp_notifications n
   where n.tenant_id = p_tenant
     and ((v_wamid is not null and n.meta_message_id = v_wamid) or (v_cb is not null and n.id = v_cb))
   order by (n.meta_message_id = v_wamid) desc nulls last
   limit 1
     for update;

  if v_row.id is null then
    return;
  end if;

  if v_next = 'falhou' then
    v_code  := nullif(p_status -> 'errors' -> 0 ->> 'code', '')::int;
    v_error := 'Meta: ' || coalesce(
      p_status -> 'errors' -> 0 -> 'error_data' ->> 'details',
      p_status -> 'errors' -> 0 ->> 'message',
      p_status -> 'errors' -> 0 ->> 'title',
      'falha na entrega');
  end if;

  update public.whatsapp_notifications n
     set meta_message_id = coalesce(n.meta_message_id, v_wamid),
         accepted_at     = coalesce(n.accepted_at, v_ts),
         sent_at         = case when v_next = 'enviada'  then coalesce(n.sent_at, v_ts)      else n.sent_at end,
         delivered_at    = case when v_next = 'entregue' then coalesce(n.delivered_at, v_ts) else n.delivered_at end,
         read_at         = case when v_next = 'lida'     then coalesce(n.read_at, v_ts)      else n.read_at end,
         failed_at       = case when v_next = 'falhou'   then coalesce(n.failed_at, v_ts)    else n.failed_at end,
         last_error_code = case when v_next = 'falhou' then v_code  else n.last_error_code end,
         last_error      = case when v_next = 'falhou' then left(v_error, 500) else n.last_error end,
         status = case
                    when v_next = 'falhou' and n.status <> 'lida' then 'falhou'
                    when v_next <> 'falhou'
                         and private.whatsapp_status_rank(v_next) > private.whatsapp_status_rank(n.status)
                      then v_next
                    else n.status
                  end
   where n.id = v_row.id;

  if v_next = 'falhou' and v_code in (131026) then
    perform private.whatsapp_block_number(p_tenant, v_row.phone_e164, 'invalido', 'meta');
  elsif v_next = 'falhou' and v_code in (131049, 131050) then
    perform private.whatsapp_block_number(p_tenant, v_row.phone_e164, 'bloqueio', 'meta');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Mensagem recebida: só interessa o pedido de saída
-- -----------------------------------------------------------------------------
create or replace function private.whatsapp_apply_inbound(p_tenant uuid, p_message jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_text text;
begin
  v_text := coalesce(
    p_message -> 'text' ->> 'body',
    p_message -> 'button' ->> 'text',
    p_message -> 'interactive' -> 'button_reply' ->> 'title',
    '');
  v_text := btrim(regexp_replace(lower(v_text), '[^a-z ]', '', 'g'));

  if v_text in ('sair', 'parar', 'stop', 'cancelar', 'cancelar mensagens') then
    perform private.whatsapp_block_number(
      p_tenant, private.to_e164_br(p_message ->> 'from'), 'pedido', 'whatsapp');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Um evento de webhook inteiro
-- -----------------------------------------------------------------------------
create or replace function private.whatsapp_apply_webhook(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event  public.whatsapp_webhook_events%rowtype;
  v_tenant uuid;
  v_change jsonb;
  v_value  jsonb;
  v_item   jsonb;
  v_kind   text;
begin
  select * into v_event from public.whatsapp_webhook_events where id = p_event;
  v_tenant := private.whatsapp_webhook_tenant(v_event.phone_number_id);
  if v_tenant is null then
    raise exception 'Nenhuma empresa com a Meta para o número %', coalesce(v_event.phone_number_id, '(vazio)');
  end if;

  for v_change in
    select c from jsonb_array_elements(coalesce(v_event.payload -> 'entry', '[]'::jsonb)) e,
                  jsonb_array_elements(coalesce(e -> 'changes', '[]'::jsonb)) c
  loop
    v_value := coalesce(v_change -> 'value', '{}'::jsonb);
    v_kind  := v_value ->> 'event';

    case v_change ->> 'field'
      when 'messages' then
        for v_item in select * from jsonb_array_elements(coalesce(v_value -> 'statuses', '[]'::jsonb)) loop
          perform private.whatsapp_apply_status(v_tenant, v_item);
        end loop;
        for v_item in select * from jsonb_array_elements(coalesce(v_value -> 'messages', '[]'::jsonb)) loop
          perform private.whatsapp_apply_inbound(v_tenant, v_item);
        end loop;

      when 'phone_number_quality_update' then
        update public.whatsapp_connections
           set quality_rating = coalesce(v_kind, quality_rating),
               messaging_tier = coalesce(v_value ->> 'current_limit', messaging_tier)
         where tenant_id = v_tenant;
        if v_kind in ('FLAGGED', 'DOWNGRADE') then
          perform public.whatsapp_open_breaker(
            v_tenant, null,
            'A Meta sinalizou queda de qualidade do número (' || v_kind || '). Envios pausados.', true);
        end if;

      when 'account_update' then
        if v_kind in ('ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE', 'ACCOUNT_DELETED') then
          perform public.whatsapp_open_breaker(
            v_tenant, null, 'A Meta restringiu a conta (' || v_kind || '). Envios pausados.', true);
        end if;

      when 'message_template_status_update' then
        update public.whatsapp_templates
           set meta_status = case v_kind
                               when 'APPROVED' then 'aprovado'
                               when 'REJECTED' then 'rejeitado'
                               when 'DISABLED' then 'rejeitado'
                               when 'PAUSED'   then 'pausado'
                               when 'PENDING'  then 'em_analise'
                               else meta_status
                             end
         where tenant_id = v_tenant
           and name = v_value ->> 'message_template_name'
           and (v_value ->> 'message_template_language' is null
                or language = v_value ->> 'message_template_language');

      else
        null;
    end case;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Entrada (rota) e reprocessamento (worker)
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_ingest_webhook(p_phone_number_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  insert into public.whatsapp_webhook_events (phone_number_id, payload)
  values (p_phone_number_id, p_payload)
  returning id into v_id;

  begin
    perform private.whatsapp_apply_webhook(v_id);
    update public.whatsapp_webhook_events
       set processed_at = now(), attempts = attempts + 1, error = null
     where id = v_id;
  exception when others then
    update public.whatsapp_webhook_events
       set attempts = attempts + 1, error = left(sqlerrm, 500)
     where id = v_id;
    return jsonb_build_object('id', v_id, 'processed', false);
  end;

  return jsonb_build_object('id', v_id, 'processed', true);
end;
$$;

create or replace function public.whatsapp_reprocess_webhooks(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.whatsapp_webhook_events
     where processed_at is null and attempts < 5 and received_at < now() - interval '1 minute'
     order by received_at
     limit greatest(p_limit, 0)
       for update skip locked
  loop
    begin
      perform private.whatsapp_apply_webhook(v_id);
      update public.whatsapp_webhook_events
         set processed_at = now(), attempts = attempts + 1, error = null
       where id = v_id;
      v_count := v_count + 1;
    exception when others then
      update public.whatsapp_webhook_events
         set attempts = attempts + 1, error = left(sqlerrm, 500)
       where id = v_id;
    end;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.whatsapp_ingest_webhook(text, jsonb) from public, anon, authenticated;
revoke execute on function public.whatsapp_reprocess_webhooks(int)    from public, anon, authenticated;
grant execute on function public.whatsapp_ingest_webhook(text, jsonb) to service_role;
grant execute on function public.whatsapp_reprocess_webhooks(int)    to service_role;

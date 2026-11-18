-- =============================================================================
-- 20260801094300_whatsapp_escala_fila
-- WhatsApp em escala — enfileiramento, convivência e ações do painel.
--
-- Reversão: supabase/rollbacks/20260801094300_whatsapp_escala_fila.down.sql
--
-- Com o provedor Meta, toda mensagem de WhatsApp nasce em
-- `whatsapp_notifications`, na transação que a originou, e quem envia é o
-- worker dedicado. Com a Evolution, nada muda: `outbox_jobs` + cron.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Provedor da empresa ('meta' | 'evolution' | null quando não configurado)
-- -----------------------------------------------------------------------------
create or replace function private.whatsapp_provider(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select provider from public.whatsapp_connections where tenant_id = p_tenant;
$$;

-- -----------------------------------------------------------------------------
-- Uma notificação na fila — o único lugar que decide "sai ou não sai"
--
-- Telefone inválido, opt-out e falta de consentimento viram `bloqueada` com o
-- motivo, em vez de simplesmente não existir: o painel mostra quantas pessoas
-- NÃO vão receber, e por quê. O ON CONFLICT na `dedupe_key` é a idempotência:
-- o mesmo gatilho rodando duas vezes não gera segunda mensagem.
-- -----------------------------------------------------------------------------
create or replace function private.enqueue_whatsapp_notification(
  p_tenant          uuid,
  p_event           uuid,
  p_registration    uuid,
  p_kind            public.whatsapp_notification_kind,
  p_phone           text,
  p_dedupe          text,
  p_require_consent boolean,
  p_params          jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_phone    text := private.to_e164_br(p_phone);
  v_template public.whatsapp_templates%rowtype;
  v_consent  uuid;
  v_status   public.whatsapp_notification_status := 'pendente';
  v_reason   text;
  v_id       uuid;
begin
  select * into v_template
    from public.whatsapp_templates
   where tenant_id = p_tenant and key = p_kind and active;

  if p_registration is not null then
    select c.id into v_consent
      from public.consents c
     where c.registration_id = p_registration
       and c.document_type = 'whatsapp'
       and c.accepted
     order by c.accepted_at desc
     limit 1;
  end if;

  if v_phone is null then
    v_status := 'bloqueada';
    v_reason := 'telefone_invalido';
  elsif exists (
    select 1 from public.whatsapp_optouts o where o.tenant_id = p_tenant and o.phone_e164 = v_phone
  ) then
    v_status := 'bloqueada';
    v_reason := 'optout';
  elsif p_require_consent and v_consent is null then
    v_status := 'bloqueada';
    v_reason := 'sem_consentimento';
  end if;

  insert into public.whatsapp_notifications (
    tenant_id, event_id, registration_id, kind, phone_e164,
    template_id, template_name, template_version, language,
    consent_id, status, block_reason, params, dedupe_key
  )
  values (
    p_tenant, p_event, p_registration, p_kind, v_phone,
    v_template.id, v_template.name, v_template.version, v_template.language,
    v_consent, v_status, v_reason, coalesce(p_params, '{}'::jsonb), p_dedupe
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function private.enqueue_whatsapp_notification(
  uuid, uuid, uuid, public.whatsapp_notification_kind, text, text, boolean, jsonb
) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Confirmação (gatilho em `tickets`)
-- -----------------------------------------------------------------------------
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
  v_provider text;
begin
  select * into v_reg from public.registrations where id = new.registration_id;

  if v_reg.id is null or v_reg.status <> 'confirmada' then
    return new;
  end if;

  select * into v_event    from public.events    where id = v_reg.event_id;
  select * into v_attendee from public.attendees where id = v_reg.attendee_id;

  v_token := new.code || '.' || new.signature;
  v_provider := private.whatsapp_provider(v_reg.tenant_id);

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

  if v_provider = 'meta' then
    -- Só ids: nome, evento e token são lidos na hora do envio.
    perform private.enqueue_whatsapp_notification(
      v_reg.tenant_id, v_reg.event_id, v_reg.id, 'registration_confirmed',
      v_attendee.phone, 'wa-confirmed-' || v_reg.id, true, '{}'::jsonb
    );
  elsif v_provider is not null and coalesce(v_attendee.phone, '') <> '' then
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

-- -----------------------------------------------------------------------------
-- Cancelamento (gatilho em `registrations`)
-- -----------------------------------------------------------------------------
create or replace function private.enqueue_cancellation_messages()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
  v_provider text;
begin
  if new.status <> 'cancelada' or old.status = 'cancelada' then
    return new;
  end if;

  select * into v_event    from public.events    where id = new.event_id;
  select * into v_attendee from public.attendees where id = new.attendee_id;
  v_provider := private.whatsapp_provider(new.tenant_id);

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

  if v_provider = 'meta' then
    -- A confirmação que ainda não saiu não sai mais: o ingresso não vale.
    update public.whatsapp_notifications
       set status = 'cancelada', cancelled_at = now(), last_error = 'Inscrição cancelada antes do envio.'
     where registration_id = new.id
       and kind = 'registration_confirmed'
       and status = 'pendente';

    perform private.enqueue_whatsapp_notification(
      new.tenant_id, new.event_id, new.id, 'registration_cancelled',
      v_attendee.phone, 'wa-cancelled-' || new.id, true, '{}'::jsonb
    );
  elsif v_provider is not null and coalesce(v_attendee.phone, '') <> '' then
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

-- -----------------------------------------------------------------------------
-- Inscrição: consentimentos ANTES do ingresso
--
-- A confirmação nasce do gatilho em `tickets`. Com os consentimentos gravados
-- depois do ingresso (a ordem antiga), o gatilho ainda não enxergaria o aceite
-- do WhatsApp e bloquearia toda mensagem. Fora a ordem, só entra o `subject`
-- (o telefone a que o aceite se refere).
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

  for v_consent in select * from jsonb_array_elements(coalesce(p_consents, '[]'::jsonb))
  loop
    insert into public.consents (
      tenant_id, registration_id, document_type, document_version, accepted, ip, user_agent, subject
    )
    values (
      v_tenant, v_reg_id,
      v_consent ->> 'type',
      coalesce((v_consent ->> 'version')::int, 1),
      coalesce((v_consent ->> 'accepted')::boolean, true),
      nullif(p_context ->> 'ip', '')::inet,
      p_context ->> 'user_agent',
      nullif(v_consent ->> 'subject', '')
    );
  end loop;

  v_code := upper(substr(encode(gen_random_bytes(16), 'hex'), 1, 12));

  insert into public.tickets (tenant_id, event_id, registration_id, code, signature, expires_at)
  values (v_tenant, p_event_id, v_reg_id, v_code, private.sign_code(v_code), v_event.ends_at)
  returning id into v_ticket_id;

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
-- Segunda via: com a Meta, o código vai pela fila nova
--
-- Resposta 1:1 a um toque de botão, então não exige o consentimento do
-- ingresso — a pessoa está pedindo o código naquele número, agora. Opt-out e
-- telefone inválido continuam valendo. Fora o desvio para a Meta, igual à
-- versão anterior (20260801093600).
-- -----------------------------------------------------------------------------
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
  v_provider text;
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

  delete from public.ticket_access_codes where created_at < now() - interval '30 days';

  select a.* into v_attendee
    from public.attendees a
   where a.tenant_id = v_tenant
     and a.cpf = v_digits;

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

  v_provider := private.whatsapp_provider(v_tenant);
  v_whatsapp := v_provider is not null;
  v_phone := nullif(coalesce(v_attendee.phone, ''), '');

  insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
  values (
    v_tenant,
    'email.ticket_code',
    jsonb_build_object('to', v_attendee.email, 'name', v_attendee.first_name, 'code', v_code),
    'ticket-code-' || v_id
  );

  if v_provider = 'meta' and v_phone is not null then
    perform private.enqueue_whatsapp_notification(
      v_tenant, null, null, 'ticket_code', v_phone, 'wa-ticket-code-' || v_id, false,
      jsonb_build_object('code', v_code, 'name', v_attendee.first_name)
    );
  elsif v_whatsapp and v_phone is not null then
    -- `run_at` no futuro escapa de propósito do alocador de ritmo da Evolution.
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

-- -----------------------------------------------------------------------------
-- O alocador de ritmo da Evolution não se aplica à Meta
--
-- Com a Meta nenhum job `whatsapp.*` deveria nascer em `outbox_jobs`; se
-- nascer (código antigo, reenvio pela tela antiga), não paga o custo de
-- contar a fila inteira dentro da transação.
-- -----------------------------------------------------------------------------
create or replace function private.schedule_whatsapp_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.type like 'whatsapp.%'
     and new.tenant_id is not null
     and new.run_at <= now()
     and private.whatsapp_provider(new.tenant_id) is distinct from 'meta' then
    new.run_at := private.next_whatsapp_slot(new.tenant_id);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Histórico (aba Envios): as notificações da Meta entram na lista de sempre
--
-- O vocabulário da lista é o do e-mail. Bloqueadas e canceladas não entram —
-- não são envios; a aba "Fila do WhatsApp" mostra as duas. O reenvio dessas
-- linhas é pela aba nova (job_id nulo aqui).
-- -----------------------------------------------------------------------------
create or replace view public.v_message_log with (security_invoker = true) as
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
left join public.events e on e.id = r.event_id

union all

select
  n.id,
  null::uuid,
  n.tenant_id,
  'whatsapp'::text,
  n.phone_e164,
  'whatsapp.' || n.kind::text,
  (case n.status
     when 'pendente'    then 'fila'
     when 'processando' then 'fila'
     when 'aceita'      then 'enviado'
     when 'enviada'     then 'enviado'
     when 'entregue'    then 'entregue'
     when 'lida'        then 'aberto'
     else 'falhou'
   end)::public.email_status,
  n.attempts,
  n.last_error,
  coalesce(n.sent_at, n.accepted_at),
  n.created_at,
  n.next_attempt_at,
  n.status::text,
  e.id,
  e.name
from public.whatsapp_notifications n
left join public.events e on e.id = n.event_id
where n.status not in ('bloqueada', 'cancelada');

grant select on public.v_message_log to authenticated;

-- -----------------------------------------------------------------------------
-- Ações do painel
--
-- `security definer` porque `authenticated` não escreve nas tabelas da fila;
-- a permissão é conferida aqui dentro e o filtro por empresa impede alcançar
-- outra. Cada ação vai para a auditoria.
-- -----------------------------------------------------------------------------
create or replace function private.whatsapp_require(p_perm text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.current_tenant();
begin
  if v_tenant is null then
    raise exception 'Empresa não identificada.' using errcode = 'IG004';
  end if;
  if not private.has_perm(p_perm) then
    raise exception 'Você não tem permissão para esta ação.' using errcode = 'IG005';
  end if;
  return v_tenant;
end;
$$;

-- Erros de destinatário que não adianta repetir (número inexistente,
-- bloqueio pelo usuário, destinatário = remetente).
create or replace function private.whatsapp_permanent_recipient_codes()
returns int[]
language sql
immutable
as $$ select array[131026, 131049, 131050, 131021] $$;

create or replace function public.whatsapp_set_paused(p_paused boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.manage');
begin
  if p_paused then
    update public.whatsapp_connections
       set paused = true, paused_at = now(), paused_by = auth.uid(),
           paused_reason = coalesce(nullif(trim(p_reason), ''), 'Pausado pelo painel')
     where tenant_id = v_tenant;
  else
    update public.whatsapp_connections
       set paused = false, paused_reason = null, paused_at = null, paused_by = null,
           breaker_open_until = null, breaker_manual = false
     where tenant_id = v_tenant;
  end if;

  perform audit.log('update', 'whatsapp_queue', v_tenant,
                    jsonb_build_object('paused', p_paused, 'reason', p_reason), v_tenant);
end;
$$;

create or replace function public.whatsapp_cancel_pending(
  p_event uuid default null,
  p_from  timestamptz default null,
  p_to    timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.manage');
  v_count  int;
begin
  update public.whatsapp_notifications
     set status = 'cancelada', cancelled_at = now(), last_error = 'Cancelada pelo painel.'
   where tenant_id = v_tenant
     and status = 'pendente'
     and (p_event is null or event_id = p_event)
     and (p_from is null or created_at >= p_from)
     and (p_to is null or created_at < p_to);
  get diagnostics v_count = row_count;

  perform audit.log('cancel', 'whatsapp_queue', v_tenant,
                    jsonb_build_object('event_id', p_event, 'from', p_from, 'to', p_to, 'count', v_count),
                    v_tenant);
  return v_count;
end;
$$;

create or replace function public.whatsapp_retry(
  p_event             uuid default null,
  p_from              timestamptz default null,
  p_to                timestamptz default null,
  p_include_uncertain boolean default false
)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.manage');
  v_count  int;
begin
  update public.whatsapp_notifications n
     set status = 'pendente', attempts = 0, next_attempt_at = now(),
         failed_at = null, locked_at = null, locked_by = null, request_started_at = null
   where n.tenant_id = v_tenant
     and (n.status = 'falhou' or (p_include_uncertain and n.status = 'incerta'))
     and (n.last_error_code is null
          or not (n.last_error_code = any (private.whatsapp_permanent_recipient_codes())))
     and n.phone_e164 is not null
     and not exists (
       select 1 from public.whatsapp_optouts o
        where o.tenant_id = n.tenant_id and o.phone_e164 = n.phone_e164
     )
     and (p_event is null or n.event_id = p_event)
     and (p_from is null or n.created_at >= p_from)
     and (p_to is null or n.created_at < p_to);
  get diagnostics v_count = row_count;

  perform audit.log('update', 'whatsapp_queue', v_tenant,
                    jsonb_build_object('retry', v_count, 'event_id', p_event,
                                       'include_uncertain', p_include_uncertain),
                    v_tenant);
  return v_count;
end;
$$;

create or replace function public.whatsapp_optout_set(p_phone text, p_optout boolean)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.manage');
  v_phone  text := private.to_e164_br(p_phone);
begin
  if v_phone is null then
    raise exception 'Telefone inválido.' using errcode = 'IG003';
  end if;

  if p_optout then
    insert into public.whatsapp_optouts (tenant_id, phone_e164, reason, source, created_by)
    values (v_tenant, v_phone, 'manual', 'painel', auth.uid())
    on conflict (tenant_id, phone_e164) do nothing;

    update public.whatsapp_notifications
       set status = 'bloqueada', block_reason = 'optout'
     where tenant_id = v_tenant and phone_e164 = v_phone and status = 'pendente';
  else
    delete from public.whatsapp_optouts where tenant_id = v_tenant and phone_e164 = v_phone;
  end if;

  perform audit.log('update', 'whatsapp_optout', v_tenant,
                    jsonb_build_object('optout', p_optout), v_tenant);
end;
$$;

create or replace function public.whatsapp_update_capacity(
  p_rate        int,
  p_daily       int,
  p_concurrency int
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.manage');
begin
  -- As faixas são as CHECKs da tabela; violar levanta check_violation.
  update public.whatsapp_connections
     set rate_per_second = p_rate, daily_unique_limit = p_daily, worker_concurrency = p_concurrency
   where tenant_id = v_tenant;

  perform audit.log('update', 'whatsapp_capacity', v_tenant,
                    jsonb_build_object('rate', p_rate, 'daily', p_daily, 'concurrency', p_concurrency),
                    v_tenant);
end;
$$;

-- -----------------------------------------------------------------------------
-- Números do painel — uma agregação, com os índices da fila
-- -----------------------------------------------------------------------------
create or replace function public.whatsapp_queue_stats(
  p_event uuid default null,
  p_from  timestamptz default null,
  p_to    timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid := private.whatsapp_require('settings.read');
  v_conn   public.whatsapp_connections%rowtype;
  v_result jsonb;
begin
  select * into v_conn from public.whatsapp_connections where tenant_id = v_tenant;

  with scope as (
    select *
      from public.whatsapp_notifications n
     where n.tenant_id = v_tenant
       and (p_event is null or n.event_id = p_event)
       and (p_from is null or n.created_at >= p_from)
       and (p_to is null or n.created_at < p_to)
  ),
  agg as (
    select
      count(*) filter (where status = 'pendente' and next_attempt_at <= now())  as em_fila,
      count(*) filter (where status = 'pendente' and next_attempt_at > now())   as agendadas,
      count(*) filter (where status in ('pendente', 'processando'))             as tamanho_fila,
      count(*) filter (where accepted_at is not null)                           as aceitas,
      count(*) filter (where sent_at is not null)                               as enviadas,
      count(*) filter (where delivered_at is not null)                          as entregues,
      count(*) filter (where read_at is not null)                               as lidas,
      count(*) filter (where accepted_at > now() - interval '1 minute')         as ult_1min,
      count(*) filter (where accepted_at > now() - interval '5 minutes')        as ult_5min,
      min(queued_at) filter (where status = 'pendente' and next_attempt_at <= now()) as mais_antiga
    from scope
  ),
  by_status as (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) as m
      from (select status::text, count(*) as n from scope group by status) s
  )
  select jsonb_build_object(
    'por_status', (select m from by_status),
    'em_fila', a.em_fila,
    'agendadas', a.agendadas,
    'tamanho_fila', a.tamanho_fila,
    'marcos', jsonb_build_object(
      'aceitas', a.aceitas, 'enviadas', a.enviadas, 'entregues', a.entregues, 'lidas', a.lidas
    ),
    'taxa_1min', round(a.ult_1min / 60.0, 6),
    'taxa_5min', round(a.ult_5min / 300.0, 6),
    'idade_mais_antiga_s', case when a.mais_antiga is null then null
                                else extract(epoch from now() - a.mais_antiga)::int end,
    'inscricoes', (
      select count(*) from public.registrations r
       where r.tenant_id = v_tenant and r.status = 'confirmada'
         and (p_event is null or r.event_id = p_event)
         and (p_from is null or r.created_at >= p_from)
         and (p_to is null or r.created_at < p_to)
    ),
    'destinatarios_24h', public.whatsapp_unique_recipients_24h(v_tenant),
    'teto_diario', v_conn.daily_unique_limit,
    'vazao_configurada', v_conn.rate_per_second,
    'concorrencia', v_conn.worker_concurrency,
    'pausado', coalesce(v_conn.paused, false),
    'motivo', v_conn.paused_reason,
    'breaker_ate', v_conn.breaker_open_until,
    'breaker_manual', coalesce(v_conn.breaker_manual, false),
    'qualidade', v_conn.quality_rating,
    'nivel', v_conn.messaging_tier,
    'workers', (select count(*) from public.whatsapp_worker_heartbeats
                 where last_seen_at > now() - interval '30 seconds'),
    'gerado_em', now()
  )
  into v_result
  from agg a;

  return v_result;
end;
$$;

revoke execute on function public.whatsapp_set_paused(boolean, text)                      from public, anon;
revoke execute on function public.whatsapp_cancel_pending(uuid, timestamptz, timestamptz)  from public, anon;
revoke execute on function public.whatsapp_retry(uuid, timestamptz, timestamptz, boolean) from public, anon;
revoke execute on function public.whatsapp_optout_set(text, boolean)                       from public, anon;
revoke execute on function public.whatsapp_update_capacity(int, int, int)                  from public, anon;
revoke execute on function public.whatsapp_queue_stats(uuid, timestamptz, timestamptz)     from public, anon;

grant execute on function public.whatsapp_set_paused(boolean, text)                      to authenticated;
grant execute on function public.whatsapp_cancel_pending(uuid, timestamptz, timestamptz)  to authenticated;
grant execute on function public.whatsapp_retry(uuid, timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.whatsapp_optout_set(text, boolean)                       to authenticated;
grant execute on function public.whatsapp_update_capacity(int, int, int)                  to authenticated;
grant execute on function public.whatsapp_queue_stats(uuid, timestamptz, timestamptz)     to authenticated;

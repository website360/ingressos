-- =============================================================================
-- 20260801093300_ticket_token_nas_mensagens
-- Corrige o token nulo nas mensagens de confirmação.
--
-- O gatilho de mensagens roda `after insert on registrations`, mas
-- `create_registration` insere o ingresso DEPOIS da inscrição, na mesma
-- transação. Quando o gatilho dispara, `tickets` ainda não tem a linha — então
-- `v_ticket` vem vazio e o job nasce com `ticket_code` e `token` nulos.
--
-- O sintoma é um link `/ingresso/null` no e-mail de confirmação. Está assim
-- desde o começo do módulo M2 e passou despercebido porque nenhum e-mail chegou
-- a sair (sem `RESEND_API_KEY`, o worker falha antes de renderizar). Apareceu
-- agora porque o WhatsApp anexa o QR Code só quando há token — e, sem token,
-- caía no envio de texto puro.
--
-- Correção: a mensagem de confirmação passa a nascer do INGRESSO, não da
-- inscrição. É o evento certo — o que a mensagem entrega é o ingresso, e antes
-- de ele existir não há o que enviar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Aviso interno: continua na inscrição
--
-- Não depende de ingresso, e amarrá-lo ao mesmo gatilho faria a organização
-- deixar de ser avisada se a emissão do ingresso mudasse de lugar.
-- -----------------------------------------------------------------------------
create or replace function private.notify_new_registration()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event    public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  if new.status <> 'confirmada' then
    return new;
  end if;

  select * into v_event    from public.events    where id = new.event_id;
  select * into v_attendee from public.attendees where id = new.attendee_id;

  insert into public.notifications (tenant_id, user_id, type, title, body, link, entity_type, entity_id)
  select new.tenant_id, m.user_id, 'registration.created',
         'Nova inscrição em ' || v_event.name,
         v_attendee.first_name || ' ' || v_attendee.last_name || ' — ' || new.number,
         '/eventos/' || v_event.id, 'registration', new.id
    from public.memberships m
   where m.tenant_id = new.tenant_id and m.status = 'ativo' and m.role in ('admin', 'organizador');

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Confirmação: nasce do ingresso, com o token preenchido
--
-- Reemissão gera um ingresso novo para a mesma inscrição; a `dedupe_key` por
-- inscrição impede a segunda mensagem.
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

-- -----------------------------------------------------------------------------
-- Cancelamento: continua na inscrição, que é onde o cancelamento acontece
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

-- -----------------------------------------------------------------------------
-- Troca dos gatilhos
-- -----------------------------------------------------------------------------
drop trigger if exists tg_registration_messages on public.registrations;

create trigger tg_registration_notification
  after insert on public.registrations
  for each row execute function private.notify_new_registration();

create trigger tg_registration_cancellation
  after update of status on public.registrations
  for each row execute function private.enqueue_cancellation_messages();

create trigger tg_ticket_confirmation
  after insert on public.tickets
  for each row execute function private.enqueue_confirmation_messages();

drop function if exists private.enqueue_registration_messages();

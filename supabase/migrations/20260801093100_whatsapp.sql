-- =============================================================================
-- 20260801093100_whatsapp
-- Integração com a Evolution API: conexão do número e entrega do ingresso
-- pelo WhatsApp, como segundo canal da fila de outbox (ADR-003).
--
-- A credencial do servidor Evolution mora aqui, e não em variável de ambiente,
-- porque trocar de servidor tem que ser um formulário — não um redeploy. O
-- preço disso é que o segredo passa a ser dado: as colunas `api_key` e
-- `instance_token` são GRAVÁVEIS mas NÃO LEGÍVEIS por `authenticated`. Quem lê
-- é o `service_role`, dentro do servidor Next.js. O painel mostra a máscara
-- guardada em `api_key_hint`, nunca a chave.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Estado da sessão do WhatsApp
--
-- A Evolution fala 'open' / 'connecting' / 'close'. Traduzimos na borda: o
-- vocabulário do banco é o do domínio, em português, como nos demais enums.
-- 'nunca_conectado' separa "ainda não pareei" de "caiu" — a tela diz coisas
-- diferentes em cada caso.
-- -----------------------------------------------------------------------------
create type public.whatsapp_state as enum (
  'nunca_conectado',
  'conectando',
  'conectado',
  'desconectado'
);

-- -----------------------------------------------------------------------------
-- whatsapp_connections — uma linha por empresa
--
-- A instância é uma só: o número é da empresa, não do evento. A chave primária
-- é o `tenant_id` justamente para o banco recusar a segunda linha.
-- -----------------------------------------------------------------------------
create table public.whatsapp_connections (
  tenant_id         uuid primary key references public.tenants (id) on delete cascade,

  -- Servidor Evolution
  base_url          text not null check (base_url ~* '^https?://[^\s]+$'),
  api_key           text not null check (length(api_key) between 8 and 500),
  api_key_hint      text not null,
  server_version    text,
  -- 'achatado' (Evolution <= 2.1) ou 'aninhado' (>= 2.2). Detectado ao salvar;
  -- null enquanto a sondagem não rodou.
  webhook_dialect   text check (webhook_dialect in ('achatado', 'aninhado')),

  -- Instância
  instance_name     text,
  instance_token    text,
  state             public.whatsapp_state not null default 'nunca_conectado',
  phone_number      text,

  -- Pareamento em andamento. O QR da Evolution vira pó em ~40s; guardar o
  -- último recebido deixa a tela reabrir sem pedir outro à toa.
  qr_code           text,
  qr_expires_at     timestamptz,

  last_connected_at timestamptz,
  last_error        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null
);

create trigger tg_whatsapp_connections_updated_at
  before update on public.whatsapp_connections
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- whatsapp_messages — trilha de entrega, espelhando `email_messages`
-- -----------------------------------------------------------------------------
create table public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  template            text not null,
  to_phone            text not null,
  body                text not null,
  payload             jsonb not null default '{}'::jsonb,
  status              public.email_status not null default 'fila',
  provider_message_id text,
  attempts            int not null default 0,
  last_error          text,
  sent_at             timestamptz,
  entity_type         text,
  entity_id           uuid,
  created_at          timestamptz not null default now()
);

create index ix_whatsapp_messages_listing
  on public.whatsapp_messages (tenant_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_connections force  row level security;
alter table public.whatsapp_messages    enable row level security;
alter table public.whatsapp_messages    force  row level security;

create policy whatsapp_connections_select on public.whatsapp_connections
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.read'))
  );

create policy whatsapp_connections_write on public.whatsapp_connections
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  );

create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.read'))
  );

-- -----------------------------------------------------------------------------
-- Privilégio por coluna: o segredo é de escrita, não de leitura
--
-- A RLS decide QUAIS LINHAS; o GRANT por coluna decide QUAIS COLUNAS. Só o
-- segundo impede que quem tem `settings.read` faça `select api_key`. O painel
-- grava a chave e nunca a lê de volta — para mostrar, existe `api_key_hint`.
-- -----------------------------------------------------------------------------
revoke all on public.whatsapp_connections from anon, authenticated;
revoke all on public.whatsapp_messages    from anon;

grant select (
  tenant_id, base_url, api_key_hint, server_version, webhook_dialect,
  instance_name, state, phone_number, qr_code, qr_expires_at,
  last_connected_at, last_error, created_at, updated_at, updated_by
) on public.whatsapp_connections to authenticated;

grant insert (
  tenant_id, base_url, api_key, api_key_hint, server_version, webhook_dialect,
  instance_name, instance_token, state, phone_number, qr_code, qr_expires_at,
  last_connected_at, last_error, updated_by
) on public.whatsapp_connections to authenticated;

grant update (
  base_url, api_key, api_key_hint, server_version, webhook_dialect,
  instance_name, instance_token, state, phone_number, qr_code, qr_expires_at,
  last_connected_at, last_error, updated_by
) on public.whatsapp_connections to authenticated;

grant delete on public.whatsapp_connections to authenticated;

-- -----------------------------------------------------------------------------
-- Enfileiramento: WhatsApp entra como segundo job, independente do e-mail
--
-- Substitui `private.enqueue_registration_emails` — o nome deixou de contar a
-- verdade quando passou a existir mais de um canal. Dois jobs separados de
-- propósito: o retry de um não segura o outro, e o WhatsApp fora do ar não
-- impede o e-mail de sair (a decisão de canal, ADR-003 aplicado ao segundo).
--
-- O job só nasce se a integração estiver configurada. Sem isso, cada inscrição
-- criaria um job condenado a estourar as 5 tentativas e cair na DLQ.
-- -----------------------------------------------------------------------------
create or replace function private.enqueue_registration_messages()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_event     public.events%rowtype;
  v_attendee  public.attendees%rowtype;
  v_ticket    public.tickets%rowtype;
  v_whatsapp  boolean;
begin
  select * into v_event    from public.events    where id = new.event_id;
  select * into v_attendee from public.attendees where id = new.attendee_id;
  select * into v_ticket   from public.tickets   where registration_id = new.id limit 1;

  select exists (
    select 1 from public.whatsapp_connections where tenant_id = new.tenant_id
  ) into v_whatsapp;

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

    if v_whatsapp and coalesce(v_attendee.phone, '') <> '' then
      insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
      values (
        new.tenant_id,
        'whatsapp.registration_confirmed',
        jsonb_build_object(
          'registration_id', new.id,
          'phone', v_attendee.phone,
          'name', v_attendee.first_name,
          'event_name', v_event.name,
          'event_starts_at', v_event.starts_at,
          'venue', coalesce(v_event.venue_name, ''),
          'city', coalesce(v_event.city, ''),
          'number', new.number,
          'ticket_code', v_ticket.code,
          'token', v_ticket.code || '.' || v_ticket.signature
        ),
        'wa-reg-confirmed-' || new.id
      )
      on conflict (dedupe_key) do nothing;
    end if;

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
  end if;

  return new;
end;
$$;

drop trigger if exists tg_registration_emails on public.registrations;

create trigger tg_registration_messages
  after insert or update of status on public.registrations
  for each row execute function private.enqueue_registration_messages();

-- A função antiga fica órfã; removê-la evita que alguém a religue por engano.
drop function if exists private.enqueue_registration_emails();

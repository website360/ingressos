-- =============================================================================
-- 20260801094100_whatsapp_escala_schema
-- WhatsApp em escala pela API oficial da Meta — esquema.
--
-- Design: docs/superpowers/specs/2026-11-18-whatsapp-em-escala-design.md
-- Reversão: supabase/rollbacks/20260801094100_whatsapp_escala_schema.down.sql
--
-- `whatsapp_notifications` é ao mesmo tempo o REGISTRO e a FILA (outbox) do
-- WhatsApp pela Meta. Uma tabela só, para não existir duas fontes de verdade
-- sobre "esta pessoa já recebeu a confirmação?": a linha nasce na transação
-- da inscrição, o worker a reivindica com SKIP LOCKED, e o webhook avança a
-- situação até "lida".
--
-- O caminho antigo (`outbox_jobs` → `whatsapp_messages`) continua valendo
-- para a Evolution e para o histórico.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vocabulário
-- -----------------------------------------------------------------------------
create type public.whatsapp_notification_status as enum (
  'pendente',     -- na fila (ou aguardando a hora do retry)
  'processando',  -- reivindicada por um worker
  'aceita',       -- a Meta aceitou (HTTP 200 + wamid) — NÃO é entrega
  'enviada',      -- webhook "sent"
  'entregue',     -- webhook "delivered"
  'lida',         -- webhook "read"
  'falhou',       -- definitiva: não sai mais sozinha
  'cancelada',    -- cancelada pelo painel ou porque o ingresso caiu
  'incerta',      -- a requisição saiu e a resposta se perdeu: não reenvia sozinha
  'bloqueada'     -- sem consentimento, opt-out ou telefone inválido
);

create type public.whatsapp_notification_kind as enum (
  'registration_confirmed',
  'registration_cancelled',
  'ticket_code'
);

-- -----------------------------------------------------------------------------
-- Modelos versionados
--
-- O texto aprovado mora na Meta; aqui fica o NOME, a versão e a ordem dos
-- parâmetros — que é contrato com o texto aprovado. Uma versão ativa por
-- tipo; a notificação guarda qual versão usou.
-- -----------------------------------------------------------------------------
create table public.whatsapp_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  key           public.whatsapp_notification_kind not null,
  name          text not null check (name ~ '^[a-z0-9_]+$' and length(name) <= 512),
  language      text not null default 'pt_BR' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  version       int  not null check (version >= 1),
  category      text not null check (category in ('utility', 'authentication')),
  header_type   text not null default 'none' check (header_type in ('none', 'image')),
  body_preview  text not null default '',
  -- Chaves, na ordem dos {{n}} do corpo. Vocabulário fechado, ver o worker:
  -- name, event_name, date, time, datetime, place, number, code.
  param_order   jsonb not null default '[]'::jsonb check (jsonb_typeof(param_order) = 'array'),
  -- Parâmetro do botão de URL dinâmico, se o modelo tiver um.
  button_param  text check (button_param in ('token', 'code')),
  meta_status   text not null default 'rascunho'
    check (meta_status in ('rascunho', 'em_analise', 'aprovado', 'rejeitado', 'pausado')),
  active        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, key, version)
);

create unique index uq_whatsapp_templates_active
  on public.whatsapp_templates (tenant_id, key) where active;

create trigger tg_whatsapp_templates_updated_at
  before update on public.whatsapp_templates
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Notificações (registro + fila)
-- -----------------------------------------------------------------------------
create table public.whatsapp_notifications (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  event_id           uuid references public.events (id) on delete set null,
  registration_id    uuid references public.registrations (id) on delete cascade,
  kind               public.whatsapp_notification_kind not null,

  -- E.164 com o "+". Nulo só quando a linha nasce bloqueada por telefone
  -- inválido — aí o motivo explica.
  phone_e164         text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),

  template_id        uuid references public.whatsapp_templates (id) on delete set null,
  template_name      text,
  template_version   int,
  language           text,
  consent_id         uuid references public.consents (id) on delete set null,

  status             public.whatsapp_notification_status not null default 'pendente',
  block_reason       text check (block_reason in ('sem_consentimento', 'optout', 'telefone_invalido')),

  attempts           int not null default 0 check (attempts >= 0),
  max_attempts       int not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at    timestamptz not null default now(),

  -- Trava do worker. `request_started_at` separa "pegou e morreu antes de
  -- enviar" (volta para a fila) de "enviou e morreu antes da resposta"
  -- (incerta — reenviar poderia duplicar).
  locked_at          timestamptz,
  locked_by          text,
  request_started_at timestamptz,

  meta_message_id    text,
  last_error_code    int,
  last_error         text,

  -- Só o que o modelo precisa e que não dá para reler na hora (ex.: o código
  -- da segunda via). Nome, evento e token são lidos no envio, a partir da
  -- inscrição: editar o evento antes do envio já reflete.
  params             jsonb not null default '{}'::jsonb,

  queued_at          timestamptz not null default now(),
  accepted_at        timestamptz,
  sent_at            timestamptz,
  delivered_at       timestamptz,
  read_at            timestamptz,
  failed_at          timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  dedupe_key         text not null unique
);

-- O claim: pendentes vencidas, na ordem.
create index ix_wa_notif_claim
  on public.whatsapp_notifications (next_attempt_at)
  where status = 'pendente';

-- A reconciliação: travadas há tempo demais.
create index ix_wa_notif_processing
  on public.whatsapp_notifications (locked_at)
  where status = 'processando';

-- Painel: contagem por evento e situação, e recorte por período.
create index ix_wa_notif_event_status
  on public.whatsapp_notifications (tenant_id, event_id, status);
create index ix_wa_notif_created
  on public.whatsapp_notifications (tenant_id, created_at);

-- Webhook: acha a notificação pelo id da Meta.
create unique index uq_wa_notif_wamid
  on public.whatsapp_notifications (meta_message_id)
  where meta_message_id is not null;

-- Teto de destinatários únicos em 24h e velocidade observada.
create index ix_wa_notif_accepted
  on public.whatsapp_notifications (tenant_id, accepted_at)
  include (phone_e164)
  where accepted_at is not null;

create index ix_wa_notif_registration
  on public.whatsapp_notifications (registration_id);

-- Opt-out: bloquear as pendentes do número.
create index ix_wa_notif_phone_pending
  on public.whatsapp_notifications (tenant_id, phone_e164)
  where status = 'pendente';

create trigger tg_whatsapp_notifications_updated_at
  before update on public.whatsapp_notifications
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Webhook cru — gravado ANTES de processar
--
-- Se o processamento falhar, o evento continua aqui para o worker reprocessar.
-- Tem telefone dentro: só o service role lê.
-- -----------------------------------------------------------------------------
create table public.whatsapp_webhook_events (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  phone_number_id  text,
  payload          jsonb not null,
  processed_at     timestamptz,
  attempts         int not null default 0,
  error            text
);

create index ix_wa_webhook_received on public.whatsapp_webhook_events (received_at);
create index ix_wa_webhook_pending
  on public.whatsapp_webhook_events (received_at)
  where processed_at is null;

-- -----------------------------------------------------------------------------
-- Opt-out e números inválidos
-- -----------------------------------------------------------------------------
create table public.whatsapp_optouts (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  phone_e164  text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason      text not null check (reason in ('pedido', 'invalido', 'bloqueio', 'manual')),
  source      text not null default 'sistema',
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  primary key (tenant_id, phone_e164)
);

-- -----------------------------------------------------------------------------
-- Limitador global (token bucket) — um por número, ou seja, por empresa
--
-- Todos os workers retiram fichas daqui; é isso que faz o limite ser do
-- NÚMERO e não de cada processo. `throttle_factor` é o freio que a Meta pede
-- com 429: a vazão efetiva cai pela metade por um minuto.
-- -----------------------------------------------------------------------------
create table public.whatsapp_rate_buckets (
  tenant_id        uuid primary key references public.tenants (id) on delete cascade,
  tokens           double precision not null default 0,
  refilled_at      timestamptz not null default now(),
  throttle_factor  double precision not null default 1 check (throttle_factor > 0 and throttle_factor <= 1),
  throttle_until   timestamptz
);

-- -----------------------------------------------------------------------------
-- Batimento dos workers (health check e painel)
-- -----------------------------------------------------------------------------
create table public.whatsapp_worker_heartbeats (
  worker_id     text primary key,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  stats         jsonb not null default '{}'::jsonb
);

-- -----------------------------------------------------------------------------
-- Controles de capacidade e de emergência — na conexão, que é uma por empresa
--
-- `send_interval_seconds` e `daily_send_limit` continuam sendo o ritmo da
-- Evolution. Estes valem para a Meta.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_connections
  add column rate_per_second     int not null default 20 check (rate_per_second between 1 and 1000),
  add column daily_unique_limit  int not null default 1000 check (daily_unique_limit between 1 and 10000000),
  add column worker_concurrency  int not null default 16 check (worker_concurrency between 1 and 256),
  add column paused              boolean not null default false,
  add column paused_reason       text,
  add column paused_at           timestamptz,
  add column paused_by           uuid references public.profiles (id) on delete set null,
  add column breaker_open_until  timestamptz,
  add column breaker_manual      boolean not null default false,
  add column quality_rating      text,
  add column messaging_tier      text;

-- Não são segredo: aparecem na tela. A escrita é só por RPC (permissão
-- conferida lá dentro), então só SELECT.
grant select (
  rate_per_second, daily_unique_limit, worker_concurrency, paused, paused_reason,
  paused_at, paused_by, breaker_open_until, breaker_manual, quality_rating, messaging_tier
) on public.whatsapp_connections to authenticated;

-- -----------------------------------------------------------------------------
-- Consentimento: o telefone a que o aceite se refere
-- -----------------------------------------------------------------------------
alter table public.consents add column subject text;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.whatsapp_templates          enable row level security;
alter table public.whatsapp_templates          force  row level security;
alter table public.whatsapp_notifications      enable row level security;
alter table public.whatsapp_notifications      force  row level security;
alter table public.whatsapp_webhook_events     enable row level security;
alter table public.whatsapp_webhook_events     force  row level security;
alter table public.whatsapp_optouts            enable row level security;
alter table public.whatsapp_optouts            force  row level security;
alter table public.whatsapp_rate_buckets       enable row level security;
alter table public.whatsapp_rate_buckets       force  row level security;
alter table public.whatsapp_worker_heartbeats  enable row level security;
alter table public.whatsapp_worker_heartbeats  force  row level security;

revoke all on public.whatsapp_templates         from anon, authenticated;
revoke all on public.whatsapp_notifications     from anon, authenticated;
revoke all on public.whatsapp_webhook_events    from anon, authenticated;
revoke all on public.whatsapp_optouts           from anon, authenticated;
revoke all on public.whatsapp_rate_buckets      from anon, authenticated;
revoke all on public.whatsapp_worker_heartbeats from anon, authenticated;

-- O servidor (rotas do Next e worker) usa o service role. Explícito, sem
-- depender do privilégio padrão do projeto — a CLI atual não o concede mais.
grant select, insert, update, delete on
  public.whatsapp_templates, public.whatsapp_notifications, public.whatsapp_webhook_events,
  public.whatsapp_optouts, public.whatsapp_rate_buckets, public.whatsapp_worker_heartbeats
  to service_role;

grant select on public.whatsapp_templates         to authenticated;
grant select on public.whatsapp_notifications     to authenticated;
grant select on public.whatsapp_optouts           to authenticated;
grant select on public.whatsapp_worker_heartbeats to authenticated;

create policy whatsapp_templates_select on public.whatsapp_templates
  for select to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.has_perm('settings.read')));

create policy whatsapp_notifications_select on public.whatsapp_notifications
  for select to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.has_perm('settings.read')));

create policy whatsapp_optouts_select on public.whatsapp_optouts
  for select to authenticated
  using (tenant_id = (select private.current_tenant()) and (select private.has_perm('settings.read')));

-- Batimento não tem empresa (o worker é do sistema) nem dado pessoal.
create policy whatsapp_heartbeats_select on public.whatsapp_worker_heartbeats
  for select to authenticated
  using ((select private.has_perm('settings.read')));

-- -----------------------------------------------------------------------------
-- Modelos iniciais
--
-- v1: os nomes que a empresa já configurou (ou os padrões) — é o que pode
-- estar aprovado na Meta hoje. v2 da confirmação: o modelo novo, com QR por
-- link e data/horário separados, em rascunho até a Meta aprovar.
-- -----------------------------------------------------------------------------
create or replace function private.ensure_whatsapp_templates(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_cfg      jsonb;
  v_language text;
  v_pick     text;
begin
  select coalesce(meta_templates, '{}'::jsonb) into v_cfg
    from public.whatsapp_connections where tenant_id = p_tenant;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  v_language := case when coalesce(v_cfg ->> 'language', '') ~ '^[a-z]{2}(_[A-Z]{2})?$'
                     then v_cfg ->> 'language' else 'pt_BR' end;

  -- Confirmação v1 (o modelo atual: QR no cabeçalho, data e hora juntas).
  v_pick := case when coalesce(v_cfg ->> 'confirmed', '') ~ '^[a-z0-9_]+$'
                 then v_cfg ->> 'confirmed' else 'ingresso_confirmado' end;
  insert into public.whatsapp_templates
    (tenant_id, key, name, language, version, category, header_type, body_preview,
     param_order, button_param, meta_status, active)
  values
    (p_tenant, 'registration_confirmed', v_pick, v_language, 1, 'utility', 'image',
     'Olá, {{1}}! Sua inscrição em *{{2}}* está confirmada. ✅ 📅 {{3}} 📍 {{4}} 🎟️ Inscrição {{5}}',
     '["name","event_name","datetime","place","number"]', 'token', 'aprovado', true)
  on conflict (tenant_id, key, version) do nothing;

  -- Confirmação v2 (o modelo novo, para cadastrar na Meta).
  insert into public.whatsapp_templates
    (tenant_id, key, name, language, version, category, header_type, body_preview,
     param_order, button_param, meta_status, active)
  values
    (p_tenant, 'registration_confirmed', 'confirmacao_inscricao', v_language, 2, 'utility', 'image',
     'Olá, {{1}}! Sua inscrição em *{{2}}* está confirmada. 📅 {{3}} às {{4}} 📍 {{5}}',
     '["name","event_name","date","time","place"]', 'token', 'rascunho', false)
  on conflict (tenant_id, key, version) do nothing;

  v_pick := case when coalesce(v_cfg ->> 'cancelled', '') ~ '^[a-z0-9_]+$'
                 then v_cfg ->> 'cancelled' else 'inscricao_cancelada' end;
  insert into public.whatsapp_templates
    (tenant_id, key, name, language, version, category, header_type, body_preview,
     param_order, button_param, meta_status, active)
  values
    (p_tenant, 'registration_cancelled', v_pick, v_language, 1, 'utility', 'none',
     'Olá, {{1}}. Sua inscrição em *{{2}}* foi cancelada (inscrição {{3}}).',
     '["name","event_name","number"]', null, 'aprovado', true)
  on conflict (tenant_id, key, version) do nothing;

  v_pick := case when coalesce(v_cfg ->> 'code', '') ~ '^[a-z0-9_]+$'
                 then v_cfg ->> 'code' else 'codigo_segunda_via' end;
  insert into public.whatsapp_templates
    (tenant_id, key, name, language, version, category, header_type, body_preview,
     param_order, button_param, meta_status, active)
  values
    (p_tenant, 'ticket_code', v_pick, v_language, 1, 'authentication', 'none',
     '{{1}} é seu código de verificação.',
     '["code"]', 'code', 'aprovado', true)
  on conflict (tenant_id, key, version) do nothing;
end;
$$;

create or replace function private.seed_whatsapp_templates()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.ensure_whatsapp_templates(new.id);
  return new;
end;
$$;

create trigger tg_tenant_whatsapp_templates
  after insert on public.tenants
  for each row execute function private.seed_whatsapp_templates();

-- -----------------------------------------------------------------------------
-- A tela de Configurações continua gravando nomes e idioma em
-- `whatsapp_connections.meta_templates`. Sem isto, o que a empresa digitou
-- (o nome aprovado na Meta) nunca chegaria aos modelos que o worker usa — e o
-- envio cairia em "modelo inexistente", pausando a fila.
--
-- Nome: só a versão 1 (é a que espelha a tela). Idioma: todas as versões.
-- -----------------------------------------------------------------------------
create or replace function private.sync_whatsapp_templates()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_cfg      jsonb := coalesce(new.meta_templates, '{}'::jsonb);
  v_language text;
begin
  perform private.ensure_whatsapp_templates(new.tenant_id);

  if coalesce(v_cfg ->> 'confirmed', '') ~ '^[a-z0-9_]+$' then
    update public.whatsapp_templates set name = v_cfg ->> 'confirmed'
     where tenant_id = new.tenant_id and key = 'registration_confirmed' and version = 1;
  end if;
  if coalesce(v_cfg ->> 'cancelled', '') ~ '^[a-z0-9_]+$' then
    update public.whatsapp_templates set name = v_cfg ->> 'cancelled'
     where tenant_id = new.tenant_id and key = 'registration_cancelled' and version = 1;
  end if;
  if coalesce(v_cfg ->> 'code', '') ~ '^[a-z0-9_]+$' then
    update public.whatsapp_templates set name = v_cfg ->> 'code'
     where tenant_id = new.tenant_id and key = 'ticket_code' and version = 1;
  end if;

  v_language := v_cfg ->> 'language';
  if coalesce(v_language, '') ~ '^[a-z]{2}(_[A-Z]{2})?$' then
    update public.whatsapp_templates set language = v_language
     where tenant_id = new.tenant_id and language is distinct from v_language;
  end if;

  return new;
end;
$$;

create trigger tg_whatsapp_connection_templates
  after insert or update of meta_templates on public.whatsapp_connections
  for each row execute function private.sync_whatsapp_templates();

select private.ensure_whatsapp_templates(id) from public.tenants;

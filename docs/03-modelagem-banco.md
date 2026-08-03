# 03 — Modelagem do Banco de Dados

> Toda estrutura descrita aqui nasce como **migration versionada** em `supabase/migrations/`.
> Nenhuma alteração manual no painel do Supabase, em nenhuma hipótese.

## 1. Esquemas

| Schema                        | Uso                                                           | Exposto via API                                 |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `public`                      | Tabelas de negócio e views                                    | Sim (com RLS)                                   |
| `private`                     | Funções `SECURITY DEFINER`, helpers de RLS, RPCs internas     | **Não** (`REVOKE ALL FROM anon, authenticated`) |
| `api`                         | RPCs que o cliente pode chamar (fachada fina sobre `private`) | Sim                                             |
| `audit`                       | Trilha de auditoria particionada, append-only                 | Somente leitura, via view                       |
| `storage`, `auth`, `realtime` | Gerenciados pelo Supabase                                     | —                                               |

## 2. Extensões

`pgcrypto` (UUID/gen_random_bytes) · `citext` (e-mail case-insensitive) · `postgis` (geofence) ·
`pg_trgm` (busca por nome) · `unaccent` (busca sem acento) · `pg_cron` (jobs) · `pg_net` (HTTP do banco) ·
`btree_gist` (constraints de exclusão por período).

## 3. Convenções

- Chave primária `uuid` com `DEFAULT gen_random_uuid()`.
- `tenant_id uuid NOT NULL` em **toda** tabela de negócio (denormalizado de propósito: RLS sem JOIN).
- `created_at`, `updated_at` (`timestamptz`), `created_by`, `updated_by` (uuid → `profiles`).
- Soft delete via `deleted_at timestamptz` nas entidades com histórico; nunca `DELETE` físico.
- Nomes em `snake_case`, tabelas no plural, enums como tipos nativos do Postgres.
- Índice em toda FK. Índice composto começando por `tenant_id` nas tabelas de alto volume.
- `NOT NULL` por padrão; nulo só quando "ausência" tem significado de negócio.

---

## 4. Tipos enumerados

```sql
CREATE TYPE event_status        AS ENUM ('rascunho','publicado','privado','encerrado','cancelado');
CREATE TYPE registration_status AS ENUM ('pendente','confirmada','cancelada','lista_espera','no_show');
CREATE TYPE ticket_status       AS ENUM ('valido','utilizado','cancelado','expirado','reemitido');
CREATE TYPE checkin_result      AS ENUM ('sucesso','duplicado','invalido','cancelado','fora_do_raio');
CREATE TYPE waitlist_status     AS ENUM ('aguardando','convocado','convertido','expirado','desistiu');
CREATE TYPE user_role           AS ENUM ('admin','organizador','recepcao','suporte');
CREATE TYPE support_priority    AS ENUM ('baixa','media','alta','critica');
CREATE TYPE support_status      AS ENUM ('aberto','em_andamento','aguardando','resolvido','fechado');
CREATE TYPE job_status          AS ENUM ('pendente','processando','concluido','falhou','descartado');
CREATE TYPE email_status        AS ENUM ('fila','enviado','entregue','aberto','falhou','bounce');
CREATE TYPE audit_action        AS ENUM ('create','update','delete','cancel','checkin','login','logout',
                                         'permission_change','export','access_sensitive');
```

---

## 5. Tabelas

### 5.1 Tenancy, identidade e permissões

**`tenants`** — empresas da plataforma

| Coluna                 | Tipo                        | Notas                                              |
| ---------------------- | --------------------------- | -------------------------------------------------- |
| id                     | uuid PK                     |                                                    |
| name                   | text NOT NULL               |                                                    |
| slug                   | citext UNIQUE NOT NULL      | usado na URL pública                               |
| document               | text                        | CNPJ, único quando presente                        |
| logo_url, brand_color  | text                        | branding das páginas públicas/e-mails              |
| plan, status           | text                        | `trial`/`ativo`/`suspenso`                         |
| settings               | jsonb NOT NULL DEFAULT '{}' | preferências (timezone, retenção, MFA obrigatória) |
| created_at, updated_at | timestamptz                 |                                                    |

**`profiles`** — 1:1 com `auth.users`
`id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`, `full_name`, `email citext`, `phone`,
`avatar_url`, `locale`, `last_login_at`, `mfa_enabled bool`, `status`.

**`memberships`** — usuário × tenant × papel
`(tenant_id, user_id)` UNIQUE · `role user_role` · `is_owner bool` · `status` · `invited_by` ·
`accepted_at`. É o que permite o mesmo usuário operar várias empresas.

**`permissions`** — catálogo global (`code` UNIQUE, `module`, `description`).
**`role_permissions`** — `(tenant_id, role, permission_code)` UNIQUE — permite o tenant customizar
o que cada papel faz, partindo de um seed padrão.
**`user_permission_overrides`** — concessão/revogação pontual por usuário (`granted bool`).
**`user_event_scopes`** — `(tenant_id, user_id, event_id)` — restringe recepção/organizador a eventos.

### 5.2 Catálogo de eventos

**`categories`** — `(tenant_id, slug)` UNIQUE, `name`, `color`, `icon`, `position`.
**`tags`** — `(tenant_id, slug)` UNIQUE, `name`.
**`event_tags`** — N:N `(event_id, tag_id)` PK composta.

**`events`** — núcleo do sistema

| Coluna                                                                                    | Tipo                             | Notas                                                |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| id                                                                                        | uuid PK                          |                                                      |
| tenant_id                                                                                 | uuid FK → tenants                |                                                      |
| name, slug                                                                                | text / citext                    | `(tenant_id, slug)` UNIQUE                           |
| short_description                                                                         | text                             | até 280 chars (CHECK)                                |
| description                                                                               | text                             | rich text (HTML sanitizado)                          |
| cover_url, banner_url, video_url                                                          | text                             |                                                      |
| category_id                                                                               | uuid FK                          |                                                      |
| starts_at, ends_at                                                                        | timestamptz                      | CHECK `ends_at > starts_at`                          |
| timezone                                                                                  | text DEFAULT 'America/Sao_Paulo' |                                                      |
| venue_name, address, address_number, complement, district, city, state, zip_code, country | text                             |                                                      |
| location                                                                                  | geography(Point,4326)            | latitude/longitude                                   |
| allowed_radius_m                                                                          | int DEFAULT 300                  | geofence do check-in                                 |
| google_maps_url                                                                           | text                             |                                                      |
| capacity                                                                                  | int NOT NULL CHECK > 0           |                                                      |
| overbooking_pct                                                                           | numeric(5,2) DEFAULT 0           |                                                      |
| seats_taken                                                                               | int NOT NULL DEFAULT 0           | mantido por trigger                                  |
| seats_waitlist                                                                            | int NOT NULL DEFAULT 0           | mantido por trigger                                  |
| checked_in_count                                                                          | int NOT NULL DEFAULT 0           | mantido por trigger                                  |
| cancelled_count                                                                           | int NOT NULL DEFAULT 0           | mantido por trigger                                  |
| registrations_open                                                                        | bool DEFAULT true                |                                                      |
| registration_deadline                                                                     | timestamptz                      |                                                      |
| waitlist_enabled                                                                          | bool DEFAULT true                |                                                      |
| waitlist_hold_hours                                                                       | int DEFAULT 24                   | validade da convocação                               |
| organizer_name, contact_email, contact_phone                                              | text                             |                                                      |
| status                                                                                    | event_status DEFAULT 'rascunho'  |                                                      |
| published_at, archived_at, deleted_at                                                     | timestamptz                      |                                                      |
| signing_key_id                                                                            | text                             | chave Ed25519 usada nos ingressos                    |
| settings                                                                                  | jsonb                            | campos customizados, política de cancelamento, flags |
| created_at, updated_at, created_by, updated_by                                            |                                  |                                                      |

**Constraints:**

```sql
CONSTRAINT chk_capacity CHECK (seats_taken <= floor(capacity * (1 + overbooking_pct/100.0)))
CONSTRAINT chk_counts   CHECK (seats_taken >= 0 AND checked_in_count >= 0 AND checked_in_count <= seats_taken)
```

**Índices:** `(tenant_id, status, starts_at DESC)` · `(tenant_id, slug)` UNIQUE · GIST em `location`
· GIN `to_tsvector('portuguese', name || short_description)` · `(tenant_id, category_id)`.

**Tabelas de conteúdo da landing** (todas com `tenant_id`, `event_id`, `position int`):
`event_schedule_items` (dia, hora início/fim, título, descrição, palestrante) ·
`event_speakers` (nome, cargo, empresa, bio, foto, redes) ·
`event_faqs` (pergunta, resposta) ·
`event_sponsors` (nome, logo, link, nível) ·
`event_media` (tipo, url, legenda) ·
`event_documents` (regulamento, política de cancelamento, texto LGPD — **versionados**: `version int`,
`content`, `published_at`; o aceite do participante referencia a versão exata).

**`ticket_types`** — `(event_id, name)` UNIQUE, `capacity`, `price numeric(10,2) DEFAULT 0`,
`sales_start`, `sales_end`, `seats_taken`, `is_active`, `description`, `position`.

> Nasce com `price` mesmo sendo tudo gratuito na fase 1 — inclusão de pagamentos depois não exige migração destrutiva.

**`event_slug_history`** — `(tenant_id, old_slug)` UNIQUE → `event_id`, para redirect 301.

### 5.3 Pessoas e inscrições

**`attendees`** — a pessoa, deduplicada por tenant
`(tenant_id, cpf)` UNIQUE · `first_name`, `last_name`, `cpf` (armazenado normalizado, só dígitos) ·
`cpf_hash bytea` (para busca sem expor) · `email citext` · `phone` · `birth_date` · `gender` ·
`city`, `state`, `country` · `company`, `job_title` · `photo_url` · `metadata jsonb` ·
`anonymized_at timestamptz` (LGPD).
**Índices:** `(tenant_id, cpf)` UNIQUE · `(tenant_id, email)` · GIN trigram em
`unaccent(first_name || ' ' || last_name)` para busca rápida no check-in.

**`registrations`** — a inscrição

| Coluna                                               | Notas                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| id, tenant_id, event_id, attendee_id, ticket_type_id |                                                                          |
| status                                               | `registration_status`                                                    |
| number                                               | text — número legível `EVT-2026-000123`, gerado por sequência por evento |
| source                                               | `landing`, `import`, `api`, `waitlist`, `admin`                          |
| referral                                             | "como conheceu"                                                          |
| custom_fields                                        | jsonb — campos personalizados do evento                                  |
| confirmed_at, cancelled_at                           | timestamptz                                                              |
| ip, user_agent                                       | inet / text (contexto da inscrição)                                      |
| idempotency_key                                      | text UNIQUE por tenant                                                   |

**Constraint de ouro:**

```sql
CREATE UNIQUE INDEX uq_registration_active_cpf
  ON registrations (event_id, attendee_id)
  WHERE status IN ('pendente','confirmada');
```

**Índices:** `(tenant_id, event_id, status, created_at DESC)` · `(tenant_id, attendee_id)`.

**`consents`** — LGPD versionado
`registration_id`, `document_type` (`lgpd`|`regulamento`|`marketing`), `document_version`,
`accepted bool`, `accepted_at`, `ip`, `user_agent`. Append-only.

**`tickets`** — o ingresso
`registration_id` FK · `code text UNIQUE` (legível, 12 chars base32) ·
`token_nonce bytea NOT NULL` · `signature bytea` · `key_id text` ·
`status ticket_status` · `issued_at`, `expires_at`, `revoked_at`, `revoked_reason` ·
`pdf_path text` (Storage) · `reissued_from uuid FK self`.
**Índices:** `code` UNIQUE · `(tenant_id, event_id, status)` · `(registration_id)`.

**`waitlist`** — lista de espera
`event_id`, `attendee_id`, `position` (gerado), `status waitlist_status`,
`invited_at`, `expires_at`, `converted_registration_id`, `notified_count int`.
`UNIQUE (event_id, attendee_id) WHERE status IN ('aguardando','convocado')`.

**`cancellations`**
`registration_id`, `ticket_id`, `reason_code`, `reason_text`, `cancelled_by_type`
(`participante`|`operador`|`sistema`), `cancelled_by_user`, `ip`, `user_agent`,
`seat_released bool`, `replaced_by_registration_id` (quem ocupou a vaga liberada).

### 5.4 Check-in

**`checkins`**

| Coluna                                              | Notas                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| id, tenant_id, event_id, ticket_id, registration_id |                                                                                           |
| result                                              | `checkin_result` — sucesso também registra as tentativas falhas, para o painel de alertas |
| checked_in_at                                       | timestamptz (momento real, pode vir do dispositivo offline)                               |
| synced_at                                           | timestamptz (quando chegou ao servidor)                                                   |
| operator_id                                         | uuid → profiles (recepcionista)                                                           |
| device_id, device_info, user_agent                  | identificação do aparelho                                                                 |
| ip                                                  | inet                                                                                      |
| location                                            | geography(Point,4326)                                                                     |
| accuracy_m                                          | numeric                                                                                   |
| city, state, country                                | preenchidos por geocoding assíncrono                                                      |
| within_geofence                                     | bool                                                                                      |
| distance_m                                          | numeric                                                                                   |
| override_confirmed                                  | bool — validado fora do raio mediante confirmação                                         |
| override_reason                                     | text                                                                                      |
| offline_captured                                    | bool                                                                                      |
| idempotency_key                                     | text — chave da fila offline                                                              |

**Constraints e índices:**

```sql
CREATE UNIQUE INDEX uq_checkin_valid ON checkins (ticket_id) WHERE result = 'sucesso';
CREATE UNIQUE INDEX uq_checkin_idem  ON checkins (tenant_id, idempotency_key);
CREATE INDEX ix_checkin_event_time   ON checkins (tenant_id, event_id, checked_in_at DESC);
CREATE INDEX ix_checkin_geo          ON checkins USING GIST (location);
```

O índice único parcial é o que torna o "ingresso já utilizado" impossível de burlar — inclusive na
sincronização de dois dispositivos offline.

### 5.5 Comunicação e operação

**`notifications`** — `user_id`, `type`, `title`, `body`, `link`, `entity_type`, `entity_id`,
`read_at`, `created_at`. Índice `(tenant_id, user_id, read_at NULLS FIRST, created_at DESC)`.

**`notification_preferences`** — `(user_id, type, channel)` → `enabled bool`.

**`email_messages`** — `template`, `to_email`, `subject`, `payload jsonb`, `status email_status`,
`provider_message_id`, `attempts`, `last_error`, `sent_at`, `opened_at`, `entity_type`, `entity_id`.

**`email_templates`** — `(tenant_id, key)` UNIQUE, `subject`, `html`, `variables jsonb`, `is_default`.

**`outbox_jobs`** — `type`, `payload jsonb`, `status job_status`, `run_at`, `attempts`,
`max_attempts`, `locked_at`, `locked_by`, `last_error`, `dedupe_key UNIQUE`.
Índice `(status, run_at)` para o worker fazer `FOR UPDATE SKIP LOCKED`.

**`support_tickets`** — `number`, `subject`, `description`, `category`, `priority`, `status`,
`requester_id`, `assignee_id`, `event_id`, `sla_due_at`, `resolved_at`, `closed_at`.
**`support_messages`** — `ticket_id`, `author_id`, `body`, `is_internal bool`.
**`attachments`** — polimórfica: `entity_type`, `entity_id`, `bucket`, `path`, `filename`,
`mime_type`, `size_bytes`, `uploaded_by`.

**`webhooks`** — `url`, `events text[]`, `secret`, `is_active`, `failure_count`.
**`webhook_deliveries`** — `webhook_id`, `event_type`, `payload`, `status_code`, `response_body`,
`attempts`, `delivered_at`.
**`api_keys`** — `name`, `key_hash bytea`, `prefix`, `scopes text[]`, `last_used_at`, `expires_at`, `revoked_at`.
**`rate_limits`** — `bucket_key`, `window_start`, `count`. PK `(bucket_key, window_start)`.
**`idempotency_keys`** — `key`, `endpoint`, `request_hash`, `response jsonb`, `expires_at`.
**`tenant_settings`** — chave/valor tipado por tenant (retenção, MFA, política padrão, remetente de e-mail).
**`signing_keys`** — `key_id`, `algorithm`, `public_key`, `private_key_ref` (referência ao Vault),
`active`, `rotated_at`. A privada **não** fica em coluna legível.

### 5.6 Auditoria

**`audit.audit_logs`** — particionada por mês (`PARTITION BY RANGE (created_at)`)
`tenant_id`, `actor_id`, `actor_email`, `actor_role`, `action audit_action`, `entity_type`,
`entity_id`, `changes jsonb` (diff antes/depois), `ip inet`, `user_agent`, `device_id`,
`location geography(Point,4326)`, `request_id uuid`, `created_at`.

RLS: `SELECT` permitido a quem tem `audit.read` do próprio tenant; **nenhuma** policy de
`INSERT/UPDATE/DELETE` para `authenticated` — só as funções `SECURITY DEFINER` escrevem.

**`audit.auth_events`** — login, logout, falha de login, troca de senha, MFA, sessão revogada.

---

## 6. Views e views materializadas

| Objeto                   | Conteúdo                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `v_event_stats`          | Por evento: capacidade, ocupadas, restantes, presentes, cancelados, fila, taxa de comparecimento |
| `v_registration_full`    | Inscrição + participante + evento + ingresso + check-in (base das exportações)                   |
| `v_checkin_alerts`       | Duplicidades, fora do raio, tentativas com ingresso cancelado                                    |
| `v_waitlist_queue`       | Fila ordenada com posição e prazo da convocação                                                  |
| `mv_dashboard_kpis`      | KPIs agregados por tenant/dia — refresh incremental a cada 5 min por `pg_cron`                   |
| `mv_attendees_by_region` | Participantes por cidade/estado para o mapa                                                      |

Views expostas ao cliente usam `security_invoker = true` para herdar a RLS das tabelas base.

---

## 7. Funções

### RPCs de negócio (`private`, `SECURITY DEFINER`, expostas por fachada em `api`)

| Função                                                                                    | Responsabilidade                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_create_registration(p_event_id, p_attendee jsonb, p_consents jsonb, p_context jsonb)` | Inscrição atômica: lock do evento, validações, upsert de participante, inscrição, ingresso, consentimentos, outbox. Retorna ingresso ou posição na fila |
| `fn_cancel_registration(p_registration_id, p_reason, p_context jsonb)`                    | Cancela, revoga ingresso, libera vaga, registra cancelamento, dispara promoção da fila                                                                  |
| `fn_checkin(p_token text, p_context jsonb)`                                               | Valida assinatura/status/geofence, grava check-in, retorna resultado tipado (inclui dados da primeira entrada em caso de duplicado)                     |
| `fn_checkin_batch(p_items jsonb)`                                                         | Sincronização offline idempotente, resolução de conflito "primeiro vence"                                                                               |
| `fn_promote_waitlist(p_event_id, p_slots int)`                                            | Convoca N próximos da fila com reserva expirável e outbox de e-mail                                                                                     |
| `fn_expire_waitlist_holds()`                                                              | Job: devolve reservas vencidas à fila e reconvoca                                                                                                       |
| `fn_close_full_events()` / `fn_close_past_events()`                                       | Jobs de fechamento automático                                                                                                                           |
| `fn_anonymize_attendee(p_attendee_id)`                                                    | LGPD: anonimiza mantendo agregados estatísticos                                                                                                         |
| `fn_export_attendee_data(p_attendee_id)`                                                  | LGPD: portabilidade dos dados do titular                                                                                                                |

### Helpers de RLS (`private`, `STABLE SECURITY DEFINER`)

`current_tenant()` · `tenant_ids()` · `has_perm(text)` · `event_in_scope(uuid)` · `is_platform_admin()`.

### Triggers

| Trigger                           | Tabela            | Efeito                                                                |
| --------------------------------- | ----------------- | --------------------------------------------------------------------- |
| `tg_set_updated_at`               | todas             | `updated_at = now()`, `updated_by = auth.uid()`                       |
| `tg_registration_counters`        | `registrations`   | Ajusta `seats_taken`/`cancelled_count` conforme a transição de status |
| `tg_checkin_counters`             | `checkins`        | Ajusta `checked_in_count` (só em `result = 'sucesso'`)                |
| `tg_waitlist_counters`            | `waitlist`        | Ajusta `seats_waitlist`                                               |
| `tg_audit_changes`                | tabelas sensíveis | Grava diff em `audit.audit_logs` com contexto da requisição           |
| `tg_event_slug_history`           | `events`          | Guarda o slug antigo ao renomear                                      |
| `tg_broadcast_event_stats`        | `events`          | `realtime.broadcast_changes()` no canal do evento                     |
| `tg_cancellation_promote`         | `cancellations`   | Insere job de promoção da lista de espera                             |
| `tg_generate_registration_number` | `registrations`   | Número legível sequencial por evento                                  |
| `tg_prevent_audit_mutation`       | `audit.*`         | `RAISE EXCEPTION` em UPDATE/DELETE                                    |

### Jobs (`pg_cron`)

| Frequência | Job                                                                     |
| ---------- | ----------------------------------------------------------------------- |
| 10s        | `process_outbox()` — worker de e-mail/webhook/PDF                       |
| 5min       | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_kpis`              |
| 15min      | `fn_expire_waitlist_holds()`                                            |
| 1h         | `fn_close_past_events()`, limpeza de `idempotency_keys` e `rate_limits` |
| diário     | Lembretes D-3/D-1, relatórios agendados, retenção/anonimização LGPD     |
| mensal     | Criação da partição do mês seguinte em `audit.audit_logs`               |

---

## 8. Padrão de RLS por tabela

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;   -- vale até para o dono da tabela

-- leitura: mesmo tenant + permissão + escopo de evento quando aplicável
CREATE POLICY sel_<t> ON public.<t> FOR SELECT TO authenticated
USING (
  tenant_id = (SELECT private.current_tenant())
  AND (SELECT private.has_perm('<modulo>.read'))
  AND (event_id IS NULL OR (SELECT private.event_in_scope(event_id)))
);

CREATE POLICY ins_<t> ON public.<t> FOR INSERT TO authenticated
WITH CHECK (tenant_id = (SELECT private.current_tenant()) AND (SELECT private.has_perm('<modulo>.create')));

CREATE POLICY upd_<t> ON public.<t> FOR UPDATE TO authenticated
USING (...) WITH CHECK (...);

-- DELETE: geralmente ausente (soft delete via UPDATE)
```

**Acesso público (`anon`)** existe apenas para:

- `events` com `status = 'publicado'` e `deleted_at IS NULL` (colunas públicas via view);
- conteúdo da landing do evento publicado;
- **nunca** para `attendees`, `registrations`, `tickets`, `checkins`.

A inscrição pública **não** é um `INSERT` do `anon` — é chamada da RPC `api.create_registration`,
com `SECURITY DEFINER` e rate limit interno. O anônimo não escreve em tabela nenhuma, diretamente.

Acesso do participante ao próprio ingresso: token assinado na URL → RPC `api.get_ticket(token)`,
sem sessão e sem exposição de tabela.

---

## 9. Seeds

`seed.sql` (idempotente): catálogo de `permissions`, `role_permissions` padrão dos 4 papéis,
categorias iniciais, templates de e-mail padrão, tenant de demonstração com 3 eventos, 200
participantes fictícios, 120 check-ins e alguns cancelamentos — o suficiente para o dashboard e os
relatórios terem forma real em desenvolvimento.

## 10. Estratégia de migrations

```
supabase/migrations/
  20260801090000_extensions.sql
  20260801090100_schemas_and_roles.sql
  20260801090200_enums.sql
  20260801090300_tenancy.sql
  20260801090400_rbac.sql
  20260801090500_events.sql
  ...
  20260801099000_rls_policies.sql
  20260801099100_functions_rpc.sql
  20260801099200_triggers.sql
  20260801099300_views.sql
  20260801099400_cron_jobs.sql
```

Regras: uma migration = uma intenção; sempre reversível (script `down` documentado no cabeçalho);
alterações destrutivas em duas etapas (adicionar → migrar dados → remover em release seguinte);
CI roda `supabase db reset` + testes pgTAP em cada PR.

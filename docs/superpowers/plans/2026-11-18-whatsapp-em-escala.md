# WhatsApp em escala (Meta Cloud API) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As confirmações de inscrição saem pelo WhatsApp oficial (Meta) a partir de uma fila persistida no Postgres. Um worker Node dedicado envia com limite global, idempotência, reconciliação, circuit breaker e painel de controle. Meta: 100 mil inscrições sem que nenhuma espere pelo WhatsApp.

**Architecture:**
- A tabela `whatsapp_notifications` é ao mesmo tempo o registro e a outbox. Os gatilhos existentes da inscrição gravam nela na mesma transação.
- Um processo Node separado (`worker/whatsapp`, sob PM2) reivindica lotes com `FOR UPDATE SKIP LOCKED`. Antes, retira fichas de um token bucket global no Postgres. Envia pela Cloud API com `biz_opaque_callback_data` = id da notificação.
- O webhook persiste o evento cru e depois avança os status.

**Tech Stack:** Next.js 15, React 19, Supabase Postgres, `pg`, `esbuild`, PM2, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-whatsapp-em-escala-design.md`

## Global Constraints

- **Nada contra produção:** nenhum teste, carga ou migration roda no banco de produção. O `.env.local` aponta para PRODUÇÃO. Testes de integração e carga só rodam com `TEST_DATABASE_URL` apontando para `127.0.0.1`/`localhost`; o helper recusa qualquer outro host.
- **Nenhuma chamada real à Meta:** todo teste usa o servidor Meta simulado (`tests/support/mock-meta.ts`).
- **Git:** sem `git push` e sem deploy. Commits locais por tarefa.
- **Reversão:** cada migration nova tem a sua reversão em `supabase/rollbacks/<mesmo-nome>.down.sql`. Nenhuma migration apaga dados existentes.
- **Ambientes:** a Graph API usa `META_GRAPH_VERSION`, padrão `v23.0`.
- **Credenciais:** variáveis `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_PHONE_NUMBER_ID`, `META_WABA_ID` e `META_VERIFY_TOKEN` têm precedência sobre a credencial salva no banco.
- **Padrões de configuração:** `rate_per_second` 20 (máx. 1000), `daily_unique_limit` 1000, `worker_concurrency` 16, `max_attempts` 5.
- **Retry:** backoff `min(30s × 2^tentativa, 15min) × jitter[0,5–1,5]`.
- **Circuit breaker:** abre com >20% de erro não-destinatário e ≥50 envios em 60 s, por 5 min. Erro sistêmico abre até a retomada manual.
- **Reconciliação:** `processando` há mais de 2 min sem `request_started_at` volta para `pendente`. Com `request_started_at`, vira `incerta`.
- **Pool:** o worker usa no máximo 4 conexões `pg`.
- **Webhook:** retenção de 7 dias. Corpo de até 1 MB.
- **Dados pessoais:** os logs não levam token nem telefone completo; a máscara é `+55 11 9****-1234`. Os parâmetros do modelo são montados na hora do envio e o job só carrega ids.
- **Consentimento:** `document_type = 'whatsapp'`, versão `WHATSAPP_CONSENT_VERSION = 1`. A caixa vem desmarcada e é opcional. O texto é "Quero receber a confirmação e o ingresso pelo WhatsApp neste número."
- **Evolution:** o comportamento atual continua igual.
- **Interface:** todo texto de interface é em português.

## Review Focus

1. **Duplicidade quando o worker morre entre o POST e a gravação do resultado.** A notificação vira `incerta`, nunca `pendente`. O teste está na Tarefa 6.
2. **Dois workers dividindo o bucket.** A soma concedida em 1 s nunca passa de `rate_per_second` + capacidade. O teste está na Tarefa 3.
3. **Webhook `sent` que chega antes de o worker gravar o wamid.** Ele casa por `biz_opaque_callback_data` e o resultado tardio do worker não rebaixa o status. O teste está na Tarefa 7.
4. **Telefone salvo em formatos variados** (`(11) 98765-4321`, `5511987654321`, `+55…`, fixo do DDD 55). As versões SQL e TS do E.164 devem dar sempre o mesmo resultado. O teste está na Tarefa 3.
5. **Teste de integração apontado sem querer para o banco de produção.** O helper aborta. O teste está na Tarefa 1.

---

### Task 1: Harness de teste com Postgres local

**Files:**
- Create: `vitest.integration.config.ts`, `tests/support/db.ts`, `tests/support/mock-meta.ts`, `tests/integration/harness.test.ts`
- Modify: `package.json` (scripts `test:int`, `worker:build`; mover `pg` para `dependencies`; devDep `esbuild`)

**Interfaces:**
- Produces:
  - `getTestPool(): pg.Pool`. Lança `Error("TEST_DATABASE_URL precisa apontar para localhost")` se o host não for local.
  - `resetWhatsappTables(pool)`.
  - `createTestEvent(pool, opts?) → {tenantId, eventId}`.
  - `register(pool, eventId, {phone, whatsappConsent}) → {registrationId}`, que chama a RPC real `create_registration`.
  - `startMockMeta(opts: {latencyMs?, script?: (req) => MockReply}) → {url, requests: MockRequest[], close()}`.

- [ ] Pré-condição: Docker Desktop ligado, `npx supabase start`, `npx supabase db reset` (aplica todas as migrations no local). Exportar `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- [ ] Escrever `harness.test.ts`:
  - `getTestPool` com `TEST_DATABASE_URL` em host remoto lança o erro.
  - Com host local, `select 1` funciona.
  - O mock Meta responde 200 com `{messages:[{id:"wamid.X"}]}` por padrão e registra a requisição.
- [ ] `npm run test:int` → FAIL (os módulos não existem).
- [ ] Implementar o harness. `npm run test:int` → PASS.
- [ ] Commit `test: harness de integração com Postgres local e Meta simulada`.

### Task 2: Migration — esquema

**Files:**
- Create: `supabase/migrations/20260801094100_whatsapp_escala_schema.sql` e a reversão correspondente
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces:
  - O enum `whatsapp_notification_status`: `pendente, processando, aceita, enviada, entregue, lida, falhou, cancelada, incerta, bloqueada`.
  - As tabelas, colunas e índices da seção "Dados" do spec: `whatsapp_notifications`, `whatsapp_templates`, `whatsapp_webhook_events`, `whatsapp_optouts`, `whatsapp_rate_buckets`, `whatsapp_worker_heartbeats`, as colunas novas em `whatsapp_connections` e a coluna `consents.subject text`.
  - O enum `kind`: `registration_confirmed | registration_cancelled | ticket_code`. O `block_reason` é `sem_consentimento | optout | telefone_invalido`.
  - RLS: SELECT por `settings.read` na empresa. Nenhum INSERT/UPDATE/DELETE para `authenticated`; tudo passa por RPC. Nada para `anon`.
  - O seed de `whatsapp_templates` v1 vem de `meta_templates`. A v2 `confirmacao_inscricao` entra com header image, `meta_status = rascunho` e inativa.
- [ ] Testes:
  - Uma segunda linha com a mesma `dedupe_key` falha.
  - `authenticated` sem permissão não lê `whatsapp_notifications`.
  - `anon` não lê nada.
  - Aplicar a reversão e reaplicar a migration funciona sem erro.
- [ ] Rodar → FAIL. Escrever a migration e a reversão. `npx supabase db reset` → `npm run test:int` → PASS.
- [ ] Commit.

### Task 3: Migration — funções do worker, E.164 e limitador global

**Files:**
- Create: `supabase/migrations/20260801094200_whatsapp_escala_funcoes.sql` e a reversão; `shared/whatsapp/phone-e164.ts`
- Test: `tests/integration/functions.test.ts`, `tests/unit/phone-e164.test.ts`

**Interfaces** (todas com EXECUTE só para `service_role`):
- Produces:
  - `private.to_e164_br(text) returns text`, com as mesmas regras de `toWhatsAppNumber` e prefixo `+`.
  - TS: `toE164Br(input: string): string | null` em `shared/whatsapp/phone-e164.ts`.
  - `public.whatsapp_take_tokens(p_tenant uuid, p_want int) returns int`.
  - `public.claim_whatsapp_notifications(p_limit int, p_worker text) returns setof whatsapp_notifications`.
  - `public.mark_whatsapp_request_started(p_ids uuid[])`.
  - `public.record_whatsapp_result(p_id uuid, p_outcome text, p_wamid text, p_error_code int, p_error text, p_retry_at timestamptz, p_count_attempt boolean)`, com `p_outcome ∈ aceita|retry|falhou|incerta|devolver`. Nunca rebaixa um status que já avançou.
  - `public.reconcile_whatsapp(p_stale interval default '2 minutes') returns jsonb`.
  - `public.whatsapp_unique_recipients_24h(p_tenant uuid) returns int`.
  - `public.whatsapp_heartbeat(p_worker text, p_stats jsonb)`.
  - `public.whatsapp_open_breaker(p_tenant uuid, p_until timestamptz, p_reason text, p_manual boolean)`.
- [ ] Testes:
  - Unit: tabela de casos E.164 (incluindo os do Review Focus 4).
  - Integração: o SQL dá o mesmo resultado que o TS para cada caso.
  - Bucket: com taxa 10, `take(50)` dá 10; após 1 s dá cerca de 10. Duas conexões chamando em paralelo por 2 s somam ≤ 30 (2 × 10 + 10 de capacidade).
  - Claim concorrente: duas conexões pegando 50 de 100 nunca repetem id.
  - Transições do `record_whatsapp_result`: `retry` não incrementa além de `max_attempts` (vira `falhou`). `devolver` não gasta tentativa. Um resultado `aceita` depois de `entregue` mantém `entregue` e grava o wamid.
  - Reconciliação: os dois casos de `processando` antigo.
- [ ] Rodar → FAIL. Implementar. PASS. Commit.

### Task 4: Migration — enfileiramento, convivência e RPCs do painel

**Files:**
- Create: `supabase/migrations/20260801094300_whatsapp_escala_fila.sql` e a reversão
- Test: `tests/integration/enqueue.test.ts`, `tests/integration/admin-rpcs.test.ts`

**Interfaces:**
- Produces:
  - **Enfileiramento:** `private.enqueue_confirmation_messages` e `private.enqueue_cancellation_messages`, reescritas. Com `provider = 'meta'`, gravam em `whatsapp_notifications`:
    - `dedupe_key`: `wa-confirmed-{registration_id}` e `wa-cancelled-{registration_id}`.
    - Status: `pendente` ou `bloqueada` com motivo.
    - O consentimento vem de `consents` (`document_type = 'whatsapp'` e `accepted`) da mesma inscrição.
    - Com Evolution, o comportamento é idêntico ao atual.
  - **Segunda via:** `request_ticket_code` grava em `whatsapp_notifications` (kind `ticket_code`, sem exigir consentimento) quando o provedor é Meta.
  - **Agendador:** `private.schedule_whatsapp_job` não é chamado para empresa com Meta.
  - **Log:** `v_message_log` ganha `union all` com `whatsapp_notifications` (`channel = 'whatsapp'`).
  - **Ações do painel** (RPCs para `authenticated`, com `settings.manage` checado dentro e auditoria):
    - `whatsapp_set_paused(p_paused boolean, p_reason text)`. Ao retomar, também zera `breaker_open_until`.
    - `whatsapp_cancel_pending(p_event uuid, p_from timestamptz, p_to timestamptz) returns int`.
    - `whatsapp_retry(p_event uuid, p_from timestamptz, p_to timestamptz, p_include_uncertain boolean) returns int`. Só reenvia falhas elegíveis, isto é, com `last_error_code` fora da lista de erros definitivos de destinatário.
    - `whatsapp_optout_set(p_phone text, p_optout boolean)`.
    - `whatsapp_update_capacity(p_rate int, p_daily int, p_concurrency int)`.
  - **Estatísticas:** `whatsapp_queue_stats(p_event uuid, p_from timestamptz, p_to timestamptz) returns jsonb`, para `settings.read`. Devolve:
    - contagem por status, `em_fila`, `agendadas`, `inscricoes`;
    - `taxa_1min`, `taxa_5min`, `idade_mais_antiga_s`;
    - `destinatarios_24h`, `teto_diario`;
    - `pausado`, `motivo`, `breaker_ate`, `workers` (heartbeat < 30 s), `qualidade`.
- [ ] Testes:
  - Inscrição com consentimento e Meta → 1 linha `pendente` na mesma transação. Um rollback da transação da inscrição não deixa nenhuma linha.
  - Sem consentimento → `bloqueada/sem_consentimento`.
  - Opt-out → `bloqueada/optout`.
  - Telefone inválido → `bloqueada/telefone_invalido`.
  - Gatilho disparado duas vezes → 1 linha.
  - Com Evolution, `outbox_jobs` recebe o job como hoje.
  - Nenhum job `whatsapp.*` em `outbox_jobs` com Meta.
  - RPCs: sem permissão → erro IG005. Cancelar e reenviar respeitam os filtros e a elegibilidade. As stats batem com as linhas semeadas.
- [ ] Rodar → FAIL. Implementar. PASS.
- [ ] Regerar `src/lib/supabase/database.types.ts` a partir do banco **local** (`npm run local:types`).
- [ ] `npm run typecheck`. Commit.

### Task 5: Módulos puros do envio

**Files:**
- Create: `shared/whatsapp/errors.ts`, `shared/whatsapp/backoff.ts`, `shared/whatsapp/breaker.ts`, `shared/whatsapp/drain-estimate.ts`, `shared/whatsapp/mask.ts`
- Modify: `src/lib/meta/client.ts` e `src/lib/meta/templates.ts`
- Test: `tests/unit/whatsapp-scale.test.ts`; acrescentar em `tests/unit/meta-whatsapp.test.ts`

**Interfaces:**
- Produces:
  - `classifyMetaFailure(f: {phase: "before_send" | "after_send"; status?: number; code?: number; timeout?: boolean}): "retry_safe" | "throttle" | "permanent_recipient" | "permanent_message" | "systemic" | "uncertain"`. As listas de códigos são as do spec.
  - `nextRetryAt(attempt: number, now: Date, rand?: () => number): Date`.
  - `class Breaker { constructor(opts); record(kind: "ok" | "error" | "recipient_error", at: number): void; shouldOpen(at: number): boolean }`.
  - `estimateDrainSeconds(queue: number, ratePerSec: number, dailyRemaining: number, dailyLimit: number): number | null`.
  - `maskPhone(e164: string): string`.
  - `META_GRAPH_BASE` passa a vir de `metaGraphBase()`, que lê `META_GRAPH_VERSION`.
  - `MetaWhatsAppClient.sendTemplate(to, template, opts?: {callbackData?: string})`, que inclui `biz_opaque_callback_data`.
  - `MetaApiError` ganha `phase` e `timeout`.
  - `buildConfirmationV2(params: {name; eventName; date; time; place; token}, cfg: {name; language}, qrUrl: string): MetaTemplateMessage`. Header `image.link`, 5 parâmetros de corpo, botão URL com o token.
  - `metaTemplateGuide` passa a incluir a v2.
- [ ] Testes:
  - Cada código do spec cai na classe certa; timeout depois do envio dá `uncertain` e antes dá `retry_safe`.
  - Backoff com `rand` fixo dá os valores esperados e respeita o teto de 15 min.
  - O breaker não abre com 49 envios e abre com 50 a 21% de erro; erros de destinatário não contam.
  - A estimativa com teto diário esgotado leva em conta a janela.
  - O JSON da v2 tem `image.link` e `biz_opaque_callback_data`.
- [ ] Rodar → FAIL. Implementar. PASS. Commit.

### Task 6: Worker

**Files:**
- Create:
  - `worker/whatsapp/index.ts` (entrada e sinais)
  - `worker/whatsapp/config.ts` (env e precedência de credenciais)
  - `worker/whatsapp/db.ts` (pool, reconexão)
  - `worker/whatsapp/dispatcher.ts` (laço)
  - `worker/whatsapp/send.ts` (monta os parâmetros na hora e chama a Meta)
  - `worker/whatsapp/reconciler.ts` (advisory lock e limpeza de 7 dias)
  - `worker/whatsapp/log.ts` (JSON)
  - `scripts/build-worker.mjs` (esbuild → `dist/worker.js`)
- Modify: `ecosystem.config.js` (app `ingressos-whatsapp`, fork, 1 instância, `kill_timeout` 25000), `scripts/deploy.sh` (`npm run worker:build` e reload dos dois apps)
- Test: `tests/integration/worker.test.ts`

**Interfaces:**
- Consumes: as funções SQL da Tarefa 3 e os módulos da Tarefa 5.
- Produces:
  - `startWorker(opts: {databaseUrl; metaBaseUrl?; workerId?; appUrl}): Promise<{stop(): Promise<void>}>`. O teste usa isso em processo; o `index.ts` usa para produção.
  - O QR vai como link para `${appUrl}/api/ingresso/${token}/qr.png`.
- [ ] Testes, contra o mock Meta:
  - **Vazão:** 200 notificações saem todas como `aceita`, com o wamid gravado, ritmo ≤ taxa+capacidade e `biz_opaque_callback_data` = id.
  - **Throttle e erros recuperáveis:** 429/130429 → retry agendado e a taxa efetiva cai. 5xx → retry. Conexão recusada → retry seguro.
  - **Erros definitivos e sistêmicos:**
    - Timeout após o envio → `incerta`, e o mock recebe exatamente 1 requisição.
    - 131026 → `falhou` e opt-out `invalido`.
    - 190 → breaker manual aberto, a notificação volta `pendente` sem gastar tentativa e nada mais sai até `whatsapp_set_paused(false)`.
    - 30% de 500 em 60 envios → breaker de 5 min.
  - **Recuperação após reinício:**
    - `stop()` no meio do lote: as não iniciadas voltam a `pendente`, as em voo terminam.
    - Worker "morto" (lock antigo com `request_started_at`) → a reconciliação marca `incerta`.
    - Sem `request_started_at` → volta para `pendente`.
  - **Concorrência e limites:**
    - Dois workers sobre 500 notificações → 500 requisições ao mock, nenhum id repetido.
    - Postgres derrubado (pool encerrado e recriado) → o worker registra o erro e continua.
    - Teto diário de 5 → só 5 destinatários únicos e `motivo = teto_diario` visível nas stats.
  - **Dados atuais na hora do envio:** um evento renomeado antes do envio sai com o nome novo.
- [ ] Rodar → FAIL. Implementar. PASS.
- [ ] `npm run worker:build` gera `dist/worker.js`. Rodar `node dist/worker.js` com o banco local e o mock sobe e responde ao SIGINT.
- [ ] Commit.

### Task 7: Webhook, QR e cron antigo

**Files:**
- Modify: `src/app/api/webhooks/meta/route.ts`, `src/lib/meta/webhook.ts`, `src/app/api/jobs/outbox/route.ts`
- Create:
  - `src/lib/whatsapp-scale/webhook-processor.ts`: lógica pura sobre um client `pg`/admin, chamada pela rota e pelo reprocessamento do worker
  - `src/app/api/ingresso/[token]/qr.png/route.ts`
- Test: `tests/integration/webhook.test.ts`, `tests/unit/meta-whatsapp.test.ts`

**Interfaces:**
- Produces:
  - `processWebhookEvent(db, eventId: string): Promise<void>`.
  - `mapMetaStatusV2(s): "enviada" | "entregue" | "lida" | "falhou" | null`.
  - `OPTOUT_KEYWORDS = ["sair", "parar", "stop", "cancelar mensagens"]`, comparadas sem acento e sem caixa, com a mensagem inteira.
  - A rota do QR devolve o PNG só para um token com assinatura válida (mesma verificação de `/ingresso/[token]`), com `Cache-Control: public, max-age=86400, immutable`; 404 caso contrário.
- [ ] Testes:
  - Assinatura inválida → 401 e nada gravado. Corpo > 1 MB → 413.
  - Evento válido → linha em `whatsapp_webhook_events` gravada antes do processamento.
  - `delivered` antes de `sent` → fica `entregue`.
  - O mesmo POST duas vezes → um estado só, timestamps inalterados.
  - `sent` com `biz_opaque_callback_data` antes do wamid gravado → casa e adota o wamid; o resultado tardio do worker mantém o status.
  - `failed` com 131050 → opt-out e as pendentes daquele número viram `bloqueada`.
  - Mensagem recebida com "PARAR" → opt-out.
  - `phone_number_quality_update` RED → pausa.
  - Mensagem antiga só existente em `whatsapp_messages` → continua sendo atualizada.
  - O cron `/api/jobs/outbox` com empresa Meta devolve jobs `whatsapp.*` via `release_outbox_job`.
- [ ] Rodar → FAIL. Implementar. PASS. Commit.

### Task 8: Consentimento no formulário de inscrição

**Files:**
- Modify:
  - `shared/schemas/registration.ts` (`accept_whatsapp: boolean`, opcional, padrão false)
  - `src/features/registrations/components/registration-form.tsx`
  - `src/features/registrations/actions/registration.actions.ts` (consentimento `{type: "whatsapp", version: WHATSAPP_CONSENT_VERSION, accepted, subject: telefone}`)
  - a RPC `create_registration`, que grava `subject` (`CREATE OR REPLACE` na migration da Tarefa 4 ou em uma nova `…094400`, com reversão)
- Create: `shared/whatsapp/consent.ts` (`WHATSAPP_CONSENT_VERSION`, `WHATSAPP_CONSENT_TEXT`)
- Test: `tests/unit/validation.test.ts` (schema), `tests/integration/enqueue.test.ts` (inscrição pela RPC com e sem `whatsapp`)

**Interfaces:**
- A caixa só aparece quando a página pública recebe `whatsappEnabled` (provedor Meta configurado). O valor é lido no server component da página do evento, pelo admin client e só como booleano.
- [ ] Testes. FAIL. Implementar. PASS.
- [ ] Verificar no navegador em localhost (Playwright) com o banco **local**: a caixa aparece desmarcada e a inscrição funciona marcada e desmarcada.
- [ ] Commit.

### Task 9: Painel "Fila do WhatsApp" e capacidade

**Files:**
- Create:
  - `src/features/envios/components/whatsapp-queue-panel.tsx` (cartões, filtros, auto-refresh de 5 s, ações com diálogo de confirmação mostrando a contagem)
  - `src/features/envios/actions/queue.actions.ts`
  - `src/repositories/whatsapp-queue.repository.ts`
- Modify:
  - `src/app/(admin)/envios/page.tsx` (abas "Histórico" e "Fila do WhatsApp", a segunda só com Meta)
  - `src/features/whatsapp/components/pacing-form.tsx` (com Meta mostra vazão/s, teto 24 h e concorrência; com Evolution, o atual)
  - `src/repositories/index.ts`
- Test: `tests/unit/whatsapp-scale.test.ts` (formatação dos cartões e da estimativa)

**Interfaces:**
- Consumes:
  - `whatsapp_queue_stats`, `whatsapp_set_paused`, `whatsapp_cancel_pending`, `whatsapp_retry`, `whatsapp_update_capacity` (Tarefa 4)
  - `estimateDrainSeconds` e `formatDuration` (existente)
- Produces: as actions `getQueueStats(filters)`, `pauseQueue(reason)`, `resumeQueue()`, `cancelPending(filters)`, `retryFailed(filters, includeUncertain)`. Todas retornam `Result` e usam `try/catch` + `toastActionFailure` no cliente.
- [ ] Teste unitário dos formatadores. FAIL → implementar → PASS.
- [ ] Verificar em localhost contra o banco **local** semeado com cerca de 1000 notificações em status variados: os números batem com o SQL; pausar e retomar funcionam; cancelar pede confirmação com a contagem.
- [ ] `npm run typecheck && npm run lint`. Commit.

### Task 10: Operação — health, nginx, env, documentação

**Files:**
- Create: `src/app/api/health/whatsapp/route.ts`, `docs/09-whatsapp-escala.md`, `deploy/nginx/rate-limits.conf`
- Modify: `.env.example` (`META_*`, `META_GRAPH_VERSION`, `WORKER_ID`, `TEST_DATABASE_URL`), `deploy/README.md` (o worker no PM2)

**Interfaces:**
- `/api/health/whatsapp`:
  - Responde `{ok, workers, oldestQueuedSeconds, queue, paused, breakerUntil}`, sem dados pessoais.
  - Responde 503 se não houver heartbeat há 60 s e houver fila.
  - É protegido pelo header `x-job-secret`.
- O nginx usa `limit_req` em três zonas: POST de `/evento/` (10 r/s por IP, burst 20), `/api/webhooks/meta` (100 r/s) e `/api/ingresso/*/qr.png` (chave = URI, 5 r/s por token com burst 20 — a Meta busca de vários IPs, então limitar por IP derrubaria a vazão).
- A `docs/09` cobre:
  - arquitetura e diagrama de estados;
  - instalação e variáveis;
  - criação da conta e do número na Meta, o webhook e o cadastro do modelo v2;
  - o worker no PM2;
  - migrations (ordem, aplicação e reversão);
  - deploy e rollback;
  - checklist de homologação, incluindo a troca do `REVALIDATE_SECRET`;
  - os resultados de carga (Tarefa 11).
- [ ] Teste de integração da rota de health (com e sem heartbeat). FAIL → implementar → PASS. Commit.

### Task 11: Teste de carga

**Files:**
- Create: `scripts/load/whatsapp-load.mjs`, `scripts/load/README.md`

**Interfaces:**
- Uso: `node scripts/load/whatsapp-load.mjs --profile 15m|1h|3h --total 100000 --rate 80 [--meta-latency 150] [--meta-error-rate 0.01]`.
- O script:
  - recusa host não local;
  - injeta as inscrições pela RPC real `create_registration` em ritmo constante, numa piscina de conexões;
  - sobe o mock Meta e o worker (`startWorker`);
  - amostra a cada 5 s: inscrições/s, latência p50/p95/p99 da inscrição, msg/s aceitas, tamanho da fila, idade da mais antiga, RSS e CPU do worker, `count(*) from pg_stat_activity`;
  - grava `scripts/load/results/<perfil>-<data>.json` e um resumo em Markdown.
- [ ] Rodar os perfis:
  - 15 min com 100 mil (≈111 inscrições/s);
  - 1 h (≈28/s);
  - 3 h (≈9/s).
  O 1 h e o 3 h podem ser comprimidos: mesmo ritmo por janela representativa de 10 min, extrapolação declarada.
- [ ] Registrar os números em `docs/09-whatsapp-escala.md`, com a máquina e o Postgres usados, os limites observados (incluindo o teto do `FOR UPDATE` por evento) e o que **não** foi provado.
- [ ] Commit.

### Task 12: Verificação final

- [ ] `npm test`, `npm run test:int`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run worker:build`: tudo verde.
- [ ] Revisão do branch inteiro por um revisor independente.
- [ ] Lista final para o Caio:
  - arquivos criados e alterados;
  - decisões;
  - comandos e variáveis;
  - testes e carga;
  - pendências manuais na Meta;
  - pedido explícito de autorização para aplicar as migrations em produção e fazer o deploy.

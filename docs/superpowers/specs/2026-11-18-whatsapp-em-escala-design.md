# WhatsApp em escala (API oficial da Meta) — design

Data: 18/11/2026 · Status: aprovado ("siga")

## Intenção

Toda inscrição confirmada deve gerar a confirmação do ingresso pelo WhatsApp
oficial da empresa (WhatsApp Business Platform, Cloud API da Meta), com **um
único número para todos os eventos**. Um evento pode receber **100 mil
inscrições em poucas horas** (cenários de referência: 15 min, 1 h, 3 h). A
inscrição nunca espera o WhatsApp. A notificação fica persistida, sai na
velocidade que a Meta permite para o número, sem duplicar, se recupera de
falhas e é acompanhada e controlada por um painel.

A entrega efetiva depende dos limites e da qualidade da conta na Meta. O
sistema respeita esses limites; não os contorna.

## O que já existe e é preservado

- `create_registration` (RPC) cria participante, inscrição, ingresso e
  consentimentos numa transação, com `FOR UPDATE` no evento.
- Gatilhos enfileiram e-mail e WhatsApp em `outbox_jobs` **na mesma
  transação** da inscrição, com `dedupe_key`: `tg_ticket_confirmation` (após
  insert em `tickets`, função `private.enqueue_confirmation_messages`) e
  `tg_registration_cancellation` (`private.enqueue_cancellation_messages`).
  A segunda via enfileira dentro de `request_ticket_code` com
  `run_at = now() + 1s`. Ou seja: outbox transacional já existe.
- Provedor Meta já integrado (`src/lib/meta/*`): envio por modelo, webhook com
  `X-Hub-Signature-256`, verificação GET, status fora de ordem.
- Provedor Evolution (não oficial) também existe e hoje é o configurado
  (desconectado). **Fica no código, intocado no comportamento**; a operação em
  escala é só para o provedor Meta. Remover a Evolution é decisão à parte.
- E-mail continua em `outbox_jobs` + cron `/api/jobs/outbox`, sem mudança.

## Problemas encontrados que impedem a escala

1. Ritmo: intervalo mínimo 5 s, padrão 20 s, teto 300/dia → 100 mil levaria
   meses.
2. Worker é um cron HTTP por minuto, lote de 20, envio sequencial.
3. `private.next_whatsapp_slot` roda **dentro da transação da inscrição** e faz
   `count(*)` sobre a fila e o log — custo cresce com a fila; sem trava, duas
   inscrições simultâneas pegam o mesmo slot.
4. QR enviado antes como mídia: 2 chamadas à Meta por mensagem.
5. Servidor (DigitalOcean, não Cloudways): 1 vCPU, 2 GB RAM, sem Redis.
6. Cron de produção chama o worker com `dev-revalidate-secret`.
7. Não há consentimento específico para WhatsApp nem lista de opt-out.
8. Fora do WhatsApp, mas medido no teste de carga: o `FOR UPDATE` no evento
   serializa todas as inscrições de um evento. É ele que define o teto de
   inscrições por segundo. Não será alterado neste trabalho (não é
   relacionado); o teste de carga mede e o relatório diz o número.

## Objetivos

- Inscrição não espera nem depende do WhatsApp (nem do worker, nem da Meta).
- Notificação persistida na mesma transação da inscrição.
- Worker Node independente do Next.js, contínuo, sob PM2.
- Limite de velocidade **global por número**, compartilhado entre workers.
- Idempotência: no máximo uma confirmação por inscrição.
- Retries com backoff exponencial + jitter; erro incerto não é repetido sem
  reconciliação.
- Teto diário de destinatários únicos (nível da conta) respeitado.
- Pausa manual, pausa de emergência automática (circuit breaker).
- Painel com métricas, filtros e ações em massa com confirmação.
- Consentimento explícito para WhatsApp; opt-out e número inválido tratados.
- Testes unitários, de integração e de carga (100 mil sintéticos, Meta
  simulada), com resultados documentados.

## Fora do escopo

- Mexer no `FOR UPDATE` da inscrição (item 8): só medir e relatar.
- Mensagens de marketing/divulgação. Só transacional (Utility e a
  Authentication já existente da segunda via).
- Conversa (responder mensagens recebidas), exceto reconhecer pedido de saída.
- Remover a Evolution.

## Anti-objetivos

- Rotação de números ou contas para fugir de limite.
- Enviar para quem não consentiu, mesmo que o telefone exista.
- Reenviar automaticamente quando não se sabe se a Meta recebeu.
- Credencial, token ou telefone completo em log ou no navegador.
- Rodar teste, migration ou carga contra o banco de produção sem autorização.

## Abordagens

- **A — Redis + BullMQ:** dispatcher lê o Postgres e publica no Redis; workers
  BullMQ com limitador global. Duas fontes de verdade (reconciliação constante
  entre elas), mais dois processos num servidor de 1 vCPU/2 GB.
- **B — Worker dedicado sobre fila no Postgres (escolhida):** o Postgres é a
  única fonte de verdade; o worker reivindica lotes com `FOR UPDATE SKIP
  LOCKED`; o limitador global é uma linha no Postgres (token bucket). A 80
  msg/s (vazão padrão da Meta por número), 100 mil saem em ~21 min — volume
  de escrita trivial para o Postgres. Sem Redis para operar.
- **C — Manter o cron e só aumentar lote/ritmo:** não chega lá (rodada de
  60 s dentro do Next, sem concorrência, sem breaker).

O Caio escolheu B ("faça da forma que você acha melhor"). Se um dia a vazão
passar de ~1000 msg/s, o BullMQ pode entrar como camada de despacho sem mudar
o modelo de dados.

## Design

### Dados (migrations novas, cada uma com arquivo de reversão)

Reversão em `supabase/rollbacks/<mesmo nome>.down.sql`. Nenhuma migration
apaga dados existentes.

**`whatsapp_notifications`** — é ao mesmo tempo o registro e a fila (outbox)
do WhatsApp. Uma tabela para não ter duas fontes de verdade. Colunas:
`id`, `tenant_id`, `event_id`, `registration_id`, `kind`
(`registration_confirmed` | `registration_cancelled` | `ticket_code`),
`phone_e164` (`+55…`), `template_id` + `template_name` + `template_version` +
`language`, `consent_id`, `status`, `attempts`, `max_attempts` (5),
`next_attempt_at`, `locked_at`/`locked_by`/`request_started_at`,
`meta_message_id` (wamid), `last_error_code`, `last_error`, `params` (jsonb,
só o que o modelo precisa), `queued_at`, `accepted_at`, `sent_at`,
`delivered_at`, `read_at`, `failed_at`, `cancelled_at`, `created_at`,
`updated_at`, `dedupe_key` único.

Status (enum novo `whatsapp_notification_status`):
`pendente → processando → aceita → enviada → entregue → lida`, e os finais
`falhou`, `cancelada`, `incerta` (a Meta pode ou não ter recebido; ver
reconciliação), `bloqueada` (sem consentimento / opt-out / número inválido).
"Em fila" no painel = `pendente` com `next_attempt_at <= now()`; "agendada"
= `pendente` com `next_attempt_at` no futuro (retry).

Índices: `(status, next_attempt_at)` parcial em `pendente` (claim);
`(tenant_id, event_id, status)`; `(meta_message_id)` único parcial;
`(tenant_id, phone_e164, accepted_at)` (destinatários únicos em 24 h);
`dedupe_key` único.

**`whatsapp_templates`** — versões de modelo: `key` (o `kind`), `name` na
Meta, `language`, `version`, `category`, `header_type` (`none`|`image`),
`body_preview`, `param_order` (jsonb), `meta_status`
(`rascunho`|`em_analise`|`aprovado`|`rejeitado`|`pausado`), `active`. Uma
ativa por `(tenant, key)`. A notificação guarda a versão usada. O jsonb
`whatsapp_connections.meta_templates` vira semente da versão 1 e continua
sendo lido se a tabela estiver vazia.

**`whatsapp_webhook_events`** — corpo cru de cada POST válido da Meta,
gravado **antes** de processar: `id`, `received_at`, `phone_number_id`,
`payload`, `processed_at`, `error`. Retenção 30 dias.

**`whatsapp_optouts`** — `tenant_id`, `phone_e164` (único por tenant),
`reason` (`pedido`|`invalido`|`bloqueio`|`manual`), `source`, `created_at`.

**`whatsapp_connections`** (= "whatsapp_settings", já é uma linha por
empresa) ganha: `rate_per_second` (padrão 20, máx. 1000),
`daily_unique_limit` (padrão 1000, nível informado/lido da Meta),
`worker_concurrency` (padrão 16), `paused`, `paused_reason`, `paused_at`,
`paused_by`, `breaker_open_until`, `quality_rating`, `messaging_tier`.
Os campos de ritmo antigos (`send_interval_seconds`, `daily_send_limit`)
continuam valendo para a Evolution.

**`whatsapp_rate_buckets`** — token bucket global por número:
`phone_number_id` (PK), `tokens`, `refilled_at`. Função
`whatsapp_take_tokens(p_tenant, p_want) returns int` trava a linha, repõe por
tempo decorrido × `rate_per_second` (capacidade = 1 s de vazão) e devolve
quantos concedeu. Um worker pede um lote de tokens de cada vez → uma escrita
por lote, não por mensagem.

**`whatsapp_worker_heartbeats`** — `worker_id`, `last_seen_at`, `stats`
jsonb. Usada pelo health check e pelo painel.

RLS: leitura por `settings.read` na empresa; escrita só via RPC
`security definer` com checagem de permissão (`settings.manage`); funções do
worker só para `service_role`. Nada novo exposto a `anon`.

### Enfileiramento (mudança nos gatilhos existentes)

`private.enqueue_confirmation_messages` e
`private.enqueue_cancellation_messages` passam a, quando o provedor for Meta:
inserir em `whatsapp_notifications` (não mais em `outbox_jobs`), com
`status = pendente` se houver consentimento de WhatsApp aceito, telefone
válido e o número não estiver em opt-out; senão `bloqueada` com o motivo.
O e-mail não muda. Com provedor Evolution, o comportamento atual continua.

O gatilho `tg_outbox_schedule_whatsapp` deixa de chamar
`next_whatsapp_slot` para jobs Meta (some o custo O(fila) da transação). Para
Evolution segue como hoje.

A normalização para E.164 roda no banco (função `private.to_e164_br`, mesmas
regras de `toWhatsAppNumber`, com teste de equivalência).

A segunda via (`whatsapp.ticket_code`) também migra para a tabela nova
quando o provedor é Meta; é Authentication e não depende do consentimento do
ingresso (a pessoa pediu o código na hora).

### Consentimento (Fase 7)

- Formulário de inscrição ganha uma caixa **desmarcada por padrão**:
  "Quero receber a confirmação e o ingresso pelo WhatsApp neste número."
  Aparece só se a empresa tem WhatsApp Meta configurado.
- Grava em `consents` como `document_type = 'whatsapp'`, `document_version`
  = versão do texto (constante versionada em `shared/`), com IP, user agent e
  data, mais o telefone em `consents.subject` (coluna nova, opcional).
- Sem consentimento: notificação `bloqueada` (aparece no painel, não sai).
  O pedido original exige opt-in explícito ("nunca enviar para contatos sem
  autorização válida"), e caixa pré-marcada não vale como consentimento;
  por isso desmarcada. O consentimento é opcional para se inscrever (LGPD:
  consentimento livre); o e-mail continua indo para todos.
- Cancelamento usa o mesmo consentimento da confirmação. Segunda via não
  precisa (a pessoa pede o código na hora, pelo próprio número).
- Inscrições anteriores: hoje há 0 inscrições no banco; nada a migrar.
- Opt-out: mensagem recebida com "SAIR", "PARAR", "STOP" (webhook) → entra em
  `whatsapp_optouts`; pendentes desse número viram `bloqueada`. Erros da Meta
  de número inexistente (131026) → opt-out `invalido`; bloqueio pelo usuário
  (131049/131050, conforme a Meta) → `bloqueio`. Admin pode incluir/remover.

### Worker (Fases 3 e 4)

Processo Node separado: `worker/whatsapp/` (TypeScript), empacotado com
`esbuild` em `dist/worker.js` e rodado pelo PM2 como segundo app
(`ingressos-whatsapp`, modo fork, 1 instância — o servidor tem 1 vCPU; a
concorrência é de requisições em voo, não de processos). Não importa nada do
Next.

Conexão com o banco: driver `pg` direto, pela `DATABASE_URL` que já existe
(pooler do Supabase em **modo sessão**, porta 5432 — suporta `SKIP LOCKED` e
`pg_try_advisory_lock`). Pool de no máximo 4 conexões. O banco de produção
tem `max_connections = 60`, dividido com o Next (PM2 cluster) e o PostgREST;
o teste de carga mede o pico de conexões. Postgres indisponível: o worker
loga, espera com backoff e reconecta; não morre.

Laço principal (por empresa com Meta ativa):
1. Lê configuração (cache de 5 s). Pausado ou breaker aberto → dorme.
2. `whatsapp_take_tokens(tenant, min(concurrency_livre, 50))` → N.
3. Respeita o teto diário: conta destinatários únicos com `accepted_at` nas
   últimas 24 h (índice dedicado); se esgotado, dorme até a vaga mais antiga
   sair da janela e marca `paused_reason = 'teto_diario'` no painel.
4. `claim_whatsapp_notifications(N, worker_id)`: `SKIP LOCKED`, `pendente` e
   vencidas, ordem `next_attempt_at`, marca `processando` + `locked_at`.
5. Para cada uma (até `worker_concurrency` em voo): grava
   `request_started_at`, chama a Meta, grava o resultado.
6. Heartbeat a cada 10 s.

Os parâmetros do modelo são montados **na hora do envio** a partir de
`registration_id` (nome, evento, data, local e o token do ingresso válido
naquele momento), não congelados na fila. Assim, editar o evento ou
cancelar o ingresso antes do envio já reflete; ingresso cancelado vira
`cancelada`. (Não existe reemissão de ingresso no sistema hoje.) O job não
carrega dados pessoais além dos ids.

Envio: `POST /{phone_number_id}/messages` com o modelo ativo, `to` em E.164,
**`biz_opaque_callback_data` = id da notificação** (a Meta devolve no
webhook de status — é a chave da reconciliação), timeout 15 s.

Classificação do resultado:
- 200 com `messages[0].id` → `aceita`, grava wamid. **Não é entrega.**
- Recusa definitiva (4xx com código de destinatário: 131026, 131049…,
  parâmetro 131008/132000) → `falhou` sem retry (destinatário vira opt-out
  quando aplicável).
- Erro sistêmico (190 token, 10 permissão, 132001 modelo inexistente, 368
  conta bloqueada, 131031 conta restrita) → `pendente` de volta **sem gastar
  tentativa** e **abre o breaker** (pausa automática com motivo).
- 429 / 130429 / 131056 / 80007 → `pendente` com backoff, e o worker reduz
  a própria vazão (multiplica a taxa efetiva por 0,5 por 60 s).
- 5xx com resposta → retry com backoff.
- Falha **antes** de a requisição sair (DNS, conexão recusada) → retry
  seguro.
- Timeout ou conexão cortada **depois** de enviada → `incerta`. Não reenvia.

Backoff: `min(base × 2^tentativa, 15 min) × jitter(0,5–1,5)`, base 30 s,
5 tentativas.

Reconciliação (a cada 30 s, no próprio worker, com trava consultiva
`pg_try_advisory_lock` para só um rodar):
- `processando` sem `request_started_at` há > 2 min (worker morreu antes de
  enviar) → `pendente`.
- `processando` com `request_started_at` há > 2 min (morreu no meio) →
  `incerta`.
- `incerta`: se chegou webhook com `biz_opaque_callback_data` = id, adota o
  wamid e o status. Sem webhook em 30 min → continua `incerta`; o painel
  mostra e o admin decide reenviar (com aviso de possível duplicidade).

Circuit breaker: janela deslizante de 60 s no worker; > 20% de erro
(excluindo erros de destinatário) com ao menos 50 envios → abre por 5 min
(gravado em `breaker_open_until`, vale para todos os workers); erro
sistêmico abre imediatamente e exige retomada manual. Webhook de qualidade
(`phone_number_quality_update` com queda para RED/FLAGGED, `account_update`
com restrição) → pausa com motivo.

Desligamento: SIGTERM/SIGINT → para de reivindicar, espera as requisições em
voo (até 20 s), devolve as não iniciadas para `pendente`, sai.

### Meta e modelo (Fases 5 e 6)

- Graph API versionada por `META_GRAPH_VERSION` (padrão `v23.0`).
- Credenciais por variável de ambiente (`META_ACCESS_TOKEN`,
  `META_APP_SECRET`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`,
  `META_VERIFY_TOKEN`), que **têm precedência** sobre o que está salvo na tela
  de Configurações. Sem as variáveis, vale o salvo (comportamento atual).
- Modelo novo `confirmacao_inscricao` v2, categoria Utility, pt_BR:
  - Cabeçalho: imagem do QR **por link** (`image.link`) apontando para
    `/api/ingresso/{token}/qr.png` (rota nova, pública, só aceita token com
    assinatura válida, `Cache-Control` longo). Uma chamada à Meta por
    mensagem, em vez de duas.
  - Corpo: nome, evento, data, horário, local.
  - Botão de URL dinâmico "Ver ingresso" → `/ingresso/{token}` (alternativa
    ao QR).
  - Sem nenhum texto promocional.
- A tela de Configurações mostra o texto para cadastrar na Meta (já existe
  um guia; atualizado para a v2) e a situação de aprovação lida da API
  (`GET /{waba_id}/message_templates`). A aprovação como Utility não é
  garantida; enquanto a v2 não estiver aprovada, o sistema usa a versão
  ativa anterior ou bloqueia o envio com motivo claro.

### Convivência com o caminho atual

- Provedor Meta: notificações nascem só em `whatsapp_notifications`; o cron
  `/api/jobs/outbox` passa a ignorar jobs `whatsapp.*` quando a empresa usa
  Meta (devolve sem gastar tentativa), evitando envio duplo. Hoje a fila
  `outbox_jobs` está vazia, então não há o que migrar no deploy.
- `v_message_log` (aba Envios atual) ganha a tabela nova no `union`, para
  as mensagens Meta continuarem aparecendo lá; o reenvio dessa lista chama a
  RPC nova para linhas da tabela nova.
- O webhook atualiza a tabela nova (por wamid ou `biz_opaque_callback_data`)
  e, para mensagens antigas, continua atualizando `whatsapp_messages`.
- Provedor Evolution: nada muda.

### Webhook (Fase 8)

Rota existente `/api/webhooks/meta`, passa a:
1. Validar assinatura (já faz) e o tamanho do corpo (≤ 1 MB).
2. Gravar o corpo em `whatsapp_webhook_events`.
3. Processar: status por wamid **ou** por `biz_opaque_callback_data`;
   só avança (`aceita < enviada < entregue < lida`; `falhou` vale até
   `lida`); grava o timestamp de cada etapa a partir do `timestamp` da Meta;
   mensagens recebidas com palavra de saída → opt-out; atualizações de
   qualidade/conta → pausa.
4. Responder 200 rápido. Evento duplicado é idempotente porque a transição
   só avança.
5. Evento com falha de processamento fica com `error` e é reprocessado pelo
   worker.

### Painel (Fase 9)

Nova aba "Fila do WhatsApp" em `/envios` (reaproveita layout e permissões).
- Filtros: evento, período, status.
- Cartões: inscrições, pendentes, em fila, processando, aceitas, enviadas,
  entregues, lidas, falhas, incertas, bloqueadas; % de entrega, % de falha,
  velocidade (msg/s no último minuto), idade da mais antiga em fila, tamanho
  da fila, estimativa de esvaziamento (fila ÷ taxa observada dos últimos
  5 min, limitada pelo teto diário restante), teto diário usado/total,
  situação dos workers (heartbeat), qualidade do número.
- Atualiza a cada 5 s.
- Ações: pausar, retomar (também fecha o breaker), cancelar pendentes do
  filtro, reenviar falhas elegíveis do filtro, reenviar incertas (com aviso de
  duplicidade). Todas com diálogo de confirmação mostrando a contagem, via
  RPC com permissão `settings.manage`, registradas em auditoria.
- Agregação por função SQL `whatsapp_queue_stats(filtros)`, com índices;
  medida no teste de carga com 100 mil linhas.

### Proteção, configuração e operação (Fases 10 e 11)

- Teto diário e vazão configuráveis na tela, com o nível lido da Meta
  (`GET /{phone_number_id}?fields=throughput,messaging_limit_tier` ou o
  equivalente vigente) quando disponível. Padrões conservadores (20 msg/s,
  1000 destinatários/24 h) até o admin confirmar o nível real.
- Pausa de emergência (botão) e breaker automático.
- `.env.example` com todas as variáveis, sem valores.
- `docs/09-whatsapp-escala.md`: instalação, credenciais Meta, webhook,
  worker no PM2, migrations, deploy, rollback, checklist de homologação.
- Health checks: `GET /api/health` (app) e `GET /api/health/whatsapp`
  (heartbeat do worker, idade da fila, breaker) — sem dados pessoais.
- Logs estruturados em JSON no worker; telefone mascarado
  (`+55 11 9****-1234`), nunca token; corpo da Meta só com códigos.
- Rate limit nas rotas públicas: `limit_req` do nginx para o POST de
  inscrição, o webhook e a rota do QR (arquivo em `deploy/nginx`).
- Item de checklist (não executado sem autorização): trocar o
  `REVALIDATE_SECRET` de produção, hoje com o valor de desenvolvimento.

### Testes (Fase 12)

- **Ambiente:** Supabase local (Docker). Nada de teste contra o banco de
  produção. Docker Desktop precisa estar ligado.
- Unitários (Vitest): E.164, classificação de erros, backoff/jitter,
  breaker, transição de status, montagem do modelo, assinatura do webhook,
  estimativa de esvaziamento.
- Integração (Vitest + Postgres local + servidor Meta simulado): outbox na
  mesma transação, idempotência (inscrição/gatilho repetido, webhook
  duplicado, fora de ordem), token bucket com dois workers, claim
  concorrente sem duplicar, reinício do worker no meio (pendente vs
  incerta), Meta 429/5xx/timeout, erro sistêmico abre breaker, opt-out,
  consentimento ausente, Postgres indisponível (worker não morre, reconecta).
- Carga (`scripts/load/`): gera 100 mil inscrições sintéticas pelo
  `create_registration` real em três perfis (15 min, 1 h, 3 h) contra o
  Postgres local, com o worker apontado para um servidor Meta simulado
  (latência e erros configuráveis). Mede: inscrições/s e latência p50/p95/p99
  da inscrição, msg/s, idade da fila, memória e CPU do worker, conexões no
  Postgres. Resultados em `docs/09-whatsapp-escala.md`. Capacidade só é
  declarada com o teste rodado; a máquina de teste é a local, e o relatório
  diz isso.

## Decisões que tomei (para conferir)

1. Tabela única `whatsapp_notifications` como registro + fila, no lugar de
   `whatsapp_notifications` + `whatsapp_outbox` separadas.
2. Evolution fica como está; escala só no provedor Meta.
3. Consentimento desmarcado por padrão; sem ele a mensagem não sai.
4. QR por link no cabeçalho do modelo (uma chamada por mensagem).
5. Variáveis de ambiente têm precedência sobre a credencial salva na tela.
6. Padrões conservadores: 20 msg/s, 1000 destinatários/24 h.
7. O lock da inscrição por evento não é alterado, só medido.
8. Migrations entram no banco de produção só com sua autorização explícita,
   depois de validadas no Supabase local.

## Conta da Meta

Situação real da conta não informada. Tudo é construído e testado contra uma
Meta simulada; a troca de Evolution para Meta em produção, o cadastro do
modelo e a confirmação do nível de limite ficam no checklist de
homologação, para quando o Caio quiser.

## O que fica para quem implementa

Nomes internos de funções TS, estrutura de pastas do worker, formato exato
do log JSON, layout fino do painel (seguindo os componentes existentes).

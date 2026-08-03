# 02 — Arquitetura

## 1. Visão macro

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENTES                                     │
│  Navegador (landing pública)   │  Painel admin  │  PWA de check-in (offline) │
└───────────────┬────────────────┴────────┬───────┴─────────────┬──────────────┘
                │ HTTPS                   │                     │
┌───────────────▼─────────────────────────▼─────────────────────▼──────────────┐
│                    CLOUDWAYS — Nginx (SSL, Brotli, cache)                     │
│                    Next.js 15 standalone (Node 20) via PM2                    │
│                                                                              │
│  ┌────────────────┐ ┌──────────────────┐ ┌────────────┐ ┌─────────────────┐   │
│  │ Server         │ │ Server Actions / │ │ Route      │ │ Middleware      │   │
│  │ Components     │ │ Mutations        │ │ Handlers   │ │ (auth, tenant,  │   │
│  │ (RSC + ISR)    │ │                  │ │ (API v1,   │ │  rate limit,    │   │
│  │                │ │                  │ │  PDF, ICS) │ │  headers)       │   │
│  └────────┬───────┘ └────────┬─────────┘ └─────┬──────┘ └────────┬────────┘   │
└───────────┼──────────────────┼─────────────────┼─────────────────┼────────────┘
            │ supabase-js (JWT do usuário, RLS aplicada)           │
┌───────────▼──────────────────▼─────────────────▼─────────────────▼────────────┐
│                               SUPABASE                                        │
│                                                                               │
│  PostgREST ──► PostgreSQL 15                                                  │
│                 ├─ schema public   (tabelas de negócio, RLS)                  │
│                 ├─ schema private  (helpers SECURITY DEFINER, sem exposição)  │
│                 ├─ schema audit    (trilha append-only, particionada)         │
│                 ├─ RPCs transacionais: register / cancel / checkin / promote  │
│                 ├─ triggers: contadores, auditoria, outbox, broadcast         │
│                 └─ extensions: pgcrypto, postgis, pg_cron, pg_net, pgmq       │
│                                                                               │
│  Auth (JWT + custom access token hook) · Storage (buckets c/ RLS)             │
│  Realtime (broadcast privado por tenant/evento)                               │
│  Edge Functions (Deno): e-mail, webhooks, promoção de lista de espera,        │
│                          geocoding reverso, relatórios pesados                │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
              Resend (e-mail) · Nominatim/Geoapify (reverse geocode) · Webhooks do cliente
```

---

## 2. Princípio central: o banco é a fronteira de confiança

O Next.js **nunca** é a única barreira de segurança. Toda leitura passa por RLS e toda escrita
crítica passa por uma função transacional no Postgres.

| Tipo de operação                                               | Caminho                                                    | Motivo                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Leitura de dados do tenant                                     | Client Supabase com JWT do usuário → PostgREST → RLS       | Isolamento garantido pelo banco                                          |
| Escrita simples (editar evento, comentar chamado)              | Server Action → PostgREST → RLS                            | Simples, tipado, auditado por trigger                                    |
| Escrita crítica (inscrever, cancelar, check-in, promover fila) | Server Action / Route Handler → **RPC `SECURITY DEFINER`** | Atomicidade, lock, constraints e efeitos colaterais numa única transação |
| Efeito colateral externo (e-mail, webhook, PDF)                | Outbox no banco → Edge Function/worker                     | Nunca perder efeito por falha de rede no meio da transação               |

**Nunca** usamos a `service_role key` no navegador nem em componentes de cliente. Ela existe apenas
dentro de Edge Functions e de rotinas administrativas do servidor.

---

## 3. Camadas do frontend

```
app/ (rotas, RSC)  →  features/*  →  services/*  →  repositories/*  →  supabase client
     UI                casos de uso     regras de app     acesso a dados
```

| Camada               | Responsabilidade                                                        | Regra                                                   |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `app/**`             | Roteamento, layout, streaming, metadata                                 | Sem lógica de negócio; só orquestra                     |
| `components/ui`      | Primitivos do Design System (shadcn)                                    | **Nunca** conhece domínio                               |
| `components/shared`  | Composições reutilizáveis (DataTable, PageHeader, EmptyState, StatCard) | Genéricas, sem regra de negócio                         |
| `features/<dominio>` | Componentes, hooks, schemas e ações de um domínio                       | Domínio não importa domínio: comunicação via `services` |
| `services/`          | Casos de uso, orquestração, validação, mapeamento                       | Isolado de React; testável puro                         |
| `repositories/`      | Única camada que fala com Supabase                                      | Trocar o provedor de dados afeta só aqui                |
| `lib/`               | Infra transversal: clients, tipos gerados, utils, erros                 | Sem dependência de features                             |

**Regra de dependência:** as setas apontam sempre para dentro. `repositories` não importa `features`.
Isso é o que mantém o Clean Architecture aplicável sem cerimônia excessiva.

### Server vs Client Components

| Cenário                  | Escolha                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| Página pública do evento | RSC + ISR (`revalidate: 300`) + `revalidateTag` no update                    |
| Contador de vagas        | Client Component com React Query + Realtime (dado volátil fora do cache ISR) |
| Listagens do painel      | RSC para o primeiro paint + React Query para filtros/paginação (hidratação)  |
| Formulários              | Client (RHF + Zod) → Server Action                                           |
| Scanner de check-in      | Client, 100% offline-capable                                                 |

---

## 4. Controle de vagas — a decisão mais importante

Contador materializado na tabela `events` (`seats_taken`, `seats_waitlist`, `checked_in_count`),
mantido por trigger, com **constraint de banco** como rede final:

```sql
ALTER TABLE events ADD CONSTRAINT chk_capacity
  CHECK (seats_taken <= floor(capacity * (1 + overbooking_pct/100.0)));
```

Fluxo de inscrição (`private.fn_create_registration`, `SECURITY DEFINER`, uma transação):

```
1. SELECT ... FROM events WHERE id = ? FOR UPDATE        -- serializa concorrência no evento
2. valida: status, janela de inscrição, inscrições abertas
3. UPSERT attendee (dedupe por tenant + CPF)
4. INSERT registration                                    -- trigger incrementa seats_taken
   └─ se a constraint estourar → captura e desvia para lista de espera
5. INSERT ticket (código + payload assinado)
6. INSERT consents (LGPD, versionados)
7. INSERT outbox: e-mail de confirmação, PDF, notificação, webhook
8. RETURN { registration_id, ticket_code, position_waitlist }
```

Por que **não** contar com `COUNT(*)` a cada inscrição: sob 500 req/s o `COUNT` vira scan e a
verificação "tem vaga?" fora de transação sofre race condition clássica (dois pedidos leem 99/100 e
ambos inserem). O `FOR UPDATE` + contador + `CHECK` elimina o problema por construção.

---

## 5. QR Code assinado — e por que assimétrico

**Payload do token** (base64url, compacto, ~180 caracteres):

```
v1.<key_id>.<payload_b64>.<sig_b64>
payload = { t: ticket_id, e: event_id, n: nonce, x: exp }
sig     = Ed25519(payload, chave_privada_do_tenant)
```

| Requisito                  | Consequência                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Validar **offline** no PWA | A chave de verificação precisa ser distribuível ⇒ **assimétrica** (Ed25519), não HMAC                                                |
| Nunca reutilizar           | `nonce` aleatório de 128 bits + unicidade em `tickets.code`                                                                          |
| Revogar                    | Assinatura prova autenticidade; o **status** (cancelado/usado) vem do banco quando online e da lista revogada baixada quando offline |
| Rotacionar chaves          | `key_id` no token; chaves privadas no Supabase Vault, públicas expostas por endpoint                                                 |

A chave privada nunca sai da Edge Function/Vault. O PWA baixa apenas a **chave pública** e a lista de
ingressos revogados do evento antes de entrar em modo offline.

---

## 6. Check-in offline-first

```
ONLINE                                    OFFLINE
scan → RPC fn_checkin (transação)         scan → verifica assinatura Ed25519 local
     → resposta em <500ms                      → consulta cache local (IndexedDB)
                                               → grava check-in local + idempotency_key
                                               → fila de sincronização

SYNC (ao voltar a rede / Background Sync)
  POST /api/v1/checkins/batch  { items: [...], idempotency_key }
  → RPC fn_checkin_batch: aplica na ordem de timestamp do dispositivo
  → conflitos (mesmo ticket, dois dispositivos) → primeiro vence, segundo vira alerta auditado
```

Cache offline por evento (IndexedDB): `event`, `public_key`, `tickets` (id, código hash, nome, CPF
mascarado, tipo, status), `revoked`, `queue`. O download é explícito ("Preparar modo offline") para
o operador saber o que tem em mãos.

---

## 7. Efeitos colaterais: padrão Outbox

Nenhuma transação de negócio chama serviço externo diretamente.

```
transação de negócio ──INSERT──► outbox_jobs (tipo, payload, run_at, attempts)
                                        │
                    pg_cron (a cada 10s) │ pg_net / Edge Function worker
                                        ▼
                     e-mail (Resend) · webhook do cliente · PDF · geocoding
                                        │
                                        ▼
                              job_results (sucesso/erro, retry exponencial, DLQ)
```

Ganhos: e-mail nunca "some" porque a API caiu no meio; retry é automático; o e-mail não segura a
transação; e a fila é observável em tela.

---

## 8. Realtime

Usamos **broadcast privado** (`realtime.broadcast_changes()` disparado por trigger), não
`postgres_changes` genérico.

| Motivo     | Detalhe                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| Escala     | `postgres_changes` avalia RLS por conexão a cada mudança; broadcast não       |
| Isolamento | Canal `tenant:{id}:event:{id}` com autorização via RLS em `realtime.messages` |
| Custo      | Só publicamos os eventos que a UI realmente consome                           |

Consumidores: contador de vagas na landing, dashboard no dia do evento, tela de check-ins, sino de
notificações.

---

## 9. Geolocalização

PostGIS habilitado. `events.location geography(Point,4326)` e `checkins.location geography(Point,4326)`.

```sql
ST_DWithin(e.location, c.location, e.allowed_radius_m)  -- true = dentro do raio
```

O cálculo acontece **no banco**, dentro da RPC de check-in, com o resultado gravado em
`checkins.within_geofence` e `checkins.distance_m`. Cidade/estado/país vêm de geocoding reverso
assíncrono (job no outbox), para não bloquear o check-in.

---

## 10. Multi-tenant: como a RLS sabe o tenant

**Custom Access Token Hook** do Supabase Auth injeta no JWT:

```json
{
  "app_metadata": {
    "tenant_ids": ["..."],
    "active_tenant": "...",
    "perms": ["event.create", "..."]
  }
}
```

Helpers `STABLE SECURITY DEFINER` em `private`:

```sql
private.current_tenant()   -- uuid do tenant ativo
private.tenant_ids()       -- uuid[] de todos os tenants do usuário
private.has_perm(text)     -- checagem de permissão RBAC
private.event_in_scope(uuid) -- respeita user_event_scopes (recepção)
```

Política padrão de toda tabela:

```sql
CREATE POLICY tenant_isolation ON <tabela>
  USING (tenant_id = (SELECT private.current_tenant()));
```

O `(SELECT ...)` não é estilo: força o Postgres a avaliar a função **uma vez** por query (InitPlan)
em vez de uma vez por linha — diferença de ordem de grandeza em tabelas grandes.

---

## 11. Tipos e contratos compartilhados

```
supabase gen types typescript  →  src/lib/supabase/database.types.ts   (fonte da verdade do schema)
shared/schemas/*.ts (Zod)      →  importado pelo Next.js E pelas Edge Functions (Deno lê TS nativo)
```

Um único schema Zod valida: formulário no cliente, Server Action no servidor e Edge Function.
Divergência de validação entre camadas deixa de ser possível.

---

## 12. Tratamento de erros

`AppError` tipado com `code`, `message` (pt-BR, seguro para o usuário), `details` e `httpStatus`.
Erros do Postgres são traduzidos por código:

| Código PG                              | Significado no domínio            | Mensagem ao usuário                                        |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `23505` em `uq_registration_cpf_event` | CPF já inscrito                   | "Este CPF já possui inscrição neste evento."               |
| `23514` em `chk_capacity`              | Evento lotou durante a requisição | "As vagas se esgotaram. Deseja entrar na lista de espera?" |
| `P0001` (raise custom)                 | Regra de negócio                  | Mensagem da própria regra                                  |

Nada de vazar mensagem crua do banco para a interface.

---

## 13. Performance

| Técnica                                 | Onde                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| ISR + `revalidateTag`                   | Landing pages (invalidação no update do evento)           |
| Streaming + Suspense                    | Painel: KPIs, gráficos e tabelas carregam independentes   |
| Paginação por cursor                    | Todas as listas grandes (keyset, não OFFSET)              |
| Índices compostos alinhados aos filtros | `(tenant_id, event_id, status, created_at DESC)`          |
| Views materializadas                    | KPIs do dashboard, refresh incremental por `pg_cron`      |
| `next/image` + AVIF/WebP                | Banners e galeria (com Storage transform)                 |
| Code splitting por rota e `dynamic()`   | Scanner, Recharts e editor rich text carregam sob demanda |
| Skeletons do Design System              | `.shimmer` já previsto no DS                              |
| Prefetch de rotas do painel             | `<Link prefetch>` nas navegações mais frequentes          |

---

## 14. Observabilidade

`request_id` (UUID) gerado no middleware, propagado em header, logs estruturados JSON, gravado em
auditoria e devolvido em erros — o suporte pede o ID e rastreia a requisição inteira. Métricas de
fila (pendentes, falhas, idade do job mais antigo) expostas em tela administrativa.

# 09 — Decisões Arquiteturais (ADRs)

Formato: **contexto → decisão → alternativas descartadas → consequências.**

---

## ADR-001 — Regras críticas no banco, não na aplicação

**Contexto.** Controle de vagas, unicidade de inscrição e unicidade de check-in são as regras que,
se falharem, destroem a credibilidade do produto. Podem ser chamadas por vários caminhos: landing,
painel, API, importação, sincronização offline.

**Decisão.** Implementar em funções `SECURITY DEFINER` no Postgres, com lock de linha, constraints
e índices únicos parciais. A aplicação chama RPC; não reimplementa a regra.

**Descartado.** (a) Validar no Server Action — race condition entre `SELECT` e `INSERT` e regra
duplicada em cada caller. (b) Fila serializada por evento — adiciona latência e um ponto de falha
para resolver o que o Postgres já resolve com `FOR UPDATE`.

**Consequências.** Correção garantida sob concorrência; parte da lógica em SQL exige disciplina de
migrations e testes pgTAP. Aceito conscientemente: é onde a regra pertence.

---

## ADR-002 — Ed25519 (assimétrico) no QR Code, não HMAC

**Contexto.** O check-in precisa funcionar sem internet. Validar offline exige que o dispositivo
tenha material criptográfico.

**Decisão.** Assinar os tokens com Ed25519; o PWA recebe apenas a chave **pública**.

**Descartado.** (a) HMAC-SHA256 — exigiria distribuir o segredo aos dispositivos; um aparelho
comprometido permitiria forjar ingressos. (b) UUID opaco sem assinatura — inválido offline, pois
qualquer string precisaria ser aceita até sincronizar.

**Consequências.** Token ~40% maior (ainda cabe folgado num QR nível M); ganho de segurança e
capacidade offline. Rotação de chave suportada por `key_id`.

---

## ADR-003 — Padrão Outbox para todo efeito colateral externo

**Contexto.** Inscrição dispara e-mail, PDF, webhook e notificação. Chamar essas APIs dentro da
transação a torna lenta e frágil; chamar depois arrisca perder o efeito.

**Decisão.** Gravar jobs em `outbox_jobs` na mesma transação; worker (`pg_cron` + Edge Function)
consome com `FOR UPDATE SKIP LOCKED`, retry exponencial e DLQ.

**Descartado.** (a) Chamada direta — e-mail perdido em falha de rede. (b) Fila externa (SQS,
Upstash) — mais um provedor e mais um segredo para resolver algo que o Postgres cobre nesta escala.

**Consequências.** Entrega "pelo menos uma vez" (handlers precisam ser idempotentes); fila
observável e reprocessável em tela; nenhuma dependência de infraestrutura adicional.

---

## ADR-004 — Claims de tenant no JWT + helpers `STABLE` na RLS

**Contexto.** Toda query do painel precisa saber o tenant ativo e as permissões. Consultar
`memberships` em cada política multiplica o custo por linha.

**Decisão.** Custom Access Token Hook injeta `tenant_ids`, `active_tenant` e `perms`; políticas
usam `(SELECT private.current_tenant())` para forçar avaliação única (InitPlan).

**Descartado.** (a) `EXISTS (SELECT 1 FROM memberships …)` em cada política — correto, porém caro.
(b) Tenant vindo de header/cookie — forjável pelo cliente.

**Consequências.** Mudança de papel/tenant exige refresh do token (latência de até 1h em
revogações, mitigada por revogação de sessão explícita nas operações sensíveis).

**Revisão (migration `20260801091100_zero_config`).** O hook é configurado no **painel** do
Supabase e não é capturado por nenhuma migration. Na primeira instalação em nuvem isso derrubou o
sistema: login funcionava, JWT saía sem claims, RLS não achava tenant e o painel abria em branco.

Os helpers passaram a ser **claim-first com fallback no banco**: se a claim existe, resolve do
token sem consulta; se não existe, consulta `profiles`/`memberships`. Isso exige
`SECURITY DEFINER` com dono `postgres` (que tem `BYPASSRLS`) — sem isso, ler `profiles` dentro do
helper dispara a política de `profiles`, que chama o helper de novo, em recursão infinita.

O hook continua valendo a pena e permanece recomendado, mas virou **otimização, não pré-requisito**.
Ganho colateral: revogação de permissão passa a valer na hora quando o hook está desligado, em vez
de esperar o token expirar.

---

## ADR-005 — Realtime por broadcast, não `postgres_changes`

**Contexto.** Contador de vagas, dashboard do dia e tela de check-in precisam de tempo real, com
centenas de conexões simultâneas por evento.

**Decisão.** Triggers chamam `realtime.broadcast_changes()` em canais privados
`tenant:{id}:event:{id}`, autorizados por RLS em `realtime.messages`.

**Descartado.** `postgres_changes` — avalia RLS por conexão a cada mudança; degrada acima de
algumas centenas de assinantes e expõe a linha inteira.

**Consequências.** Controle explícito do payload publicado; um trigger a mais por tabela publicada.

---

## ADR-006 — ISR na landing + contador dinâmico no cliente

**Contexto.** A landing precisa de TTFB baixo e SEO, mas o número de vagas muda a cada segundo.

**Decisão.** Página estática com ISR (`revalidate: 300`) invalidada por `revalidateTag` quando o
evento muda; o contador de vagas é um Client Component com React Query + Realtime.

**Descartado.** (a) SSR puro — TTFB alto e carga desnecessária no banco em campanhas de tráfego.
(b) Tudo estático — contador desatualizado leva o usuário a preencher o formulário e perder a vaga.

**Consequências.** Duas fontes de dado na mesma página (conteúdo em cache, contador ao vivo);
resolvido com um único hook reutilizável (`useEventAvailability`).

---

## ADR-007 — Participante sem cadastro

**Contexto.** Cada campo e cada senha a mais derrubam a conversão da inscrição.

**Decisão.** Sem conta: acesso ao ingresso por link assinado enviado por e-mail, com reenvio
autenticado por e-mail + CPF.

**Descartado.** Conta obrigatória (fricção alta, recuperação de senha vira suporte) e login social
(dependência externa sem benefício claro no fluxo).

**Consequências.** O link do ingresso é credencial — logo token longo, sem sequência, com rate
limit e sem dados sensíveis no payload. Histórico do participante fica atrelado ao CPF dentro do tenant.

---

## ADR-008 — PDF em Route Handler Node, não em Edge Function

**Contexto.** O ingresso em PDF precisa de layout fiel, fontes customizadas e QR embutido.

**Decisão.** `@react-pdf/renderer` num Route Handler com runtime Node; o arquivo é gerado uma vez e
guardado no Storage, entregue por URL assinada.

**Descartado.** (a) Deno + `pdf-lib` na Edge Function — layout manual, muito mais código para o
mesmo resultado. (b) Serviço headless de impressão (Puppeteer) — pesado para o servidor do Cloudways.

**Consequências.** Depende do servidor Node (que já existe); geração cacheada evita custo repetido.

---

## ADR-009 — Repositórios como única fronteira com o Supabase

**Contexto.** `supabase.from(...)` espalhado por componentes torna impossível trocar de provedor,
padronizar erros e testar.

**Decisão.** Todo acesso passa por `repositories/*`, com `base.repository.ts` cuidando de paginação
por cursor, filtros e tradução de erros do Postgres.

**Descartado.** Chamar o client direto nos Server Components (rápido no começo, insustentável em
20+ telas) e ORM sobre o Postgres (perderia RLS transparente e tipos gerados).

**Consequências.** Uma indireção a mais por consulta; em troca, erro tratado num lugar só, testes
com repositório falso e liberdade para evoluir a camada de dados.

---

## ADR-010 — Um único schema Zod compartilhado entre Next.js e Edge Functions

**Contexto.** A mesma inscrição é validada no navegador, no servidor e na borda. Validações
divergentes geram bugs silenciosos.

**Decisão.** Schemas em `shared/schemas/`, importados pelo Next.js (path alias) e pelas Edge
Functions (Deno lê TypeScript nativamente).

**Descartado.** Pacote npm interno (overhead de publicação) e duplicação manual (erro garantido).

**Consequências.** `shared/` não pode importar nada específico de Node ou do React — restrição
verificada por regra de ESLint.

---

## ADR-011 — `ticket_types` com preço desde o início

**Contexto.** A fase 1 é gratuita, mas concorrer com o Sympla exige pagamentos.

**Decisão.** Modelar `ticket_types` com `price`, `sales_start`, `sales_end` e capacidade própria já
na Sprint 4, sem implementar checkout.

**Descartado.** Modelar só quando houver pagamento — obrigaria migração destrutiva em base com
milhões de inscrições.

**Consequências.** Colunas ociosas na fase 1; a inclusão de `orders`/`payments` depois é aditiva.

---

## ADR-012 — Cloudways com `output: standalone` + PM2

**Contexto.** O Cloudways é um VPS gerenciado, sem suporte nativo ao runtime do Next.js.

**Decisão.** Build standalone, PM2 em modo cluster, Nginx como proxy com SSL, Brotli e cache de
estáticos; deploy por Git com script de release.

**Descartado.** (a) `next export` — mataria ISR, Server Actions e Route Handlers. (b) Docker no
Cloudways — suporte limitado. (c) Migrar para Vercel — contraria o requisito do projeto.

**Consequências.** Cache de ISR precisa de diretório persistente entre releases; observabilidade é
responsabilidade nossa (PM2 + healthcheck + Sentry). Validado logo na Sprint 1 para não virar
surpresa no fim.

---

## ADR-014 — Fachada de RPC em `public`, não em um schema `api`

**Contexto.** As RPCs do painel (`my_context`, `switch_tenant`, …) nasceram num schema `api`, para
separar a superfície chamável da implementação interna. Localmente funcionava: o `config.toml`
lista os schemas expostos.

**Problema encontrado em produção.** `supabase db push` aplica **apenas SQL**. A lista de schemas
expostos é configuração de painel, invisível para as migrations. Resultado no primeiro deploy em
nuvem: `PGRST106: Invalid schema: api`, sessão nunca montava, painel em branco — com o banco
inteiro correto.

**Decisão.** Mover a fachada para `public`, que é exposto por padrão. A implementação continua
única e as funções seguem `SECURITY DEFINER`. O schema `api` fica reservado para a REST pública
versionada da Sprint 10, quando expor um schema será uma decisão consciente e documentada no
runbook de deploy.

**Descartado.** (a) Manter em `api` e documentar o passo manual — documentação não impede
esquecimento, e o sintoma (tela em branco) não aponta para a causa. (b) Wrappers em `public`
chamando `api` — duas superfícies para a mesma coisa.

**Consequências.** `public` acumula as funções da fachada; mitigado por nomes explícitos e pela
regra de que só entra ali o que é realmente chamável pelo cliente. Em troca, **um ambiente novo
sobe inteiro a partir das migrations, sem nenhum clique** — que é o critério que importa.

**Princípio geral que fica:** se um ambiente novo precisa de um clique manual para funcionar, isso
não é documentação faltando, é defeito de arquitetura.

---

## ADR-013 — Auditoria híbrida: trigger no banco + contexto na aplicação

**Contexto.** O banco enxerga o diff dos dados, mas não conhece IP, dispositivo nem geolocalização.
A aplicação conhece o contexto, mas erra ao tentar registrar todo diff manualmente.

**Decisão.** Trigger genérico grava `changes` (antes/depois) lendo o contexto injetado por
`set_config('app.context', …)` no início da transação; as RPCs recebem `p_context jsonb` com IP,
user agent, dispositivo e coordenadas.

**Descartado.** Só na aplicação (esquecimentos garantidos) e só no banco (perde contexto da requisição).

**Consequências.** Toda chamada de escrita precisa propagar o contexto — encapsulado num único
helper (`withRequestContext`), o que torna o esquecimento improvável.

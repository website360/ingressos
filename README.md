# Ingressos — Sistema de Gestão de Eventos

Sistema para criação, divulgação, inscrição, controle de vagas, emissão de ingressos com QR Code
assinado, check-in presencial (com PWA offline), auditoria completa, relatórios e dashboard
analítico.

> **Sistema de empresa única** (não é SaaS multiempresa — ver
> `supabase/migrations/20260801091200_single_company.sql`).
>
> **Status: módulos M0 a M6 implementados e verificados contra banco real.**
>
> | Módulo                                                                                                  | Situação |
> | ------------------------------------------------------------------------------------------------------- | -------- |
> | M0 — Fundação (auth, RBAC, RLS, auditoria)                                                              | ✅       |
> | M1 — Eventos (CRUD, conteúdo, landing pública, ISR + SEO)                                               | ✅       |
> | M2 — Inscrições (vagas atômicas, QR assinado, ingresso, PDF, calendário, cancelamento, lista de espera) | ✅       |
> | M3 — Check-in (PWA, scanner, busca, geofence, offline + sincronização)                                  | ✅       |
> | M4 — Gestão (participantes, check-ins, exportação CSV)                                                  | ✅       |
> | M5 — Analytics (dashboard com gráficos, relatórios)                                                     | ✅       |
> | M6 — Operação (notificações, suporte, auditoria, e-mails transacionais)                                 | ✅       |
> | M7 — API pública v1, webhooks, OpenAPI                                                                  | pendente |
>
> Instalação e execução: [docs/10-instalacao.md](docs/10-instalacao.md).
> Diagnóstico do ambiente: `npm run doctor`.

---

## Índice da documentação

| #   | Documento                                                          | Conteúdo                                                                                               |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 01  | [Requisitos](docs/01-requisitos.md)                                | Escopo, personas, requisitos funcionais (RF) e não-funcionais (RNF), regras de negócio, fora de escopo |
| 02  | [Arquitetura](docs/02-arquitetura.md)                              | Visão macro, camadas, padrões, fronteiras cliente/servidor, integrações, realtime, jobs                |
| 03  | [Modelagem do banco](docs/03-modelagem-banco.md)                   | Esquemas, tabelas, FKs, índices, constraints, views, functions, triggers, RLS por tabela               |
| 04  | [Estrutura de pastas](docs/04-estrutura-pastas.md)                 | Árvore do repositório, convenções de nomenclatura, camadas de código                                   |
| 05  | [Fluxos](docs/05-fluxos.md)                                        | Fluxo de telas, de usuários, de inscrição, de cancelamento, de lista de espera, de check-in            |
| 06  | [Roadmap e Sprints](docs/06-roadmap-sprints.md)                    | Módulos M0–M7, 10 sprints, entregáveis, critérios de aceite (DoD)                                      |
| 07  | [Segurança](docs/07-seguranca.md)                                  | Multi-tenant, RLS, RBAC, JWT, assinatura do QR Code, rate limit, LGPD                                  |
| 08  | [Deploy](docs/08-deploy.md)                                        | Cloudways (Next.js), Supabase, CI/CD via GitHub, variáveis de ambiente, rollback                       |
| 09  | [Decisões arquiteturais (ADRs)](docs/09-decisoes-arquiteturais.md) | Cada escolha técnica, alternativas descartadas e o porquê                                              |
| 10  | [Instalação](docs/10-instalacao.md)                                | Pré-requisitos, Supabase local, seed, usuários de teste, comandos                                      |
| DS  | [Design System](docs/DESIGN-SYSTEM.md)                             | Fonte da verdade visual do painel administrativo (não alterar)                                         |

---

## Stack

**Frontend** — Next.js 15 (App Router) · React 19 · TypeScript (strict) · TailwindCSS · Shadcn/UI (Radix)
· React Hook Form · Zod · TanStack Table · TanStack Query · Recharts · Framer Motion · Lucide Icons · PWA (Serwist)

**Backend** — Supabase: PostgreSQL 15+ · Auth (JWT) · Storage · Realtime · Edge Functions (Deno)
· RLS em 100% das tabelas · migrations versionadas (nenhuma alteração manual no banco)

**Infra** — GitHub → Cloudways (Node.js, Nginx, SSL, Brotli/Gzip, PM2) → Supabase (managed)

---

## Princípios inegociáveis do projeto

1. **Nada de alteração manual no banco.** Toda mudança nasce em `supabase/migrations/*.sql`.
2. **RLS ligada em todas as tabelas**, sem exceção — inclusive nas de log e fila.
3. **Regras críticas moram no banco** (vagas, lista de espera, duplicidade de check-in), não no
   frontend. O frontend nunca é a única barreira.
4. **Zero código duplicado**: componente, hook, service ou util — sempre reutilizado.
5. **Design System é lei.** Cores, fontes, raios, sombras e animações não são reinterpretados.
6. **Tudo auditável.** Toda escrita relevante gera trilha com usuário, IP, dispositivo e geolocalização.
7. **Contratos tipados de ponta a ponta**: tipos gerados do Postgres + schemas Zod compartilhados
   entre Next.js e Edge Functions.

---

## Comandos do dia a dia

| Comando                       | O que faz                                                 |
| ----------------------------- | --------------------------------------------------------- |
| `npm run dev`                 | Servidor de desenvolvimento                               |
| `npm run doctor`              | Diagnóstico do ambiente ponta a ponta                     |
| `npm run db:push`             | Aplica migrations pendentes                               |
| `npm run db:types`            | Regenera os tipos por introspecção do schema real         |
| `npm run db:seed` / `db:demo` | Empresa e usuários / eventos e inscrições de demonstração |
| `npm run local:*`             | Mesmo fluxo contra o Supabase local (requer Docker)       |

## Áreas do sistema

| Área                         | Rota                                  | Quem usa                            |
| ---------------------------- | ------------------------------------- | ----------------------------------- |
| Painel administrativo        | `/dashboard`                          | Administrador, Organizador, Suporte |
| Aplicativo de check-in (PWA) | `/checkin`                            | Recepção, no dia do evento          |
| Vitrine e landing pública    | `/eventos-publicos`, `/evento/{slug}` | Participante                        |
| Ingresso                     | `/ingresso/{token}`                   | Participante, sem login             |

## O que falta (M7)

API pública versionada (`/api/v1`) com chaves por integração, webhooks assinados e documentação
OpenAPI. Detalhamento em [docs/06-roadmap-sprints.md](docs/06-roadmap-sprints.md).

# 04 — Estrutura de Pastas

## 1. Raiz do repositório

```
ingressos/
├─ .github/workflows/          # CI: lint, typecheck, testes, migrations, deploy
├─ docs/                       # esta documentação (versionada com o código)
├─ public/                     # estáticos, ícones PWA, manifest, sons de check-in
├─ shared/                     # contratos compartilhados Next.js ⇄ Edge Functions
│  ├─ schemas/                 # Zod: registration, event, checkin, support...
│  ├─ constants/               # enums espelhados do banco, códigos de erro
│  └─ types/                   # tipos de domínio independentes de infraestrutura
├─ src/
├─ supabase/
│  ├─ migrations/              # ÚNICA fonte de verdade do schema
│  ├─ functions/               # Edge Functions (Deno)
│  ├─ tests/                   # pgTAP: RLS, RPCs, constraints
│  ├─ seed.sql
│  └─ config.toml
├─ tests/
│  ├─ e2e/                     # Playwright: inscrição, check-in, cancelamento
│  └─ setup/
├─ .env.example
├─ next.config.ts
├─ tailwind.config.ts          # tokens do Design System (não alterar sem ADR)
├─ components.json             # shadcn/ui
├─ ecosystem.config.js         # PM2 (Cloudways)
└─ package.json
```

## 2. `src/`

```
src/
├─ app/
│  ├─ (public)/                        # área pública — sem sessão
│  │  ├─ [tenant]/
│  │  │  ├─ page.tsx                   # vitrine de eventos do tenant
│  │  │  └─ [eventSlug]/
│  │  │     ├─ page.tsx                # landing (RSC + ISR)
│  │  │     ├─ opengraph-image.tsx     # OG dinâmico
│  │  │     ├─ inscricao/page.tsx      # formulário
│  │  │     └─ inscricao/sucesso/page.tsx
│  │  ├─ ingresso/[token]/page.tsx     # página do ingresso (acesso por token assinado)
│  │  └─ layout.tsx                    # tema do tenant (branding), sem chrome de admin
│  │
│  ├─ (auth)/
│  │  ├─ login/ · esqueci-senha/ · redefinir-senha/ · convite/[token]/ · mfa/
│  │  └─ layout.tsx                    # layout centrado com .bg-grid + .bg-radial-primary
│  │
│  ├─ (admin)/                         # painel — Design System obrigatório
│  │  ├─ layout.tsx                    # Sidebar + Topbar + providers
│  │  ├─ dashboard/
│  │  ├─ eventos/
│  │  │  ├─ page.tsx · novo/ · [id]/(editar|conteudo|participantes|checkins|relatorios)
│  │  ├─ participantes/
│  │  ├─ checkins/
│  │  ├─ relatorios/
│  │  ├─ suporte/
│  │  ├─ notificacoes/
│  │  ├─ auditoria/
│  │  ├─ configuracoes/(empresa|usuarios|permissoes|emails|api|webhooks|integracoes)
│  │  └─ perfil/
│  │
│  ├─ (checkin)/                       # PWA — layout enxuto, alto contraste, offline
│  │  ├─ layout.tsx
│  │  ├─ page.tsx                      # seleção de evento + preparar modo offline
│  │  └─ [eventId]/(scanner|busca|fila|resumo)
│  │
│  ├─ api/
│  │  ├─ v1/(events|registrations|attendees|checkins|stats)/route.ts
│  │  ├─ tickets/[id]/pdf/route.ts     # Node runtime (@react-pdf/renderer)
│  │  ├─ tickets/[id]/calendar/route.ts# .ics (Apple/Outlook) + link Google
│  │  ├─ webhooks/revalidate/route.ts  # invalidação de ISR disparada pelo banco
│  │  └─ health/route.ts
│  │
│  ├─ layout.tsx · globals.css · not-found.tsx · error.tsx · manifest.ts · sitemap.ts · robots.ts
│
├─ components/
│  ├─ ui/                              # shadcn — primitivos do Design System
│  ├─ shared/                          # DataTable, PageHeader, StatCard, EmptyState,
│  │                                   # ConfirmDialog, FileUpload, DateRangePicker,
│  │                                   # StatusBadge, ExportMenu, MapView, QrScanner
│  ├─ charts/                          # wrappers Recharts com tokens do DS
│  ├─ forms/                           # FormField, FormSection, controles conectados ao RHF
│  └─ layout/                          # Sidebar, Topbar, TenantSwitcher, Breadcrumbs, CommandPalette
│
├─ features/                           # domínio: UI + hooks + schemas + actions
│  ├─ auth/ · tenants/ · users/ · events/ · registrations/ · tickets/ · checkin/
│  ├─ waitlist/ · cancellations/ · dashboard/ · reports/ · support/
│  ├─ notifications/ · audit/ · settings/
│  └─ <feature>/
│     ├─ components/                   # UI específica do domínio
│     ├─ hooks/                        # use<X>Query, use<X>Mutation (React Query)
│     ├─ actions/                      # Server Actions ("use server")
│     ├─ schemas/                      # re-export de shared/schemas + schemas de tela
│     └─ types.ts
│
├─ services/                           # casos de uso, sem React
│  ├─ registration.service.ts · checkin.service.ts · ticket.service.ts
│  ├─ waitlist.service.ts · report.service.ts · email.service.ts
│  ├─ pdf.service.ts · calendar.service.ts · storage.service.ts · audit.service.ts
│
├─ repositories/                       # única camada que conhece o Supabase
│  ├─ base.repository.ts               # paginação por cursor, filtros, tratamento de erro
│  ├─ event.repository.ts · registration.repository.ts · checkin.repository.ts · ...
│
├─ lib/
│  ├─ supabase/(client|server|admin|middleware).ts · database.types.ts
│  ├─ auth/(session|permissions|guards).ts
│  ├─ qrcode/(sign|verify|encode).ts   # Ed25519 — usado no servidor e no PWA
│  ├─ errors/(app-error|pg-error-map|handler).ts
│  ├─ validation/(cpf|phone|cep|zod-helpers).ts
│  ├─ format/(date|currency|document|phone|number).ts
│  ├─ offline/(db|sync-queue|cache).ts # IndexedDB do check-in
│  ├─ realtime/ · query/ (React Query config) · analytics/ · logger.ts
│  └─ utils.ts                         # cn() e afins
│
├─ hooks/                              # genéricos: useDebounce, useMediaQuery, useGeolocation,
│                                      # useOnlineStatus, useTable, useConfirm, usePermission
├─ providers/                          # Query, Theme, Tenant, Toast, Realtime, Offline
├─ config/                             # navegação, permissões, colunas de tabela, mapas de status
├─ constants/                          # rotas, chaves de query, buckets, limites
├─ types/                              # tipos globais e utilitários
└─ middleware.ts                       # sessão, tenant ativo, guards, rate limit, headers
```

## 3. Edge Functions

```
supabase/functions/
├─ _shared/            # cliente admin, cors, logger, validação (importa ../../shared/schemas)
├─ send-email/         # consome outbox → Resend
├─ process-outbox/     # worker genérico da fila
├─ promote-waitlist/   # convocação + e-mail
├─ reverse-geocode/    # enriquece check-ins
├─ generate-report/    # relatórios pesados → Storage
├─ dispatch-webhook/   # entrega assinada + retry
└─ sign-ticket/        # assinatura Ed25519 (chave privada no Vault)
```

## 4. Convenções de nomenclatura

| Item                      | Padrão                                 | Exemplo                             |
| ------------------------- | -------------------------------------- | ----------------------------------- |
| Pastas e arquivos de rota | kebab-case                             | `lista-espera/page.tsx`             |
| Componentes React         | PascalCase                             | `RegistrationForm.tsx`              |
| Hooks                     | camelCase com `use`                    | `useEventStats.ts`                  |
| Services/Repositories     | `*.service.ts`, `*.repository.ts`      | `checkin.service.ts`                |
| Server Actions            | verbo no infinitivo                    | `createEvent`, `cancelRegistration` |
| Schemas Zod               | `<entidade>Schema` + `<Entidade>Input` | `registrationSchema`                |
| Tabelas/colunas SQL       | snake_case plural                      | `event_speakers`                    |
| Chaves de React Query     | `constants/query-keys.ts` centralizado | `qk.events.list(filters)`           |

## 5. Regras anti-duplicação

1. Toda tabela do painel usa `components/shared/DataTable` — nunca uma `<table>` avulsa.
2. Todo formulário usa `components/forms/*` + schema Zod de `shared/schemas`.
3. Todo acesso a dados passa por `repositories/` — `supabase.from(...)` fora dali é erro de revisão.
4. Todo estado de status na UI vem de `config/status-maps.tsx` (label, cor, ícone num único lugar).
5. Toda mensagem de erro vem de `lib/errors` — sem string solta em componente.
6. Toda formatação (data, CPF, telefone, moeda) vem de `lib/format`.
7. Um schema Zod por entidade, compartilhado entre cliente, servidor e Edge Function.

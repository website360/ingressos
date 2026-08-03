# 06 — Roadmap e Plano de Sprints

## 1. Módulos

| Módulo | Nome       | Entrega                                                                                                   | Depende de |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| **M0** | Fundação   | Repo, Design System, Supabase, auth, multi-tenant, RLS base, CI/CD                                        | —          |
| **M1** | Eventos    | CRUD completo, conteúdo da landing, tipos de ingresso, páginas públicas                                   | M0         |
| **M2** | Inscrições | Formulário, vagas atômicas, QR assinado, ingresso, PDF, e-mail, calendário, cancelamento, lista de espera | M1         |
| **M3** | Check-in   | PWA, scanner, busca, geofence, offline, sincronização, alertas                                            | M2         |
| **M4** | Gestão     | Participantes (com cancelamento e check-in na linha), check-ins, exportações, importação, ações em massa  | M2         |
| **M5** | Analytics  | Dashboard, gráficos, mapas, relatórios, agendamento de relatórios                                         | M4         |
| **M6** | Operação   | Notificações, suporte, auditoria (tela), configurações avançadas                                          | M4         |
| **M7** | Plataforma | API pública v1, webhooks, documentação, hardening, performance, go-live                                   | M5, M6     |

**Regra:** um módulo só é considerado entregue com código + migrations + testes + documentação +
deploy em staging validado. O módulo seguinte não inicia antes disso.

---

## 2. Sprints (2 semanas cada)

### Sprint 1 — M0: Fundação e Design System

**Objetivo:** esqueleto de produção rodando, com login real e isolamento entre empresas provado por teste.

- Bootstrap Next.js 15 + React 19 + TS strict + Tailwind + shadcn/ui
- **Design System aplicado byte a byte**: `tailwind.config.ts`, `globals.css`, fontes (Nunito Sans + JetBrains Mono, base 17px), tokens HSL light/dark, sombras, animações, `.glass`, `.bg-grid`, `.shimmer`, scrollbar
- Componentes base: Button, Card, Input, Badge, Dialog, Sheet, Select, Tabs, Tooltip, Toast, Skeleton, Table
- Layout do painel: Sidebar, Topbar, TenantSwitcher, Breadcrumbs, tema claro/escuro, Command Palette
- Projeto Supabase + `supabase/config.toml` + migrations: extensões, schemas, enums, `tenants`, `profiles`, `memberships`, `permissions`, `role_permissions`, `user_event_scopes`
- Helpers de RLS + Custom Access Token Hook (claims de tenant e permissões)
- Auth: login, magic link, recuperação, convite, MFA opcional, middleware de sessão e tenant
- `lib/supabase/*`, `repositories/base`, `lib/errors`, `providers/*`, React Query configurado
- CI: lint, typecheck, `supabase db reset`, pgTAP de isolamento de tenant
- **DoD:** dois tenants no banco; usuário do tenant A recebe 0 linhas do tenant B em consulta direta ao PostgREST (teste automatizado).

### Sprint 2 — M1: Eventos (núcleo)

- Migrations: `categories`, `tags`, `event_tags`, `events`, `ticket_types`, `event_slug_history`, contadores, triggers, RLS
- CRUD de eventos: wizard em 4 passos com autosave de rascunho
- Upload de capa/banner/galeria (Storage + políticas + derivadas WebP)
- Editor rich text sanitizado, seletor de mapa com coordenadas e raio (Leaflet/MapLibre)
- Listagem de eventos: DataTable com filtros, busca full-text, ordenação e paginação por cursor
- Duplicar evento, arquivar, publicar/despublicar com validações de publicação
- **DoD:** evento criado, publicado e listado; slug único por tenant; mudança de slug gera redirect.

### Sprint 3 — M1: Conteúdo e páginas públicas

- Migrations: `event_schedule_items`, `event_speakers`, `event_faqs`, `event_sponsors`, `event_media`, `event_documents` (versionados)
- Abas de conteúdo no painel com ordenação drag-and-drop
- Landing pública: hero, contador de vagas, selo de status, todas as seções, mapa, patrocinadores
- ISR + `revalidateTag` disparado por trigger do banco, OG image dinâmica, JSON-LD `Event`, sitemap, robots
- Vitrine do tenant, tema por tenant (branding), acessibilidade AA, Lighthouse ≥ 95
- **DoD:** landing publicada com LCP < 2,5s em 4G simulado e conteúdo completo renderizado.

### Sprint 4 — M2: Inscrição, vagas e ingresso

- Migrations: `attendees`, `registrations`, `consents`, `tickets`, `waitlist`, índices únicos parciais, `chk_capacity`
- `fn_create_registration` (transacional, com lock) + fachada `api.create_registration`
- Formulário público (RHF + Zod compartilhado), máscaras, validação de CPF, campos personalizados
- Rate limit + anti-bot; idempotência
- Assinatura Ed25519 (`signing_keys`, Vault, `sign-ticket`), geração e renderização do QR
- Página do ingresso por token assinado; `.ics` e link do Google Calendar
- **DoD:** teste de carga com 200 inscrições concorrentes em evento de 100 vagas → exatamente 100 confirmadas, 100 em lista de espera, zero inconsistência.

### Sprint 5 — M2: E-mail, PDF, cancelamento e lista de espera

- Migrations: `outbox_jobs`, `email_messages`, `email_templates`, `cancellations`, jobs `pg_cron`
- Worker de outbox + Edge Function `send-email` (Resend) com retry e DLQ
- Templates: confirmação, cancelamento, lembrete D-3/D-1, convocação, mudança de evento, agradecimento
- PDF do ingresso (`@react-pdf/renderer`, Node runtime) com logo, banner, QR, mapa e regras → Storage
- `fn_cancel_registration`, tela pública de cancelamento com motivo
- `fn_promote_waitlist` + `fn_expire_waitlist_holds` + telas de lista de espera no painel
- **DoD:** cancelamento libera a vaga e convoca o próximo da fila com e-mail entregue, em < 1 min, comprovado por teste de integração.

### Sprint 6 — M3: Check-in online

- Migrations: `checkins`, índices únicos parciais, PostGIS, `fn_checkin`
- PWA: manifest, service worker (Serwist), instalação, layout de alto contraste
- Scanner (BarcodeDetector + fallback WASM), busca unificada (CPF/nome/e-mail) com trigram
- Cartão do participante, confirmação, feedback sonoro/háptico, tela de fila e resumo em tempo real
- Geolocalização + geofence + override auditado
- **DoD:** ingresso lido duas vezes exibe "INGRESSO JÁ UTILIZADO" com data, hora e recepcionista da primeira entrada.

### Sprint 7 — M3: Check-in offline e sincronização

- Cache IndexedDB por evento (ingressos, revogados, chave pública), tela "Preparar modo offline"
- Verificação Ed25519 local, fila de sincronização, Background Sync, indicadores de estado
- `fn_checkin_batch` idempotente com resolução de conflitos e relatório de divergências
- Painel de alertas: duplicidades, fora do raio, tentativas com ingresso cancelado
- **DoD:** 100 check-ins em modo avião, em dois dispositivos com 10 ingressos em comum → sincronização resulta em 100 registros, 10 conflitos identificados, nenhum check-in perdido.

### Sprint 8 — M4: Gestão e exportações

- Tela de participantes: colunas configuráveis, filtros completos, seleção em massa, cursor pagination
- Ações em massa: reenviar ingresso, cancelar, presença manual, tags, exportar
- Ficha do participante com linha do tempo (inscrições, e-mails, check-ins, cancelamentos)
- Importação CSV com pré-validação e relatório de erros
- Exportação Excel/CSV/PDF respeitando filtros e permissões, com mascaramento de dados sensíveis
- Tela de check-ins com mapa
- **DoD:** exportação de 50.000 participantes gerada de forma assíncrona, com notificação e link assinado.

### Sprint 9 — M5 + M6: Analytics, operação e auditoria

- `mv_dashboard_kpis`, `mv_attendees_by_region`, views de relatório, refresh por `pg_cron`
- Dashboard com KPIs, gráficos (Recharts com tokens do DS), mapa, funil, ranking de eventos
- Relatórios: inscritos, presentes, ausentes, cancelados, origem, cidade, estado, faixa etária, tempo até inscrição, horários de check-in; agendamento por e-mail
- Notificações in-app com Realtime, central e preferências
- Módulo de suporte (chamados, comentários, anexos, SLA)
- Tela de auditoria com filtros, diff visual e exportação
- **DoD:** dashboard de um tenant com 100k inscrições carrega em < 1,5s; auditoria comprova rastreabilidade de uma edição de evento ponta a ponta.

### Sprint 10 — M7: API, hardening e go-live

- API v1 (eventos, inscrições, participantes, check-ins, estatísticas) com API keys, escopos e rate limit
- Webhooks assinados com retry e painel de entregas
- OpenAPI 3.1 + página `/docs/api`
- Hardening: CSP, HSTS, headers, revisão OWASP, pentest interno, revisão completa de RLS
- Performance: bundle analyzer, code splitting, otimização de imagens, tuning de índices
- LGPD: exportação, anonimização, retenção
- Documentação final: README, instalação, deploy, variáveis, manual do administrador, manual do organizador, manual do recepcionista
- **DoD:** deploy em produção via `git push`, smoke tests verdes, runbook de rollback testado.

---

## 3. Linha do tempo

```
Sprint  1    2    3    4    5    6    7    8    9    10
        ├M0──┼─M1──────┼──M2──────┼──M3──────┼─M4─┼M5+M6┼─M7─┤
        └ fundação     └ público  └ ingresso └ campo └ dados └ plataforma
```

20 semanas (~5 meses) para a versão 1.0 comercializável. Com dois desenvolvedores, as sprints 8 e 9
paralelizam com a 6 e 7 (M4/M5 dependem de M2, não de M3), encurtando para ~16 semanas.

---

## 4. Definition of Done (toda entrega)

- [ ] TypeScript strict sem `any` não justificado; lint e format limpos
- [ ] Migrations aplicadas via arquivo (nenhuma alteração manual no banco)
- [ ] RLS escrita e **testada** para cada tabela nova (pgTAP, incluindo caso negativo entre tenants)
- [ ] Testes unitários das regras de negócio + E2E do fluxo crítico da sprint
- [ ] Componentes seguindo o Design System (revisão visual contra o documento)
- [ ] Responsivo em 360px, 768px, 1024px, 1440px
- [ ] Estados de carregamento (skeleton), vazio e erro implementados
- [ ] Auditoria gravada nas ações relevantes
- [ ] Documentação atualizada em `docs/`
- [ ] Deploy em staging validado com dados de seed

---

## 5. Riscos e mitigação

| Risco                                  | Impacto                | Mitigação                                                                                                    |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Concorrência nas vagas                 | Overbooking indevido   | Constraint no banco + lock + teste de carga já na Sprint 4                                                   |
| Check-in sem internet                  | Evento parado          | Offline-first é requisito de sprint, não "melhoria futura"                                                   |
| Custo/limite do Supabase em picos      | Degradação             | ISR na landing, broadcast em vez de `postgres_changes`, índices revisados, connection pooling                |
| Cloudways sem suporte nativo a Next 15 | Deploy travado         | `output: standalone` + PM2 + Nginx documentado e validado já na Sprint 1                                     |
| Vazamento entre tenants                | Incidente grave        | RLS + `FORCE ROW LEVEL SECURITY` + teste automatizado obrigatório no CI                                      |
| Entregabilidade de e-mail              | Ingresso não chega     | Domínio com SPF/DKIM/DMARC, provedor transacional dedicado, log de entrega e reenvio                         |
| LGPD                                   | Multa/contrato perdido | Consentimento versionado, anonimização e retenção implementados na Sprint 10, mas modelados desde a Sprint 4 |

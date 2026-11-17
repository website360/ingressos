# Assistente de criação de evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modal de criação de evento em 9 etapas puláveis, com perguntas frequentes padrão da empresa.

**Architecture:** O rascunho nasce na etapa 1 (`createEvent`, que já copia as perguntas padrão para `event_faqs`). Cada etapa seguinte grava só a própria parte: os campos do evento por `updateEvent`, e o conteúdo por uma nova ação que salva uma seção de cada vez. Os blocos de campo saem dos formulários atuais para componentes compartilhados entre a tela de edição e o assistente.

**Tech Stack:** Next.js App Router, Server Actions, Supabase (RLS), zod, react-hook-form, Radix Dialog, vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-assistente-novo-evento-design.md`

## Global Constraints

- O assistente só abre com `event.create` **e** `event.update`.
- Perguntas padrão: pergunta de 5 a 200 caracteres, resposta de 2 a 1000 (iguais ao `faqSchema`).
- As perguntas padrão são copiadas para `event_faqs` na criação; editar o padrão não altera eventos existentes.
- "Pular" descarta o que foi digitado na etapa; "Próximo" valida e salva. Clicar na lista lateral salva a etapa atual se ela tiver alterações.
- Os textos da interface ficam em português, no tom dos existentes.

## Review Focus

- Slug duplicado na etapa 1 → mensagem clara no campo, e não erro genérico.
- Salvar a programação não pode apagar palestrantes nem FAQ, e não pode criar versão nova de documento que não mudou.
- Voltar à etapa 1 depois de criado → `updateEvent`, e não um segundo evento.
- Empresa sem perguntas padrão → a etapa 7 mostra só as personalizadas e um link para as configurações.
- Fechar o modal no meio → rascunho preservado e aviso de que pode continuar pela edição.

---

### Task 1: Tabela `faq_templates`, schema e repositório

**Files:**
- Create: `supabase/migrations/20260801093900_faq_templates.sql`
- Create: `shared/schemas/faq-template.ts`
- Modify: `src/repositories/event.repository.ts` (métodos de template)
- Modify: `src/lib/supabase/database.types.ts` (tipos da tabela nova)
- Test: `tests/unit/faq-templates.test.ts`

**Interfaces:**
- Produces: `faqTemplateSchema` (`{question, answer}`), `faqTemplateListSchema` (`{items: FaqTemplateInput[]}`, máx. 60), type `FaqTemplateInput`.
- Produces: `EventRepository.listFaqTemplates(): Promise<Tables<"faq_templates">[]>` (ordenado por `position`), `replaceFaqTemplates(tenantId, items)`, `appendFaqTemplates(tenantId, items)`.

- [ ] Migration: tabela (`id`, `tenant_id`, `question`, `answer`, `position`, `created_at`, `updated_at` + trigger `private.set_updated_at`), checks de tamanho, RLS enable/force; select com `event.create` ou `settings.read`; write com `settings.manage`.
- [ ] Testes: aceita par válido, recusa pergunta < 5, resposta vazia e lista > 60.
- [ ] Aplicar a migration (`npm run db:push`) e regenerar os tipos (`npm run db:types`).
- [ ] Commit.

### Task 2: Montagem das perguntas do evento (função pura)

**Files:**
- Create: `src/features/events/lib/faq-selection.ts`
- Test: `tests/unit/faq-selection.test.ts`

**Interfaces:**
- Produces: `type FaqChoice = { templateId: string | null; question: string; answer: string; checked: boolean; saveAsTemplate: boolean }`
- Produces: `initialFaqChoices(templates: {id,question,answer}[], eventFaqs: {question,answer}[]): FaqChoice[]`. Cada template entra marcado se houver FAQ do evento com a mesma pergunta (a resposta vem do evento). As FAQs do evento sem template correspondente viram personalizadas (`templateId: null`, `checked: true`).
- Produces: `buildEventFaqs(choices: FaqChoice[]): FaqInput[]`. Entram só as marcadas: primeiro as de template, na ordem, depois as personalizadas.
- Produces: `newTemplatesFrom(choices): FaqTemplateInput[]`. Personalizadas marcadas com `saveAsTemplate`.

- [ ] Testes: template sem FAQ correspondente → desmarcado; resposta ajustada no evento prevalece; ordem template→personalizada; desmarcada não entra; `saveAsTemplate` só vale para personalizada.
- [ ] Implementar e commit.

### Task 3: Ações do servidor

**Files:**
- Modify: `src/features/events/actions/event.actions.ts` (`createEvent` copia os templates)
- Modify: `src/features/events/actions/content.actions.ts`
- Create: `src/features/settings/actions/faq-template.actions.ts`

**Interfaces:**
- Produces: `saveEventContentSection(eventId: string, section: "schedule" | "speakers" | "faqs" | "documents", input: EventContentInput): Promise<Result<{eventId}>>`. Valida o input inteiro, mas grava só a seção pedida. `saveEventContent` passa a reaproveitar as mesmas rotinas internas.
- Produces: `saveFaqTemplates(input: {items}): Result` (substitui a lista; `settings.manage`) e `addFaqTemplates(input: {items}): Result` (anexa ao fim; `settings.manage`).
- `createEvent`: depois do insert, se a sessão tiver `event.update`, copia `listFaqTemplates()` para `event_faqs`. Falha na cópia não derruba a criação (log e segue).
- Slug duplicado: o `fail()` já mapeia 23505; conferir que a mensagem cita o endereço na web e, se não citar, tratar no `createEvent`/`updateEvent` com `AppError("CONFLICT", "Já existe um evento com esse endereço na web.")` e `field: "slug"` se a estrutura suportar.

- [ ] Implementar, conferir com `tsc`, e commit.

### Task 4: Componentes de campo compartilhados

**Files:**
- Create: `src/features/events/components/event-fields.tsx`. Exporta `EventNameField`, `EventSlugField`, `EventDescriptionFields`, `EventDateFields`, `EventCapacityField`, `EventLocationFields` (inclui o CEP com `applyAddress`) e `EventRegistrationFields` (overbooking e prazo). Todos recebem `{ form: UseFormReturn<EventInput> }`.
- Create: `src/features/events/components/event-content-sections.tsx`. Exporta `ScheduleSection`, `SpeakersSection`, `FaqSection` e `DocumentsSection` (`{ form: UseFormReturn<EventContentInput> }`), além de `Textarea`, `Section`, `Row` e `FormFieldInput`.
- Create: `src/features/events/lib/event-defaults.ts`, com `eventFormDefaults(event?)`, `contentFormDefaults(content)` e `toLocalInput`.
- Modify: `event-form.tsx` e `event-content-form.tsx`, que passam a usar esses componentes com o mesmo layout de hoje.

- [ ] Refatorar sem mudar o comportamento da tela de edição; `tsc` e lint limpos; conferir `/eventos/[id]` no navegador.
- [ ] Commit.

### Task 5: Aba Configurações → Perguntas padrão

**Files:**
- Create: `src/features/settings/components/faq-templates-form.tsx`, com lista editável (adicionar, remover, subir e descer) e "Salvar". Fica somente leitura sem `settings.manage`.
- Modify: `src/app/(admin)/configuracoes/page.tsx`, com nova aba `perguntas` ("Perguntas padrão") e o aviso de que eventos já criados não mudam.
- Modify: `src/constants/routes.ts`, com `settings.faqTemplates: "/configuracoes?aba=perguntas"`; a página respeita `?aba=` como `defaultValue`.

- [ ] Implementar, conferir no navegador e commit.

### Task 6: O assistente

**Files:**
- Create: `src/features/events/components/wizard/new-event-wizard.tsx`, com o Dialog, o estado das etapas e a navegação.
- Create: `src/features/events/components/wizard/wizard-steps.ts`. Define `STEPS`, com `id`, `title`, `kind: "event" | "content" | "images" | "faqs" | "review"`, os campos do evento ou a seção de conteúdo de cada etapa, e `skippable`.
- Create: `src/features/events/components/wizard/faq-step.tsx`
- Create: `src/features/events/components/wizard/review-step.tsx`
- Create: `src/features/events/components/new-event-button.tsx`. Botão e modal; abre sozinho com `?novo=1` e limpa o parâmetro ao fechar.
- Modify: `src/app/(admin)/eventos/page.tsx`. Usa o `NewEventButton` quando há `event.create` e `event.update`, e passa os templates.
- Modify: `src/app/(admin)/eventos/novo/page.tsx`, que vira `redirect("/eventos?novo=1")`.

Comportamento por etapa:
- **event (1, 2, 3):** `form.trigger(campos da etapa)`. Na etapa 1 sem id, chama `createEvent({...values, status: "rascunho"})` e guarda o id; com id, chama `updateEvent(id, values)`. Depois de salvar, `form.reset(form.getValues())`. "Pular" faz `resetField` nos campos da etapa.
- **images (4):** `ImageUpload` existente; "Próximo" só avança.
- **content (5, 6, 8):** `contentForm.trigger(seção)` → `saveEventContentSection` → `resetField(seção, {defaultValue: atual})`. "Pular" faz `resetField(seção)`.
- **faqs (7):** `FaqStep` com `initialFaqChoices`. "Próximo" chama `addFaqTemplates(newTemplatesFrom(...))` (se houver) e `saveEventContentSection(id, "faqs", {...contentForm.getValues(), faqs: buildEventFaqs(...)})`.
- **review (9):** lista os `publishRequirements` faltantes; mostra os campos `EventRegistrationFields`. "Salvar rascunho" faz `updateEvent` com status `rascunho` e navega para `/eventos/[id]`. "Publicar" faz o mesmo com status `publicado` e só aparece com `event.publish`, desabilitado quando há pendências.
- Layout: `DialogContent` com `max-w-5xl h-[90dvh]`; no celular, `h-dvh w-full max-w-none rounded-none`. Lista lateral em `md:`; no celular, "Etapa N de 9 · Título". Rodapé fixo com Voltar / Pular / Próximo.
- Fechar com rascunho criado: `toast("Rascunho salvo. Continue pela edição do evento.")`, `router.refresh()`.

- [ ] Implementar, rodar `tsc`, lint e testes, e percorrer o fluxo inteiro no navegador local: criar, pular, voltar, fotos, perguntas padrão e personalizadas, publicar, fechar no meio.
- [ ] Commit.

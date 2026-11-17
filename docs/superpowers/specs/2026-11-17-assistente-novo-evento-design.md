# Assistente de criação de evento — design

Data: 17/11/2026 · Status: aprovado

## Intenção

Criar um evento hoje é feito em duas partes. A página `/eventos/novo` tem três
abas (Básico, Data e local, Vagas). Fotos, programação, palestrantes, perguntas
frequentes e regulamento só ficam disponíveis depois, na tela de edição. O Caio
quer um **passo a passo único, em etapas, todas puláveis**, que já cubra fotos,
horários e perguntas. Também quer uma **área de perguntas frequentes padrão**:
na criação, o usuário escolhe quais delas entram no evento e pode adicionar
outras, só daquele evento.

"Perguntas", aqui, são as **perguntas frequentes (FAQ) da página pública do
evento** (`event_faqs`). Não são campos extras do formulário de inscrição; isso
foi descartado explicitamente.

## Objetivos

- Modal de criação em etapas, substituindo `/eventos/novo` como entrada do
  botão "Novo evento".
- Todas as etapas, exceto a primeira, podem ser puladas.
- Nada se perde se o modal for fechado no meio.
- Cadastro de perguntas frequentes padrão da empresa, reaproveitadas na criação.

## Fora do escopo

- Perguntas personalizadas no formulário de inscrição (`custom_fields`).
- Regulamento ou políticas padrão (texto modelo): fica para depois.
- Mudanças na tela de edição do evento (`/eventos/[id]`): ela continua com as
  abas atuais.
- Puxar as perguntas padrão para eventos que já existem.

## Anti-objetivos

- Perder o que foi preenchido por ter fechado o modal ou por queda de conexão.
- Uma pergunta padrão editada depois alterar, sem aviso, a página de eventos
  já criados.
- Gravar datas ou vagas fictícias só para destravar o rascunho: elas
  apareceriam como se fossem reais.

## Restrições

- O banco exige `name`, `slug`, `starts_at`, `ends_at` e `capacity > 0` em
  `events`, até em rascunho (`20260801091300_events.sql`).
- O upload de imagem (`uploadEventImage`) precisa do `eventId`: o caminho no
  Storage é `tenant/evento/...` e a RLS verifica isso.
- `saveEventContent` substitui programação, palestrantes e FAQ **por completo**
  a cada chamada, e publica uma nova versão de cada documento não vazio.
- Permissões: criar exige `event.create`; editar, `event.update`; publicar,
  `event.publish`. **O assistente exige `event.create` e `event.update`**: as
  etapas 2 a 9 gravam por `updateEvent`/`saveEventContent`. Sem as duas
  permissões, o botão "Novo evento" não aparece. Os perfis padrão
  (Administrador e Organizador) têm as duas. A área de padrões fica em Configurações (`settings.manage`).
- Multi-tenant: toda tabela nova leva `tenant_id`, com RLS no mesmo molde das
  tabelas de conteúdo (`20260801091300_events.sql`, bloco de políticas).

## Abordagens consideradas

- **A — O rascunho nasce na primeira etapa, e cada "Próximo" salva.**
  **Escolhida.** Fechar o modal no meio não perde nada: o rascunho fica na
  lista e pode ser continuado na edição. Reaproveita `createEvent`,
  `updateEvent`, `uploadEventImage` e `saveEventContent`. Custo: rascunhos
  abandonados aparecem na lista (podem ser arquivados).
- **B — Tudo em memória, e o evento é criado só no "Concluir".** Descartada:
  fechar o modal ou cair a conexão perde tudo, e as fotos teriam de subir
  depois da criação, com risco de evento pela metade.
- **Página longa em vez de modal.** Descartada: o pedido é de passo a passo, e
  um modal grande (tela cheia no celular) resolve isso.

## Desenho

### Etapas

| # | Etapa | Conteúdo | Pulável |
|---|-------|----------|---------|
| 1 | Essencial | nome, início, término, vagas | **não**, pois cria o rascunho |
| 2 | Descrição | descrição curta, descrição completa, endereço da página (slug) | sim |
| 3 | Local | CEP, endereço, nome do local, raio do check-in | sim |
| 4 | Fotos | banner e capa (envio imediato, como hoje) | sim |
| 5 | Programação | itens de horário | sim |
| 6 | Palestrantes | lista de palestrantes | sim |
| 7 | Perguntas frequentes | padrão + personalizadas | sim |
| 8 | Regulamento e políticas | regulamento, cancelamento, LGPD | sim |
| 9 | Revisar | pendências para publicar; prazo de inscrição e overbooking | — |

- **Etapa 1:** o slug é gerado do nome (`slugify`, como já acontece hoje) e
  pode ser trocado na etapa 2. "Próximo" chama `createEvent` com status
  `rascunho`. Ao voltar à etapa 1 depois disso, as alterações vão por
  `updateEvent`.
- **Navegação:** Voltar / Pular / Próximo. "Próximo" salva a etapa e avança;
  "Pular" avança sem salvar o que foi digitado nela. A lista lateral permite ir
  direto a qualquer etapa depois que o rascunho existe. Antes disso, só a
  etapa 1 está liberada. Cada etapa mostra se foi preenchida, pulada ou está
  pendente.
- **Etapa 9 (Revisar):** lista o que falta para publicar, usando
  `publishRequirements`. Botões: **Salvar rascunho** (fecha o modal e vai para
  `/eventos/[id]`) e **Publicar** (só com `event.publish` e sem pendências).
  Os campos de inscrição que hoje ficam na aba "Vagas" (prazo e overbooking)
  entram aqui.
- **Fechar o modal no meio:** se o rascunho já existe, um aviso curto ("O
  rascunho foi salvo. Você pode continuar pela edição do evento.") e o modal
  fecha, sem confirmação bloqueante. Antes da etapa 1 ser salva, fecha sem
  aviso.
- **Layout:** no desktop, modal largo com a lista de etapas à esquerda e o
  conteúdo à direita. No celular, tela cheia, com as etapas num indicador
  compacto no topo ("Etapa 5 de 9 · Programação") e os botões fixos no rodapé.
  O conteúdo rola dentro do modal.
- **Entrada:** o botão "Novo evento" em `/eventos` abre o modal.
  `/eventos/novo` passa a redirecionar para `/eventos?novo=1`, que abre o
  modal, para não quebrar links e favoritos.

### Etapa de perguntas frequentes

- **As perguntas padrão entram no evento quando o rascunho é criado** (etapa
  1), copiadas para `event_faqs` na ordem do cadastro. Pular a etapa 7, ou nem
  abri-la, mantém as padrão. "Padrão" significa exatamente isso.
- A etapa mostra as perguntas padrão da empresa, **marcadas** conforme o que
  está em `event_faqs` (no início, todas). O usuário desmarca as que não quer.
- A resposta de cada pergunta pode ser ajustada ali mesmo. O ajuste vale só
  para este evento, e o padrão não muda.
- "Adicionar pergunta" cria uma pergunta só deste evento. Para quem tem
  `settings.manage`, aparece a caixa **"Salvar também como padrão"**.
- Ao salvar, as marcadas e as personalizadas viram linhas em `event_faqs`
  (cópia, não referência). Padrões primeiro, na ordem do cadastro, depois as
  personalizadas, na ordem em que foram adicionadas.
- Se a empresa não tiver nenhuma pergunta padrão, a etapa mostra só as
  personalizadas e um link para Configurações → Perguntas padrão.

### Área de perguntas padrão

- Nova aba **Configurações → Perguntas padrão**, ao lado das existentes
  (Empresa, Usuários, Perfis, E-mails, WhatsApp).
- Permite criar, editar, excluir e reordenar. Valem as mesmas regras de
  tamanho do `faqSchema` (pergunta de 5 a 200 caracteres; resposta de 2 a
  1000).
- Excluir ou editar um padrão não altera eventos existentes, porque eles
  guardaram cópias. Essa explicação aparece na própria aba.

### Dados

- Tabela nova `faq_templates`: `id`, `tenant_id`, `question`, `answer`,
  `position`, `created_at`, `updated_at`. RLS por tenant: leitura para
  `event.create` ou `settings.read`; escrita para `settings.manage`.
- Nenhuma mudança em `events` nem em `event_faqs`.

## Deixado para quem constrói

- Se o salvamento por etapa usa `saveEventContent` com o estado completo
  mantido no cliente ou se ganha ações separadas por seção. Requisito: salvar
  a programação não pode apagar palestrantes nem FAQ já salvos, e salvar FAQ
  não pode publicar versões novas de documentos que não mudaram.
- A componentização do modal e quanto reaproveitar de `event-form.tsx` e
  `event-content-form.tsx`. Os campos e as validações devem ser os mesmos dos
  formulários atuais.
- O tratamento de slug duplicado na etapa 1. Ele deve resultar em mensagem
  clara ou em sufixo automático, nunca em erro genérico.
- Os testes: no mínimo os do schema de templates e da montagem da lista de
  perguntas (padrão marcadas + personalizadas) que vai para `event_faqs`.

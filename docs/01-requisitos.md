# 01 — Levantamento de Requisitos

## 1. Visão do produto

Plataforma SaaS onde **empresas (tenants)** publicam eventos, recebem inscrições por landing pages
públicas, emitem ingressos com QR Code assinado, controlam vagas e lista de espera, executam
check-in presencial (inclusive offline) e analisam tudo em dashboards e relatórios exportáveis.

**Diferenciais frente ao Sympla** que orientam as decisões técnicas:

| Diferencial                                                           | Por quê                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| QR Code com **assinatura assimétrica (Ed25519)**                      | Permite validação **offline** no PWA de check-in, sem internet no local |
| Check-in **offline-first** com sincronização e resolução de conflitos | Eventos em galpões/subsolos sem sinal são a maior dor operacional       |
| **Geofence** do local do evento (PostGIS) com auditoria de exceções   | Impede check-in remoto/fraude sem travar a operação                     |
| Controle de vagas **atômico no banco** (constraint + lock)            | Nunca vender/ocupar além da capacidade, mesmo com picos de concorrência |
| **Auditoria imutável** com IP, dispositivo e geolocalização           | Requisito de clientes corporativos e defesa jurídica                    |
| **LGPD nativa** (consentimento versionado, exportação, anonimização)  | Vender para jurídico/compliance de empresas médias e grandes            |

---

## 2. Personas e papéis

| Papel                        | Escopo                                   | Principais ações                                                                                                                                |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin** (plataforma) | Global                                   | Gerencia tenants, planos, saúde do sistema. Fora da RLS de tenant.                                                                              |
| **Administrador**            | Tenant inteiro                           | Tudo dentro da empresa: usuários, permissões, eventos, relatórios, configurações, faturamento                                                   |
| **Organizador**              | Eventos atribuídos                       | Cria/edita eventos, gerencia participantes, cancela inscrições, vê relatórios dos seus eventos                                                  |
| **Recepção**                 | Eventos atribuídos, apenas dia do evento | Scanner, busca, confirmação de entrada. Não vê dados financeiros nem edita evento                                                               |
| **Suporte**                  | Tenant                                   | Chamados, consulta de participantes, reenvio de e-mail/ingresso. Sem poder de exclusão                                                          |
| **Participante**             | Própria inscrição                        | Inscreve-se, acessa ingresso, baixa PDF, cancela, adiciona ao calendário. **Sem login obrigatório** (acesso por magic link / token do ingresso) |

> **Decisão:** participante **não** cria conta. Fricção zero na inscrição é o que converte.
> O acesso ao ingresso é feito por link assinado enviado por e-mail (+ reenvio autenticado por e-mail/CPF).

---

## 3. Requisitos funcionais

### RF-01 — Multi-tenancy

- RF-01.1 Todo registro de negócio pertence a um `tenant_id`.
- RF-01.2 Um usuário pode pertencer a **N** tenants com papéis diferentes (agências que operam para vários clientes).
- RF-01.3 Seletor de tenant ativo na topbar; o tenant ativo compõe o JWT.
- RF-01.4 RLS impede qualquer leitura/escrita cruzada entre tenants, mesmo com token válido de outro tenant.
- RF-01.5 Cada tenant tem branding próprio (logo, cor de destaque) aplicado **apenas nas páginas públicas e nos e-mails/PDF** — o painel administrativo mantém o Design System fixo.

### RF-02 — Autenticação e usuários

- RF-02.1 Login por e-mail/senha e magic link (Supabase Auth).
- RF-02.2 Convite de usuário por e-mail com papel pré-atribuído.
- RF-02.3 MFA (TOTP) opcional, obrigatória para Administrador quando o tenant ativar.
- RF-02.4 Recuperação de senha, troca de e-mail com confirmação dupla.
- RF-02.5 Sessão com refresh automático; logout global (revoga todas as sessões).
- RF-02.6 RBAC granular: papéis → permissões (`event.create`, `checkin.execute`, `report.export`, …).
- RF-02.7 Recepção/Organizador podem ser restritos a eventos específicos (`user_event_scopes`).

### RF-03 — Eventos

- RF-03.1 CRUD com os campos: nome, slug, descrição curta, descrição completa (rich text), imagem de capa, vídeo, galeria, categoria, tags, data/hora início, data/hora fim, fuso horário, local (nome, endereço completo, CEP), Google Maps, latitude, longitude, raio permitido (m), capacidade, inscrições abertas (bool), data limite de inscrição, organizador, contato (nome, telefone, e-mail), status.
- RF-03.2 Status: `rascunho` · `publicado` · `privado` (link direto) · `encerrado` · `cancelado`.
- RF-03.3 Slug único por tenant, gerado automaticamente e editável, com histórico de slugs (redirect 301).
- RF-03.4 Conteúdo da landing: cronograma (blocos por dia/horário), palestrantes, FAQ, regulamento, política de cancelamento, texto LGPD, patrocinadores (com níveis), contato.
- RF-03.5 Tipos de ingresso por evento (ex.: Inteira, VIP, Estudante) com capacidade e janela próprias — a soma respeita a capacidade do evento.
- RF-03.6 Duplicar evento (clona configurações, não clona inscrições).
- RF-03.7 Pré-visualização da landing antes de publicar.
- RF-03.8 Campos personalizados por evento no formulário de inscrição (texto, seleção, múltipla escolha, arquivo).

### RF-04 — Landing page pública

- RF-04.1 Hero com imagem/vídeo, banner, nome, descrição, data, hora, local, CTA de inscrição.
- RF-04.2 Contador de vagas restantes em tempo real.
- RF-04.3 Selo de status: **Aberto** · **Lotado** (com CTA de lista de espera) · **Encerrado** · **Cancelado**.
- RF-04.4 Seções: descrição completa, cronograma, palestrantes, mapa, FAQ, regulamento, LGPD, política de cancelamento, patrocinadores, contato.
- RF-04.5 SEO: metadata dinâmica, Open Graph gerado, JSON-LD `Event`, sitemap por tenant.
- RF-04.6 Acessibilidade AA e Core Web Vitals verdes (LCP < 2,5s no 4G).
- RF-04.7 Domínio próprio por tenant (fase 2) e subpath `/{tenant}/{evento}` na fase 1.

### RF-05 — Inscrição

- RF-05.1 Campos: nome, sobrenome, CPF, telefone, e-mail, cidade, estado, data de nascimento, empresa, cargo, como conheceu, aceite LGPD, aceite do regulamento.
- RF-05.2 Validação de CPF (dígito verificador), telefone BR, e-mail (com verificação de descartáveis), idade mínima configurável.
- RF-05.3 Bloqueio de inscrição duplicada: um CPF ativo por evento (constraint no banco).
- RF-05.4 Aceites gravados com versão do documento, data/hora, IP e user agent.
- RF-05.5 Ao concluir: cria inscrição → gera ingresso + QR Code assinado → envia e-mail → gera PDF →
  oferece "Adicionar ao Google Calendar" e "Adicionar ao Apple Calendar" (arquivo `.ics`).
- RF-05.6 Proteção anti-bot (rate limit por IP/CPF/e-mail + Turnstile/hCaptcha invisível).
- RF-05.7 Confirmação de e-mail opcional por evento (double opt-in antes de emitir o ingresso).
- RF-05.8 Inscrição para acompanhantes (múltiplos ingressos numa transação) — fase 2.

### RF-06 — Controle de vagas e lista de espera

- RF-06.1 Cada evento expõe: capacidade, ocupadas, restantes, presentes, cancelados, lista de espera.
- RF-06.2 Ao atingir a capacidade: inscrições fecham automaticamente e o CTA vira lista de espera.
- RF-06.3 Cancelamento libera a vaga na mesma transação.
- RF-06.4 Vaga liberada com lista de espera não vazia: convoca automaticamente o próximo (FIFO), com
  **reserva temporária** (janela configurável, padrão 24h) e e-mail de convocação.
- RF-06.5 Reserva expirada volta a vaga para a fila e convoca o próximo (job periódico).
- RF-06.6 Overbooking controlado, opcional por evento (percentual configurável).

### RF-07 — Ingresso e QR Code

- RF-07.1 QR Code exclusivo, jamais reutilizado, com token assinado digitalmente (Ed25519).
- RF-07.2 Página do ingresso: nome, evento, número do ingresso, QR Code, local, data, hora, mapa,
  botão baixar PDF, botão cancelar inscrição.
- RF-07.3 Validação verifica: assinatura, evento correto, status da inscrição, cancelamento,
  expiração, uso duplicado.
- RF-07.4 Ingresso já utilizado exibe **"INGRESSO JÁ UTILIZADO"** com data, hora e responsável pela primeira entrada.
- RF-07.5 Reemissão invalida o QR anterior e gera novo (com trilha de auditoria).

### RF-08 — Cancelamento

- RF-08.1 Participante cancela pela página do ingresso (dentro da política do evento).
- RF-08.2 Ao cancelar: invalida QR, libera vaga, atualiza estatísticas, dispara lista de espera.
- RF-08.3 Registra data, hora, IP, motivo (lista + texto livre), autor (participante ou operador).
- RF-08.4 Organizador pode cancelar em lote com motivo obrigatório e e-mail opcional.

### RF-09 — Check-in

- RF-09.1 Aplicação responsiva (notebook, tablet, celular) instalável como PWA.
- RF-09.2 Scanner de QR Code por câmera (BarcodeDetector nativo com fallback WASM).
- RF-09.3 Busca por CPF, nome e e-mail com resultado em < 300 ms.
- RF-09.4 Cartão do participante: nome, foto (quando houver), evento, status, tipo de ingresso, botão **Confirmar entrada**.
- RF-09.5 Registra data, hora, recepcionista, IP, dispositivo (user agent + fingerprint) e geolocalização.
- RF-09.6 Modo offline: valida assinatura localmente, enfileira em IndexedDB e sincroniza depois com idempotência.
- RF-09.7 Check-out opcional e check-in por sessão/atividade (eventos com trilhas) — fase 2.
- RF-09.8 Feedback sonoro e háptico distinto para sucesso, duplicado e inválido.

### RF-10 — Geolocalização

- RF-10.1 Captura latitude, longitude e precisão; enriquece com cidade, estado e país.
- RF-10.2 Compara com o local do evento via `ST_DWithin` contra o raio permitido.
- RF-10.3 Fora do raio: alerta visual, permissão de validação **mediante confirmação explícita** e registro em auditoria como exceção.
- RF-10.4 Painel de check-ins mostra mapa com os pontos e destaca as exceções.

### RF-11 — Dashboard

- RF-11.1 KPIs: eventos, eventos ativos, eventos encerrados, participantes, inscritos, check-ins, cancelamentos, taxa de comparecimento.
- RF-11.2 Gráficos: inscrições por dia, check-ins por hora, funil (inscrito → presente), comparativo entre eventos.
- RF-11.3 Mapa de participantes, eventos mais populares, participantes por cidade e por estado.
- RF-11.4 Filtros globais: período, evento, categoria, status. Atualização em tempo real no dia do evento.

### RF-12 — Gestão de participantes

- RF-12.1 Tabela com colunas configuráveis, ordenação, paginação por cursor e seleção em massa.
- RF-12.2 Filtros: nome, CPF, e-mail, cidade, estado, status, data, cancelado, presente, lista de espera.
- RF-12.3 Ações em massa: reenviar ingresso, cancelar, marcar presença manual, exportar, adicionar tag.
- RF-12.4 Exportação Excel, CSV e PDF respeitando filtros ativos e permissões (dados sensíveis mascarados sem permissão).
- RF-12.5 Ficha do participante com histórico completo (inscrições, e-mails, check-ins, cancelamentos).
- RF-12.6 Importação em massa por CSV com pré-validação e relatório de erros.

### RF-13 — Telas de check-ins

- RF-13.1 Lista de todos os check-ins: participante, evento, data, hora, recepcionista, dispositivo, geolocalização, mapa.
- RF-13.2 Painel de duplicidades e alertas (fora do raio, tentativa com ingresso cancelado, tentativa repetida).
- RF-13.3 Cancelamento não tem tela própria: motivo, autor, data e IP aparecem na linha do
  participante em `/participantes` quando a inscrição está cancelada. Check-in validado fora do
  raio aparece na mesma lista, sinalizado, com distância, motivo do forçamento e operador.

### RF-14 — Relatórios

- RF-14.1 Relatórios: inscritos, presentes, ausentes, cancelados, origem ("como conheceu"), cidade, estado, faixa etária, sexo (opcional), tempo entre publicação e inscrição, horários de check-in.
- RF-14.2 Exportação PDF, Excel e CSV; geração assíncrona com notificação quando > 5.000 linhas.
- RF-14.3 Relatórios agendados por e-mail (diário/semanal/pós-evento).

### RF-15 — Suporte

- RF-15.1 Chamados internos com título, descrição, categoria, prioridade, status, responsável.
- RF-15.2 Comentários (internos e visíveis), histórico de transições, anexos.
- RF-15.3 SLA por prioridade com destaque de vencidos.

### RF-16 — Notificações

- RF-16.1 Notificações in-app (sino + central) por: novo inscrito, evento lotado, cancelamento, novo check-in, convocação da lista de espera, mudança no evento, chamado de suporte.
- RF-16.2 Entrega em tempo real (Realtime), com marcação de lidas e preferências por usuário e por canal.

### RF-17 — E-mails transacionais

- RF-17.1 Templates: confirmação (com QR Code e PDF), cancelamento, lembrete (D-3 e D-1), convocação da lista de espera, mudança de evento, agradecimento pós-evento, reenvio de ingresso, convite de usuário.
- RF-17.2 Fila com retry exponencial, idempotência e log de entrega (enviado, aberto, falhou, bounce).
- RF-17.3 Templates personalizáveis por tenant (logo, cores, texto) com pré-visualização.

### RF-18 — PDF do ingresso

- RF-18.1 Contém logo do tenant, banner do evento, QR Code, nome, evento, número do ingresso, data, hora, local, mapa estático, regras e política de cancelamento.
- RF-18.2 Gerado uma vez e armazenado no Storage; entregue por URL assinada de curta duração.

### RF-19 — Auditoria

- RF-19.1 Registra criação, edição, exclusão, cancelamento, check-in, login, logout, mudança de permissão, exportação de dados e acesso a dado sensível.
- RF-19.2 Cada registro guarda: usuário, tenant, entidade, ação, diff (antes/depois), IP, dispositivo, geolocalização, data/hora e `request_id` de correlação.
- RF-19.3 Tabela append-only (sem UPDATE/DELETE via RLS), com particionamento mensal e retenção configurável.
- RF-19.4 Tela de consulta com filtros e exportação para o cliente corporativo.

### RF-20 — Storage

- RF-20.1 Buckets: `event-banners`, `event-gallery`, `event-videos`, `attendee-photos`, `tickets-pdf`, `reports`, `support-attachments`, `tenant-logos`.
- RF-20.2 Políticas por bucket com prefixo `{tenant_id}/…` e RLS de Storage.
- RF-20.3 Upload com validação de MIME e tamanho, geração de derivadas (thumb/webp) e URLs assinadas para conteúdo privado.

### RF-21 — API pública e webhooks

- RF-21.1 REST versionada (`/api/v1`) com autenticação por API key por tenant, escopos e rate limit.
- RF-21.2 Endpoints: eventos, inscrições, participantes, check-ins, estatísticas.
- RF-21.3 Webhooks com assinatura HMAC, retentativa exponencial e painel de entregas.
- RF-21.4 Documentação OpenAPI 3.1 gerada do código e publicada em `/docs/api`.

### RF-22 — PWA

- RF-22.1 Instalável, com ícones e splash; funciona offline no módulo de check-in.
- RF-22.2 Sincronização em background e indicador claro de estado (online/offline/pendências).

---

## 4. Requisitos não-funcionais

| ID     | Requisito              | Meta                                                                                   |
| ------ | ---------------------- | -------------------------------------------------------------------------------------- |
| RNF-01 | Performance da landing | LCP < 2,5s (4G), TTFB < 400ms com ISR                                                  |
| RNF-02 | Performance do painel  | Interação < 200ms; tabelas com 100k linhas paginadas por cursor                        |
| RNF-03 | Check-in               | Validação < 500ms online; < 100ms offline                                              |
| RNF-04 | Escala                 | 10k eventos/tenant, 1M inscrições/tenant, 500 check-ins/min por evento                 |
| RNF-05 | Disponibilidade        | 99,9% mensal no painel; landing servida com cache mesmo com backend degradado          |
| RNF-06 | Segurança              | RLS total, JWT curto, MFA, rate limit, headers CSP/HSTS, OWASP Top 10 coberto          |
| RNF-07 | LGPD                   | Consentimento versionado, exportação e anonimização sob demanda, retenção configurável |
| RNF-08 | Acessibilidade         | WCAG 2.1 AA nas páginas públicas e no check-in                                         |
| RNF-09 | Observabilidade        | Logs estruturados, `request_id`, métricas de fila, alertas de erro                     |
| RNF-10 | Testabilidade          | Cobertura ≥ 80% em regras de negócio (vagas, QR, check-in), E2E dos fluxos críticos    |
| RNF-11 | Manutenibilidade       | TypeScript strict, ESLint + Prettier, ADRs, zero duplicação de lógica                  |
| RNF-12 | i18n                   | Base pt-BR com infraestrutura de tradução pronta (sem strings hardcoded)               |
| RNF-13 | Backup                 | PITR do Supabase + export diário lógico; restauração testada por trimestre             |

---

## 5. Regras de negócio críticas

| ID    | Regra                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| RN-01 | `inscrições_confirmadas ≤ capacidade × (1 + overbooking)` — garantido por **constraint no banco**, não por código de aplicação |
| RN-02 | Um CPF só pode ter **uma** inscrição ativa por evento (índice único parcial)                                                   |
| RN-03 | Um ingresso só pode ter **um** check-in válido (índice único parcial); tentativas extras viram alerta, não erro silencioso     |
| RN-04 | Cancelamento é **irreversível** — reinscrição gera novo ingresso e novo QR                                                     |
| RN-05 | Ingresso cancelado, evento cancelado ou evento encerrado → QR inválido                                                         |
| RN-06 | Convocação da lista de espera é FIFO por `created_at`, com reserva expirável                                                   |
| RN-07 | Inscrições fecham automaticamente em: lotação, data limite atingida ou status ≠ publicado                                      |
| RN-08 | Check-in fora do raio exige confirmação explícita e gera exceção auditada                                                      |
| RN-09 | Auditoria é append-only: nenhum papel tem UPDATE/DELETE                                                                        |
| RN-10 | Exclusão de evento com inscrições é **soft delete** (arquivamento), nunca DELETE físico                                        |
| RN-11 | Toda operação de escrita crítica é idempotente por `idempotency_key`                                                           |

---

## 6. Fora de escopo (fase 1)

Pagamentos/checkout, split financeiro, emissão fiscal, marketplace de eventos, app nativo,
credenciamento com impressão de crachá, streaming, chat entre participantes, domínio próprio por
tenant. **O modelo de dados já nasce preparado** para pagamentos (`ticket_types` com preço, `orders`
previsto) para que a inclusão não exija migração destrutiva.

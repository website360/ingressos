# 09 — WhatsApp em escala (API oficial da Meta)

Este documento cobre como a confirmação de inscrição sai pelo WhatsApp oficial da empresa. A meta é aguentar 100 mil inscrições por evento em poucas horas, com **um único número** para todos os eventos.

- Design: `docs/superpowers/specs/2026-11-18-whatsapp-em-escala-design.md`.
- Plano: `docs/superpowers/plans/2026-11-18-whatsapp-em-escala.md`.

> A entrega efetiva depende da Meta: do nível de limite da conta, da vazão do número, da qualidade e da aprovação dos modelos. O sistema respeita esses limites e não os contorna. Não há rotação de números, nem envio por WhatsApp Web, Baileys ou QR Code.

---

## 1. Como funciona

```
inscrição (create_registration, uma transação)
  ├─ participante, inscrição, consentimentos, ingresso
  └─ gatilho no ingresso → whatsapp_notifications (status = pendente | bloqueada)
                                   │   ← mesma transação: ou tudo existe, ou nada
                                   ▼
worker (processo Node no PM2: ingressos-whatsapp)
  1. vagas = concorrência − envios em voo
  2. teto de destinatários únicos em 24 h
  3. fichas do limitador GLOBAL (whatsapp_rate_buckets, no Postgres)
  4. reivindica o mesmo tanto (FOR UPDATE SKIP LOCKED)
  5. lê nome/evento/token NA HORA → POST /{phone_number_id}/messages
     com biz_opaque_callback_data = id da notificação
                                   ▼
Meta → webhook /api/webhooks/meta (assinatura X-Hub-Signature-256)
  → whatsapp_webhook_events (cru, ANTES de processar)
  → situação avança: aceita → enviada → entregue → lida  (ou falhou)
```

A inscrição **nunca espera o WhatsApp**: a mensagem só nasce na fila. Se a Meta estiver fora do ar ou o worker estiver parado, a inscrição continua sendo aceita e a mensagem sai depois.

### Situações de uma notificação

| Situação      | Significado                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- |
| `pendente`    | Na fila. Se `next_attempt_at` estiver no futuro, aguarda uma nova tentativa.             |
| `processando` | Reivindicada por um worker.                                                              |
| `aceita`      | A Meta respondeu 200 com o wamid. **Ainda não é entrega.**                               |
| `enviada`     | Webhook `sent`.                                                                          |
| `entregue`    | Webhook `delivered`.                                                                     |
| `lida`        | Webhook `read`.                                                                          |
| `falhou`      | Definitiva: recusa da Meta ou tentativas esgotadas.                                      |
| `incerta`     | A requisição saiu e a resposta se perdeu. **Nunca é reenviada sozinha** (ver §6).        |
| `bloqueada`   | Sem consentimento, com opt-out ou com telefone inválido. O motivo fica em `block_reason`. |
| `cancelada`   | Cancelada pelo painel, ou a inscrição foi cancelada antes do envio.                      |

A situação **só avança**. Eventos que chegam fora de ordem (é comum o "lida" chegar antes do "entregue") e webhooks duplicados não rebaixam nada. Cada marco guarda a primeira hora em que foi visto.

## 2. Peças e arquivos

| Peça | Onde |
| ---- | ---- |
| Esquema: fila, modelos versionados, webhook cru, opt-out, limitador, batimento | `supabase/migrations/20260801094100_whatsapp_escala_schema.sql` |
| Funções do worker: fichas, claim, resultado, reconciliação, E.164 | `…094200_whatsapp_escala_funcoes.sql` |
| Enfileiramento na inscrição, convivência com a Evolution e RPCs do painel | `…094300_whatsapp_escala_fila.sql` |
| Processamento do webhook | `…094400_whatsapp_escala_webhook.sql` |
| Reversões (uma por migration) | `supabase/rollbacks/*.down.sql` |
| Worker | `worker/whatsapp/*` → `npm run worker:build` → `dist/worker.js` |
| Regras puras: erros da Meta, backoff, breaker, modelo, cliente HTTP | `shared/whatsapp/*` |
| Webhook | `src/app/api/webhooks/meta/route.ts` |
| QR do ingresso por link (cabeçalho do modelo) | `src/app/api/ingresso/[token]/qr.png/route.ts` |
| Health check | `src/app/api/health/whatsapp/route.ts` |
| Painel | Envios → aba **Fila do WhatsApp**; Configurações → WhatsApp → **Capacidade do número** |
| Consentimento no formulário | `src/features/registrations/*`, `shared/whatsapp/consent.ts` |
| Nginx (limites de requisição) | `deploy/nginx/ingressos.conf` |

**Convivência com a Evolution.** Com o provedor Evolution, nada mudou: as mensagens seguem por `outbox_jobs` e pelo cron. Com a Meta, nenhum job `whatsapp.*` nasce em `outbox_jobs`. Se sobrar algum antigo, o cron o encerra sem enviar, para a mesma confirmação não sair pelos dois caminhos. O e-mail não muda em nenhum dos dois casos.

## 3. Consentimento (opt-in) e opt-out

- **A caixa no formulário.** O texto é "Quero receber a confirmação e o ingresso pelo WhatsApp neste número.". Ela vem desmarcada, é opcional (a inscrição não depende dela) e só aparece quando a Meta está configurada e conectada. O servidor confere de novo, não confia no navegador.
- **O que fica gravado.** O aceite e a recusa vão para `consents`, com `document_type = 'whatsapp'`, a versão do texto (`WHATSAPP_CONSENT_VERSION`), IP, user agent, data e o telefone (`subject`).
- **Sem aceite, nada sai.** A notificação nasce `bloqueada / sem_consentimento`.
- **Opt-out** (`whatsapp_optouts`). Um número entra na lista quando:
  - a pessoa responde "SAIR", "PARAR", "STOP" ou "CANCELAR" (motivo `pedido`);
  - a Meta acusa número inexistente, código 131026 (motivo `invalido`);
  - a Meta acusa bloqueio pelo usuário, códigos 131049 e 131050 (motivo `bloqueio`);
  - o administrador inclui o número (motivo `manual`).
- **Efeito do opt-out.** As mensagens pendentes do número viram `bloqueada`.
- **Segunda via do ingresso.** O código não exige o aceite do ingresso (a pessoa pede o código na hora, para aquele número), mas respeita o opt-out.

## 4. Capacidade e proteções

Os valores ficam em Configurações → WhatsApp → **Capacidade do número**:

| Campo | O que é | Padrão |
| ----- | ------- | ------ |
| Mensagens por segundo | Vazão do **número inteiro**, somando todos os workers. Na Meta, o padrão é 80/s e pode chegar a 1000/s com aprovação. | 20 |
| Destinatários em 24 h | O **nível de limite** da conta na Meta (destinatários únicos numa janela móvel de 24 h). | 1000 |
| Envios simultâneos | Requisições em voo por worker. | 16 |

**Use os valores reais da conta.** Pôr mais do que a Meta permite não acelera nada: a Meta recusa e a qualidade do número cai. Com 1000 destinatários em 24 h, 100 mil confirmações levam 100 dias, por mais rápido que o sistema seja.

**Proteções automáticas:**

- **Freio da Meta.** Um 429, ou os códigos 130429, 131056, 80007 e 4, faz a mensagem voltar à fila sem gastar tentativa e corta a vazão pela metade por 60 s.
- **Breaker automático.** Mais de 20% de erro (sem contar os erros de destinatário), com ao menos 50 envios no último minuto, suspende os envios por 5 minutos.
- **Breaker manual.** Um erro sistêmico pausa tudo até alguém retomar no painel. Contam como sistêmicos:
  - token inválido (190) ou sem permissão (10 e 200);
  - modelo inexistente, pausado ou desativado (132001, 132015 e 132016);
  - conta bloqueada ou restrita (368, 131031 e 131042);
  - número não registrado (133010).
- **Webhook de qualidade e de conta.** Os eventos `phone_number_quality_update` (FLAGGED ou DOWNGRADE) e `account_update` (restrição) também pausam tudo.
- **Teto diário.** Ao atingir o teto, o worker para de pegar mensagens e o painel mostra o motivo. A fila volta a andar sozinha quando a janela de 24 h libera.
- **Pausa de emergência.** O botão no painel.

**Novas tentativas.** O backoff é `min(30 s × 2^tentativa, 15 min)` com jitter de 0,5× a 1,5×, até 5 tentativas.

## 5. Painel (Envios → Fila do WhatsApp)

- **Números do recorte (evento e período):** inscrições, na fila, aguardando nova tentativa, enviando, aceitas, enviadas, entregues (com o % de entrega), lidas, falhas (com o % de falha), incertas, bloqueadas, destinatários em 24 h, workers ativos e qualidade do número.
- **Velocidade.** É a taxa observada no último minuto.
- **"Esvazia em".** É a fila dividida pela taxa dos últimos 5 minutos, respeitando o teto de 24 h.
- **Mais antiga.** A idade da mensagem há mais tempo na fila.
- **Atualização.** O painel se atualiza a cada 5 s enquanto a aba está visível.
- **Ações** (exigem a permissão `settings.manage`, pedem confirmação com a contagem e ficam na auditoria):
  - pausar e retomar (retomar também fecha o breaker);
  - cancelar as pendentes do recorte;
  - reenviar as falhas elegíveis. Destinatário inexistente, bloqueio e opt-out ficam de fora. As incertas só entram se você marcar a opção, com aviso de que podem duplicar.
- **Sem disparo livre.** Não existe disparo para quem não está na fila.

## 6. Idempotência e "incerta"

- **Uma confirmação por inscrição.** A `dedupe_key` (`wa-confirmed-{inscrição}`) é única.
- **Nenhuma mensagem com dois donos.** O claim usa `FOR UPDATE SKIP LOCKED`: dois workers nunca pegam a mesma.
- **Antes do POST,** o worker grava `request_started_at`. Se ele morrer:
  - sem essa marca, a notificação volta para `pendente`. É seguro: a requisição não saiu;
  - com a marca, a notificação vira `incerta`. A Meta pode ter recebido.
- **Timeout ou conexão cortada depois do envio** também dão `incerta`.
- **Como a `incerta` se resolve sozinha.** A Meta devolve o id da notificação no webhook de status (`biz_opaque_callback_data`). Se a mensagem saiu de fato, o webhook a encontra e ela deixa de ser incerta. Se não chegar nada, o reenvio é decisão humana no painel.

## 7. Configuração na Meta (passo a passo)

1. No Gerenciador de Negócios:
   - verificar a empresa;
   - criar a conta do WhatsApp Business (WABA);
   - registrar o número na Cloud API.
2. Criar um usuário do sistema, gerar um **token permanente** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, e anotar também o **ID do número**.
3. No app da Meta, em Configurações básicas, copiar o **segredo do app**.
4. Cadastrar o modelo **`confirmacao_inscricao`**: categoria **Utilidade**, idioma pt_BR.
   - O texto exato está em Configurações → WhatsApp → modelos.
   - Cabeçalho de imagem. Na análise, envie qualquer QR de exemplo.
   - Corpo com 5 variáveis: nome, evento, data, horário e local.
   - Botão de URL dinâmico "Ver ingresso" apontando para `https://SEU_DOMINIO/ingresso/{{1}}`.
   - Sem nenhum conteúdo promocional. A aprovação como Utilidade **não é garantida**.
5. Webhook: URL `https://SEU_DOMINIO/api/webhooks/meta`, token de verificação = `META_VERIFY_TOKEN` (ou o da tela). Assinar os campos:
   - `messages`;
   - `message_template_status_update`;
   - `phone_number_quality_update`;
   - `account_update`.
6. No sistema, salvar as credenciais:
   - pela tela (Configurações → WhatsApp → API oficial);
   - ou pelas variáveis `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_PHONE_NUMBER_ID` e `META_VERIFY_TOKEN`, que têm precedência.
7. Ajustar a **capacidade** com o nível e a vazão reais da conta.
8. Quando a Meta aprovar a v2, a situação do modelo muda sozinha (`aprovado`, pelo webhook). Para torná-la a versão usada:

   ```sql
   update whatsapp_templates set active = (version = 2) where key = 'registration_confirmed';
   ```

   Enquanto isso, vale a v1 (`ingresso_confirmado`).

## 8. Operação

```bash
npm run worker:build                         # gera dist/worker.js
pm2 startOrReload ecosystem.config.js        # site + worker (ingressos-whatsapp)
pm2 logs ingressos-whatsapp                  # log JSON, telefone mascarado, sem token
curl -H "x-job-secret: $REVALIDATE_SECRET" http://127.0.0.1:3000/api/health/whatsapp
```

- **Health check.** Responde 503 quando há fila e nenhum worker deu sinal de vida em 60 s, quando a mensagem mais antiga espera há mais de 15 min sem pausa de propósito, ou quando o banco não responde. Pausa feita no painel responde 200, com `paused: true`.
- **Parada segura.** Ao receber SIGINT, o worker para de pegar mensagens, espera as que estão em voo (até 20 s) e sai (`kill_timeout` de 25 s no PM2).
- **Quantas instâncias.** Uma basta: o servidor tem 1 vCPU, e a concorrência se ajusta na tela. Mais instâncias dividem o trabalho sem passar do limite, porque o limitador é global.
- **Conexões com o banco.** O worker usa no máximo 4 conexões. Use a `DATABASE_URL` do pooler em **modo sessão** (porta 5432).
- **TLS com o banco.** Aponte `DATABASE_SSL_CA` para a CA do Supabase. Sem ela o worker não sobe, a menos que `DATABASE_SSL_INSECURE=1` registre que você aceitou o risco.
- **Limpeza.** Os eventos crus do webhook são apagados depois de 7 dias.

## 9. Migrations, deploy e rollback

**Ordem de aplicação:** 094100 → 094200 → 094300 → 094400. Antes de produção:

1. Validar no Supabase local: `npx supabase db reset` e depois `npm run test:int`.
2. Fazer backup (Supabase → Database → Backups).
3. Aplicar:

   ```bash
   node scripts/sql.mjs -f supabase/migrations/<arquivo>.sql   # um por vez, na ordem
   npm run db:types
   ```

> As migrations 094300 e 094400 redefinem `create_registration`, `request_ticket_code`, os gatilhos de confirmação e cancelamento e a view `v_message_log`. Elas não apagam dados.

**Deploy** (só depois das migrations):

1. `git pull`.
2. `bash scripts/deploy.sh`. O script faz o build do site e do worker e roda `pm2 startOrReload`.
3. Aplicar o nginx novo (`deploy/nginx/ingressos.conf`) com `sudo nginx -t && sudo systemctl reload nginx`.

**Rollback:**

1. Parar o envio: pausar no painel, ou `pm2 stop ingressos-whatsapp`.
2. Voltar o código para o commit anterior e rodar `deploy.sh`.
3. Banco, se necessário, nesta ordem: 094400 → 094300 → 094200 → 094100.

   ```bash
   node scripts/sql.mjs -f supabase/rollbacks/<arquivo>.down.sql
   ```

   A reversão da 094100 apaga as notificações do caminho novo. As anteriores devolvem as funções originais.
4. Para voltar à Evolution sem desfazer nada, troque o provedor na tela. Os gatilhos voltam a usar `outbox_jobs`.

## 10. Checklist de homologação

- [ ] Migrations aplicadas na ordem. `npm run db:types` sem diferenças inesperadas.
- [ ] `REVALIDATE_SECRET` de produção trocado. Hoje o cron do servidor usa o valor de desenvolvimento (`dev-revalidate-secret`). Atualizar o crontab junto.
- [ ] `DATABASE_SSL_CA` configurada no servidor.
- [ ] Worker no ar (`pm2 ls` mostra `ingressos-whatsapp` online). Health check responde 200.
- [ ] Teste de SIGINT no servidor Linux: `pm2 reload ingressos-whatsapp` com fila andando não deixa nada em `processando`.
- [ ] Credenciais Meta salvas e verificadas (o cartão de situação na tela).
- [ ] Webhook verificado na Meta (o GET responde o challenge). Os quatro campos assinados.
- [ ] Modelo `confirmacao_inscricao` aprovado como Utilidade e ativado (§7.8). Ou a v1 aprovada.
- [ ] Capacidade igual ao nível e à vazão reais da conta.
- [ ] **Teste real com 3 números internos.** Inscrição com a caixa marcada chega com QR e botão. Desmarcada não chega. "SAIR" bloqueia o número.
- [ ] Painel: os números batem; pausar e retomar funcionam.
- [ ] Nginx novo aplicado (`nginx -t`). O POST de inscrição em excesso recebe 429.
- [ ] Monitoramento externo apontado para `/api/health/whatsapp`.

## 11. Testes

```bash
npx supabase start                 # Postgres local (Docker)
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm test                           # unitários
npm run test:int                   # integração: banco local + Meta simulada
```

Nenhum teste fala com a Meta de verdade nem com o banco de produção: o harness recusa qualquer host que não seja localhost.

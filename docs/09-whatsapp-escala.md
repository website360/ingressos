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
  - a pessoa responde "SAIR", "PARAR" ou "STOP" (motivo `pedido`). "Cancelar" ficou de fora de propósito: quem responde isso pode estar querendo cancelar a inscrição;
  - a Meta acusa número sem WhatsApp, código 131026 (motivo `invalido`);
  - o administrador inclui o número (motivo `manual`).

  Os códigos 131049 e 131050 tratam de mensagens de **marketing**. Eles marcam aquela mensagem como falha, mas não bloqueiam o número para as confirmações.
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
8. Quando a Meta aprovar a v2, a situação do modelo muda sozinha (`aprovado`, pelo webhook). Para torná-la a versão usada, rode os dois comandos **nesta ordem** (só pode haver uma versão ativa de cada vez):

   ```sql
   update whatsapp_templates set active = false where key = 'registration_confirmed';
   update whatsapp_templates set active = true  where key = 'registration_confirmed' and version = 2;
   ```

   - Enquanto isso, vale a v1 (`ingresso_confirmado`).
   - O nome e o idioma digitados na tela de Configurações são copiados para a v1 automaticamente. O idioma vale para todas as versões.
   - As mensagens que já estão na fila saem pela versão **ativa** no momento do envio. Trocar de versão também destrava uma fila pausada por "modelo pausado ou desativado": basta retomar no painel.

## 8. Operação

```bash
npm run worker:build                         # gera dist/worker.js
pm2 startOrReload ecosystem.config.js        # site + worker (ingressos-whatsapp)
pm2 logs ingressos-whatsapp                  # log JSON, telefone mascarado, sem token
curl -H "x-job-secret: $REVALIDATE_SECRET" http://127.0.0.1:3000/api/health/whatsapp
```

- **Health check.** Responde 503 quando:
  - há fila e nenhum worker deu sinal de vida em 60 s;
  - a mensagem mais antiga pronta para sair espera há mais de 15 min, ou alguma está presa em `processando` há mais de 5 min;
  - o próprio sistema pausou os envios por erro sistêmico (`systemPaused`), ou o breaker por taxa de erro está aberto;
  - o banco não responde.

  Uma pausa feita por uma pessoa no painel responde 200, com `paused: true`.
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
- [ ] `DATABASE_SSL_CA` configurada no servidor. Sem ela (e sem `DATABASE_SSL_INSECURE=1`), o worker não sobe e o PM2 o reinicia a cada 5 s, **mesmo com o deploy dizendo "concluído"**. Confira `pm2 ls` e `pm2 logs ingressos-whatsapp`.
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

## 12. Resultados de carga (18/11/2026)

Ferramenta e método: `scripts/load/README.md`. Dados completos: `scripts/load/results/`.

**Ambiente.** Uma máquina de desenvolvimento (Intel Core Ultra 9 285K, 24 núcleos lógicos, 32 GB; Docker com 24 CPUs e 16 GB) rodando ao mesmo tempo:

- o Postgres do Supabase local;
- o worker real (`dist/worker.js`, processo separado);
- o gerador de carga;
- a Meta simulada.

**Parâmetros:**

- **Meta simulada:** vazão de 80 msg/s (o padrão da Meta), latência de 75 a 225 ms e **1% de respostas 500**, que viram nova tentativa.
- **Worker:** 32 envios simultâneos.
- **Gerador:** 16 conexões injetando inscrições.

| Perfil | Inscrições | Ritmo pedido / obtido | Latência da inscrição p50 / p95 / p99 | Aceitas pela Meta | Duplicadas | Pico da fila | Esvaziou após a última inscrição | Worker (pico) | Conexões no Postgres (pico) |
| ------ | ---------- | --------------------- | ------------------------------------- | ----------------- | ---------- | ------------ | ------------------------------- | ------------- | --------------------------- |
| 100 mil em 15 min | 100.000 (0 erros) | 111,1 / 111,1 por s | 3,5 / 7,2 / 59,9 ms | 100.000 | 0 | 28.963 | 535 s | 175 MB, 34% de CPU | 31 |
| ritmo de 100 mil/1 h (janela de 10 min) | 16.667 (0 erros) | 27,8 / 27,8 por s | 4,0 / 6,3 / 72,9 ms | 16.667 | 0 | 33 | 78 s ¹ | 168 MB, 15% | 31 |
| ritmo de 100 mil/3 h (janela de 10 min) | 5.556 (0 erros) | 9,3 / 9,3 por s | 4,2 / 5,4 / 28,9 ms | 5.556 | 0 | 15 | 67 s ¹ | 168 MB, 8% | 25 |

¹ O que sobra depois da última inscrição é só o 1% de erros simulados esperando a nova tentativa (backoff a partir de 60 s). O resto sai em tempo real.

### O que os números mostram

- **A inscrição não espera o WhatsApp.**
  - No pico de 15 min, entraram 111 inscrições por segundo durante os 15 minutos inteiros, com p95 de 7 ms. Enquanto isso a fila chegou a 29 mil mensagens.
  - A fila cresce porque entram 111 por segundo e a Meta aceita 80. Ela esvaziou cerca de 9 minutos depois da última inscrição: 100 mil confirmações em 24 minutos no total.
  - O pior caso de latência foi 3 s, uma vez, por disputa no `FOR UPDATE` do evento.
- **A vazão respeitou o limite global.**
  - Média de 70 msg/s, incluindo a espera dos reenvios.
  - Pico de 93 msg/s numa janela de 5 s. É o teto previsto: a vazão mais a capacidade do bucket (1 s de vazão) acumulada num momento ocioso.
  - Os 1.035 erros simulados (1%) foram reenviados e todos saíram.
- **Idempotência.** Zero mensagens duplicadas, e cada inscrição recebeu exatamente uma confirmação aceita.
- **Recursos.** O worker usou até 175 MB de memória e 34% de um núcleo. No Postgres foram até 31 conexões no total: o worker usa no máximo 4, e o resto é o gerador de carga.

### O que NÃO está provado

- **A vazão real do worker contra o Supabase hospedado.** Cada mensagem custa de 6 a 7 consultas ao banco, e o worker usa no máximo 4 conexões. Com o banco local, de latência quase zero, a média ficou em 70 msg/s. Contra o pooler do Supabase (alguns ms por consulta), o teto real do worker deve ser **menor que a vazão da Meta**. Medir em homologação antes de prometer números. Se precisar de mais, aumente o pool ou rode 2 instâncias: o limite continua global.

- **Desempenho em produção.** O servidor de produção tem 1 vCPU e 2 GB, e o Supabase hospedado tem limite de 60 conexões e latência de rede. Os números acima são de uma máquina local muito mais forte. Antes de um evento grande, vale repetir em homologação.
- **O `FOR UPDATE` no evento.** Ele serializa as inscrições de um mesmo evento e é o primeiro teto de inscrições por segundo. Localmente aguentou 111/s com folga. No Supabase hospedado, cada transação paga a latência de rede.
- **A entrega real.** Depende da Meta: nível de limite da conta, vazão aprovada, qualidade do número e aprovação do modelo. **No nível de 1 mil destinatários por dia, 100 mil confirmações levam 100 dias**, e nenhum código muda isso.
- **A borda.** Navegador, nginx e Next não entraram no teste: a inscrição foi chamada direto pela RPC.
- **Perfis longos.** Os perfis de 1 h e 3 h rodaram numa janela de 10 minutos no mesmo ritmo, não nas horas inteiras.

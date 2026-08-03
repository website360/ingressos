# 05 — Fluxos

## 1. Mapa de telas

```
PÚBLICO                          PAINEL (admin)                    PWA CHECK-IN
─────────────────────            ────────────────────              ─────────────────
/{tenant}                        /dashboard                        /checkin
/{tenant}/{evento}               /eventos                          /checkin/{evento}/scanner
/{tenant}/{evento}/inscricao     /eventos/novo                     /checkin/{evento}/busca
/{tenant}/{evento}/              /eventos/{id}/editar              /checkin/{evento}/fila
        inscricao/sucesso        /eventos/{id}/conteudo            /checkin/{evento}/resumo
/ingresso/{token}                /eventos/{id}/ingressos
/ingresso/{token}/cancelar       /eventos/{id}/participantes
                                 /eventos/{id}/checkins
AUTENTICAÇÃO                     /eventos/{id}/relatorios
/login                           /participantes
/esqueci-senha                   /checkins
/redefinir-senha                 /relatorios
/convite/{token}                 /suporte · /suporte/{id}
/mfa                             /notificacoes
                                 /suporte · /suporte/{id}
                                 /notificacoes
                                 /auditoria
                                 /configuracoes/*
                                 /perfil
```

### Navegação da sidebar (painel)

| Grupo       | Itens                    |
| ----------- | ------------------------ |
| Visão geral | Dashboard                |
| Eventos     | Eventos                  |
| Público     | Participantes            |
| Operação    | Check-ins                |
| Análise     | Relatórios               |
| Atendimento | Suporte, Notificações    |
| Sistema     | Auditoria, Configurações |

Cada item respeita a permissão do papel: o que o usuário não pode acessar **não aparece** (e a rota
é bloqueada no middleware **e** na RLS — três camadas, não uma).

---

## 2. Fluxo de usuários

```
                    ┌──────────── Convite por e-mail ────────────┐
                    ▼                                            │
Super Admin ──► cria tenant ──► define Owner ──► Owner convida usuários (papel + escopo)
                                                       │
       ┌───────────────────┬───────────────────┬───────┴─────────┐
       ▼                   ▼                   ▼                 ▼
  Administrador       Organizador          Recepção           Suporte
  tudo no tenant   eventos atribuídos   scanner e busca    chamados e consultas
```

**Login → tenant ativo:**

```
login → sessão criada → memberships do usuário
   ├─ 1 tenant  → define como ativo, segue para /dashboard
   └─ N tenants → tela de seleção → tenant ativo gravado em cookie + claim do JWT
                                     (TenantSwitcher permite trocar a qualquer momento)
```

Trocar de tenant **invalida o cache do React Query inteiro** — nenhum dado de uma empresa pode
aparecer sob outra, nem por um frame.

---

## 3. Fluxo de inscrição (participante)

```
Landing do evento
   │  status = publicado? inscrições abertas? dentro do prazo? tem vaga?
   ├─ Não ─► CTA muda: [Lotado → Lista de espera] [Encerrado] [Cancelado]
   ▼ Sim
Formulário (RHF + Zod, validação em tempo real)
   │  nome · sobrenome · CPF · telefone · e-mail · cidade · estado · nascimento
   │  empresa · cargo · como conheceu · campos personalizados
   │  [ ] Aceito a política de privacidade (LGPD)   ← obrigatório, versionado
   │  [ ] Aceito o regulamento                      ← obrigatório, versionado
   ▼
Submit → Server Action → rate limit + anti-bot → RPC api.create_registration
   │
   ├─ CPF já inscrito ──────────► "Você já está inscrito" + link para reenviar o ingresso
   ├─ Lotou durante a submissão ► oferta de lista de espera (1 clique, dados já preenchidos)
   ▼ Sucesso (transação única)
   attendee (upsert) · registration · ticket + QR assinado · consents · outbox
   │
   ▼
/inscricao/sucesso
   ├─ QR Code na tela
   ├─ Baixar PDF
   ├─ Adicionar ao Google Calendar   (link com parâmetros)
   ├─ Adicionar ao Apple Calendar    (arquivo .ics)
   └─ Link permanente do ingresso (também enviado por e-mail)

   Em paralelo (outbox): e-mail de confirmação + PDF anexo · notificação in-app ao organizador
                         · webhook `registration.created` · atualização do contador via Realtime
```

---

## 4. Fluxo de lista de espera

```
Evento lotado ──► participante entra na fila ──► posição FIFO + e-mail de confirmação da fila
                                                       │
Cancelamento / aumento de capacidade ──► vaga liberada │
                                                       ▼
                                   fn_promote_waitlist(evento, n_vagas)
                                                       │
                              convoca o próximo: status = convocado
                              reserva válida por N horas (padrão 24)
                                                       │
                         ┌─────────────────────────────┴───────────────────┐
                         ▼                                                 ▼
              aceita dentro do prazo                              prazo expira (job 15min)
              → inscrição criada, vaga consumida                  → status = expirado
              → status = convertido                               → convoca o próximo
```

---

## 5. Fluxo de cancelamento

```
Página do ingresso → [Cancelar inscrição]
   │  política do evento permite? (prazo mínimo, evento não iniciado)
   ▼
Modal: motivo (lista + texto livre) + confirmação explícita
   ▼
RPC api.cancel_registration  (uma transação)
   ├─ registration.status = cancelada
   ├─ ticket.status = cancelado, revoked_at = now()   ← QR inválido imediatamente
   ├─ seats_taken -1 (trigger)                        ← vaga liberada
   ├─ cancellations: data, hora, IP, motivo, autor, user agent
   ├─ auditoria
   └─ outbox: e-mail de cancelamento · notificação · promoção da lista de espera · webhook
   ▼
Tela de confirmação + opção de reinscrição (se houver vaga) — que gera um ingresso NOVO
```

---

## 6. Fluxo de check-in

### 6.1 Preparação (antes do evento)

```
Recepcionista abre o PWA → seleciona o evento
   → [Preparar modo offline]
       baixa: dados do evento · chave pública Ed25519 · lista de ingressos (id, hash do código,
              nome, CPF mascarado, tipo, status) · lista de revogados
       grava em IndexedDB · mostra "Pronto para operar offline — 1.284 ingressos, 12:04"
```

### 6.2 Operação

```
                    ┌─────────────── SCANNER ───────────────┐
                    │  câmera → BarcodeDetector (fallback   │
                    │  WASM) → token v1.<kid>.<payload>.<sig>│
                    └───────────────┬───────────────────────┘
                                    │
                      ┌─────────────┴─────────────┐
              ONLINE  ▼                           ▼  OFFLINE
        RPC api.checkin(token, contexto)   verificação local Ed25519
        ├─ assinatura inválida             ├─ assinatura inválida → INVÁLIDO
        ├─ evento errado                   ├─ consta em revogados → CANCELADO
        ├─ inscrição cancelada             ├─ já na fila local    → DUPLICADO
        ├─ ingresso já utilizado           └─ ok → grava local + fila de sync
        │     └─ retorna 1ª entrada:
        │        data, hora, recepcionista
        ├─ fora do geofence → alerta
        └─ sucesso
                                    │
                                    ▼
                       Cartão do participante
                       ┌────────────────────────────────────┐
                       │  [foto]  MARIA SILVA               │
                       │  CPF ***.456.789-**                │
                       │  Congresso de Tecnologia 2026      │
                       │  Ingresso VIP · #EVT-2026-000123   │
                       │  Status: VÁLIDO                    │
                       │  ─────────────────────────────     │
                       │       [ CONFIRMAR ENTRADA ]        │
                       └────────────────────────────────────┘
                       verde = ok · âmbar = duplicado · vermelho = inválido
                       som + vibração distintos por resultado
```

### 6.3 Busca manual (sem QR)

```
Campo único → detecta automaticamente CPF (só dígitos), e-mail (@) ou nome
   → busca com trigram/unaccent, debounce de 250ms, resultados em <300ms
   → lista com nome, CPF mascarado, tipo, status
   → seleciona → mesmo cartão do scanner → [Confirmar entrada]
   → o check-in manual é marcado com `source = busca` na auditoria
```

### 6.4 Geolocalização

```
Ao confirmar: navigator.geolocation (alta precisão, timeout 8s)
   → RPC recebe lat/lng/precisão
   → ST_DWithin(local do evento, local do check-in, raio permitido)
       ├─ dentro  → within_geofence = true, segue normal
       └─ fora    → alerta: "Check-in a 1.240 m do local do evento"
                    [Cancelar]  [Validar mesmo assim]
                             └─ exige motivo → override_confirmed = true
                                → auditoria como exceção → aparece no painel de alertas
   Permissão negada / sem GPS: registra `location = null` e sinaliza no painel (não bloqueia a operação)
```

### 6.5 Sincronização offline

```
Voltou a rede (ou Background Sync)
   → POST /api/v1/checkins/batch com idempotency_key por item
   → fn_checkin_batch aplica na ordem de checked_in_at
       ├─ ticket ainda válido → sucesso
       ├─ já tem check-in de outro dispositivo → primeiro (por timestamp) vence,
       │    segundo grava result='duplicado' + alerta
       └─ ingresso cancelado após o scan → grava result='cancelado' + alerta
   → UI mostra: "48 check-ins sincronizados · 2 conflitos" com detalhamento
```

---

## 7. Fluxo de gestão do evento (organizador)

```
Novo evento (wizard em 4 passos, salvando rascunho a cada passo)
  1. Básico       nome, slug, categoria, descrições, capa
  2. Data e local data/hora, fuso, endereço, mapa, coordenadas, raio do geofence
  3. Vagas        capacidade, tipos de ingresso, prazo, lista de espera, overbooking
  4. Conteúdo     cronograma, palestrantes, FAQ, patrocinadores, regulamento, LGPD
  → [Pré-visualizar]  →  [Publicar]
        publicar exige: capacidade > 0, data futura, local com coordenadas,
        regulamento e texto LGPD publicados
```

Após publicar: alterações de data, hora ou local disparam e-mail de "mudança no evento" para todos
os inscritos ativos (com confirmação explícita do organizador antes do disparo).

---

## 8. Estados da inscrição (máquina de estados)

```
                 ┌──────────► lista_espera ──convocado+aceite──┐
                 │                  │                          │
   (inscrição) ──┤                  └── expira ──► expirado    ▼
                 │                                       ┌─ pendente ─(double opt-in)─┐
                 └───────────────────────────────────────┘                            ▼
                                                                                 confirmada
                                                                                  │      │
                                                          check-in ───────────────┘      │
                                                          (presente)                     │
                                                                             cancelamento│
                                                                                         ▼
                                                                                    cancelada
             evento encerrado sem check-in ─────────────────────────────────► no_show
```

Transições proibidas (validadas na RPC e por trigger): `cancelada → confirmada` (exige nova
inscrição), qualquer transição a partir de `no_show`, `confirmada → lista_espera`.

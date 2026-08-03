# 07 — Segurança, Multi-Tenancy e LGPD

## 1. Modelo de ameaças (resumido)

| Ameaça                        | Vetor                               | Contramedida                                                            |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| Acesso cruzado entre empresas | JWT válido de outro tenant, IDOR    | RLS com `FORCE`, `tenant_id` em toda tabela, teste automatizado no CI   |
| Ingresso falsificado          | QR gerado por terceiro              | Assinatura Ed25519 com chave privada no Vault                           |
| Ingresso reutilizado          | Print/foto compartilhada            | Índice único parcial de check-in + tela de "já utilizado" com prova     |
| Check-in remoto/fraude        | Operador fora do local              | Geofence PostGIS + override auditado                                    |
| Enumeração de participantes   | `/ingresso/{token}` por força bruta | Token de 128 bits assinado, sem sequência, rate limit por IP            |
| Bot inflando inscrições       | Script no formulário público        | Rate limit por IP/CPF/e-mail, captcha invisível, idempotência           |
| Escalada de privilégio        | Chamada direta ao PostgREST         | Permissões avaliadas na RLS, não só na UI                               |
| Vazamento por Storage         | URL pública de PDF                  | Buckets privados + URLs assinadas de curta duração                      |
| XSS                           | Descrição rich text do evento       | Sanitização no servidor (allowlist) + CSP                               |
| SQL Injection                 | —                                   | PostgREST/parametrização; SQL dinâmico proibido fora de `format(%I/%L)` |
| Exfiltração via exportação    | Operador mal-intencionado           | Permissão específica, mascaramento e auditoria de `export`              |

---

## 2. Isolamento multi-tenant (defesa em profundidade)

```
1. UI          → itens de menu e botões escondidos por permissão
2. Middleware  → rota bloqueada por papel e tenant ativo
3. Server      → guards em Server Actions e Route Handlers
4. Banco (RLS) → última e principal barreira: nada passa sem tenant_id correspondente
```

As camadas 1–3 melhoram a experiência; **apenas a 4 é segurança**. Toda tabela nasce com:

```sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
ALTER TABLE t FORCE  ROW LEVEL SECURITY;
```

**Teste obrigatório no CI (pgTAP):** para cada tabela, um usuário do tenant A executa `SELECT`,
`INSERT`, `UPDATE` e `DELETE` mirando dados do tenant B e o resultado esperado é sempre
"0 linhas / erro". Uma tabela sem esse teste não passa no pipeline.

### Claims do JWT

O Custom Access Token Hook injeta `tenant_ids`, `active_tenant`, `role` e `perms`. Consequências:

- Nenhum JOIN em `memberships` a cada política → RLS rápida.
- Troca de tenant exige **refresh do token** (não basta trocar um cookie) — impossível forjar tenant ativo pelo cliente.
- Revogação de acesso invalida sessões do usuário (`logout global` ao remover membership).

---

## 3. RBAC

```
papel → role_permissions (customizável por tenant) → permissões
                    ⊕ user_permission_overrides (concessão/revogação pontual)
                    ⊗ user_event_scopes (restringe a eventos específicos)
```

Códigos de permissão por módulo: `event.read|create|update|delete|publish`,
`registration.read|create|cancel|export`, `checkin.execute|read|override`,
`report.read|export`, `user.manage`, `settings.manage`, `audit.read`, `support.*`.

Padrão por papel (seed): Administrador = tudo; Organizador = eventos e participantes dos seus
eventos; Recepção = `checkin.execute` + leitura mínima do participante; Suporte = leitura + reenvio
de ingresso + chamados.

`private.has_perm(code)` lê do claim (rápido) e revalida contra o banco quando o token está próximo
da expiração — equilíbrio entre performance e revogação imediata.

---

## 4. QR Code assinado

```
token = "v1" . key_id . base64url(payload) . base64url(sig)
payload (CBOR compacto) = { t: ticket_id, e: event_id, n: nonce(16B), x: exp }
sig = Ed25519_sign(payload, private_key[key_id])
```

| Propriedade              | Como é garantida                                                       |
| ------------------------ | ---------------------------------------------------------------------- |
| Autenticidade            | Assinatura Ed25519 verificável com a chave pública                     |
| Unicidade                | `nonce` de 128 bits + `tickets.code` UNIQUE                            |
| Validação offline        | Chave **pública** distribuída ao PWA                                   |
| Revogação                | Status no banco (online) / lista de revogados baixada (offline)        |
| Rotação                  | `key_id` no token; chaves antigas continuam verificáveis até expirarem |
| Não vazar dados pessoais | Payload contém apenas identificadores opacos, nenhum dado do titular   |

Chave privada: **somente** no Supabase Vault, acessível apenas pela Edge Function `sign-ticket`.
Nunca em variável de ambiente do frontend, nunca em coluna legível.

---

## 5. Autenticação e sessão

- JWT de acesso curto (1h) + refresh rotativo; cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- MFA TOTP opcional; obrigatória para Administrador quando o tenant ativar.
- Bloqueio progressivo após tentativas de login falhas (registrado em `audit.auth_events`).
- Logout global revoga todos os refresh tokens.
- Senhas: política mínima + verificação contra listas de senhas vazadas (Supabase Auth).

## 6. Rate limiting

| Alvo               | Limite                                    | Implementação                                                      |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| Inscrição pública  | 5/min por IP, 3/h por CPF, 3/h por e-mail | Tabela `rate_limits` + função no banco (funciona entre instâncias) |
| Login              | 10/min por IP, 5/min por conta            | Supabase Auth + camada própria                                     |
| API v1             | por API key e plano                       | `rate_limits` + headers `X-RateLimit-*`                            |
| Página do ingresso | 30/min por IP                             | Middleware                                                         |
| Check-in           | 300/min por operador                      | RPC                                                                |

## 7. Cabeçalhos e proteções do frontend

CSP restritiva (sem `unsafe-inline` em produção, nonce por requisição), HSTS com preload,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` liberando câmera e geolocalização apenas nas rotas de check-in.

CSRF: Server Actions do Next.js já validam origem; a API v1 usa Bearer token (não cookie), o que a
mantém fora do vetor CSRF. Rotas com cookie que alteram estado exigem token anti-CSRF explícito.

## 8. Validação

Zod em três pontos com **o mesmo schema**: cliente (UX), Server Action (confiança) e Edge Function
(borda). Além disso, o banco tem `CHECK`s próprios — uma validação que só existe em TypeScript não é
considerada validação.

## 9. Sanitização de conteúdo

Rich text do evento passa por allowlist no servidor (tags e atributos permitidos, sem `script`,
`style`, `on*`, `javascript:`). Uploads: MIME verificado pelo conteúdo (magic bytes), não pela
extensão; tamanho limitado por bucket; SVG rejeitado ou rasterizado.

## 10. Auditoria

Append-only garantido por trigger (`RAISE EXCEPTION` em UPDATE/DELETE) **e** por ausência de policy
de mutação. Correlação por `request_id`. Retenção configurável por tenant (mínimo legal de 6 meses),
com particionamento mensal e arquivamento das partições antigas.

## 11. LGPD

| Direito do titular    | Implementação                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Consentimento         | `consents` com tipo, versão do documento, data, IP e user agent                            |
| Acesso/portabilidade  | `fn_export_attendee_data` gera JSON+PDF com todos os dados do titular                      |
| Correção              | Autoatendimento na página do ingresso + edição auditada pelo operador                      |
| Exclusão/anonimização | `fn_anonymize_attendee`: substitui identificadores, preserva agregados estatísticos        |
| Retenção              | Job diário anonimiza participantes de eventos encerrados há mais de N meses (configurável) |
| Minimização           | Campos sensíveis opcionais (sexo, foto); CPF mascarado por padrão na UI                    |
| Transparência         | Texto LGPD versionado por evento, exibido e aceito no ato da inscrição                     |
| Segurança             | Criptografia em trânsito e repouso (Supabase), acesso a dado sensível auditado             |

**Papel de tratamento:** o tenant é o controlador; a plataforma é a operadora. O contrato e a
documentação refletem isso, e a auditoria existe para sustentar essa separação.

## 11.1 Riscos aceitos e documentados

| Item                             | Por que é aceito                                                                                                                                                                                                                                                | Reavaliar em                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `public.spatial_ref_sys` exposta | Catálogo EPSG do PostGIS, somente leitura, sem dado de tenant. Não é corrigível no Supabase gerenciado: a tabela pertence a `supabase_admin`, o PostGIS não é relocável e as migrations rodam como `postgres` (não superusuário). Aparece nos avisos do painel. | Sprint 6 — em base nova, `create extension postgis with schema extensions` resolve na origem |

Todo risco aceito vira linha nesta tabela, com motivo e data de reavaliação. Aviso de segurança
sem dono e sem prazo vira ruído, e ruído é o que faz o alerta seguinte ser ignorado.

## 12. Segredos

| Segredo                       | Onde vive                                 | Nunca                                 |
| ----------------------------- | ----------------------------------------- | ------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`   | Servidor (Cloudways env) e Edge Functions | Bundle do cliente                     |
| Chave privada Ed25519         | Supabase Vault                            | Env do frontend, banco em texto claro |
| API key do provedor de e-mail | Edge Function secrets                     | Repositório                           |
| Segredos de webhook           | `webhooks.secret` (criptografado)         | Log                                   |

Rotação documentada em runbook; `.env.example` no repositório contém apenas nomes, jamais valores.

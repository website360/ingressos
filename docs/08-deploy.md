# 08 — Deploy e Infraestrutura

## 1. Topologia

```
GitHub (main / develop)
   │  push
   ├──► GitHub Actions ──► supabase db push (migrations) + deploy das Edge Functions
   │                        └─► Supabase (Postgres, Auth, Storage, Realtime, Functions)
   │
   └──► Cloudways Git Deploy ──► build Next.js standalone ──► PM2 reload ──► Nginx (SSL, Brotli)
```

## 2. Cloudways — servidor de aplicação

**Requisitos:** servidor com Node.js 20 LTS, 2 vCPU / 4 GB (produção inicial), PM2, Nginx, SSL
Let's Encrypt com renovação automática.

`next.config.ts` usa `output: "standalone"` — o build produz um servidor Node autocontido, sem
depender de `node_modules` completo em produção.

**Pipeline no servidor** (`scripts/deploy.sh`, executado pelo hook de deploy do Cloudways):

```bash
set -e
npm ci --omit=dev --include=dev        # dev deps necessárias só para o build
npm run build                          # next build (standalone)
rm -rf .next/standalone/public && cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pm2 reload ecosystem.config.js --update-env   # zero downtime
```

**`ecosystem.config.js`:**

```js
module.exports = {
  apps: [
    {
      name: "ingressos",
      script: ".next/standalone/server.js",
      instances: "max", // cluster: 1 processo por vCPU
      exec_mode: "cluster",
      env: { NODE_ENV: "production", PORT: 3000, HOSTNAME: "127.0.0.1" },
      max_memory_restart: "512M",
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      time: true,
    },
  ],
};
```

**Nginx (vhost do Cloudways):**

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;   # obrigatório: o app lê o IP real para auditoria
  proxy_cache_bypass $http_upgrade;
  proxy_read_timeout 60s;
}
location /_next/static/ { proxy_pass http://127.0.0.1:3000; add_header Cache-Control "public, max-age=31536000, immutable"; }
location /_next/image/  { proxy_pass http://127.0.0.1:3000; add_header Cache-Control "public, max-age=86400"; }

brotli on; brotli_comp_level 5;
brotli_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
gzip on; gzip_vary on; gzip_comp_level 5;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
```

> **Atenção:** o IP registrado na auditoria e no rate limit vem de `X-Forwarded-For`. Sem o header
> configurado, todos os check-ins ficam com o IP do proxy — auditoria inútil. Validado ainda na Sprint 1.

**Cuidados específicos do Cloudways:**

- ISR grava em `.next/cache` — o diretório precisa persistir entre deploys (bind em pasta fora do release) ou usar cache handler externo.
- Timezone do servidor em UTC; conversão sempre pelo `timezone` do evento.
- Firewall liberando apenas 80/443; SSH por chave.
- Monitoramento: PM2 + healthcheck externo em `/api/health` a cada minuto.

## 3. Supabase

Três projetos: **dev** (local via `supabase start`), **staging** e **produção**.

```bash
supabase link --project-ref <ref>
supabase db push                    # aplica migrations
supabase functions deploy <fn>      # Edge Functions
supabase secrets set RESEND_API_KEY=...
```

Configuração de produção: PITR habilitado, connection pooler (Supavisor, modo transaction) para o
Next.js, `pg_cron` e `pg_net` habilitados, buckets criados por migration, Auth com SMTP próprio e
templates personalizados, URLs de redirecionamento restritas aos domínios oficiais.

## 4. CI/CD (GitHub Actions)

| Workflow        | Gatilho                         | Passos                                                                                     |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `ci.yml`        | PR                              | lint · typecheck · testes unitários · `supabase db reset` + pgTAP · build · E2E Playwright |
| `db.yml`        | push em `main`                  | `supabase db push` (staging → produção com aprovação manual)                               |
| `functions.yml` | push em `supabase/functions/**` | deploy das Edge Functions                                                                  |
| `deploy.yml`    | push em `main`                  | dispara o deploy do Cloudways via API + smoke test em `/api/health`                        |

Regra: **migration nunca sobe depois do código que depende dela.** A ordem do pipeline é
banco → funções → aplicação, e mudanças destrutivas são divididas em duas releases.

## 5. Variáveis de ambiente

```bash
# Público (exposto ao navegador)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_TICKET_PUBLIC_KEY=       # chave pública Ed25519 (verificação offline)

# Servidor
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
DATABASE_URL=                         # pooler, para migrations/scripts
RESEND_API_KEY=
EMAIL_FROM=
GEOCODING_API_KEY=
TURNSTILE_SECRET_KEY=
REVALIDATE_SECRET=                    # webhook de invalidação de ISR
SENTRY_DSN=
NODE_ENV=production
```

`.env.example` versionado apenas com os nomes. Segredos moram no painel do Cloudways e nos secrets
do GitHub/Supabase.

## 6. Ambientes

| Ambiente | Frontend                 | Banco                        | Dados                 |
| -------- | ------------------------ | ---------------------------- | --------------------- |
| Local    | `npm run dev`            | `supabase start` (Docker)    | `seed.sql`            |
| Staging  | Cloudways (app separado) | Projeto Supabase de staging  | Seed + massa de teste |
| Produção | Cloudways                | Projeto Supabase de produção | Dados reais           |

## 7. Rollback

| Camada         | Procedimento                                                                     |
| -------------- | -------------------------------------------------------------------------------- |
| Aplicação      | `pm2 reload` apontando para o release anterior (releases mantidos por 5 versões) |
| Banco          | Migration de reversão versionada; PITR como último recurso                       |
| Edge Functions | `supabase functions deploy` da tag anterior                                      |
| ISR            | `revalidateTag` forçado após rollback para limpar páginas com conteúdo novo      |

Runbook completo em `docs/runbooks/` (criado na Sprint 10), com os cenários: fila de e-mail travada,
pico de inscrições, evento com check-in offline não sincronizado, suspeita de vazamento.

## 7.1 Tarefas agendadas (cron)

O worker da fila precisa ser chamado periodicamente. No Cloudways, em
**Application → Cron Job Management**:

```bash
# A cada minuto: processa e-mails e webhooks pendentes
* * * * * curl -fsS -X POST -H "x-job-secret: $REVALIDATE_SECRET" https://SEU_DOMINIO/api/jobs/outbox > /dev/null
```

O endpoint exige o cabeçalho `x-job-secret` — ele escreve no banco com service role e não pode ficar
aberto. Sem `RESEND_API_KEY` e `EMAIL_FROM` configurados, os jobs falham e voltam para a fila com
backoff exponencial (1, 2, 4, 8, 16 min) até `max_attempts`; nada é perdido, e a fila fica visível
em _Configurações → E-mails_.

Alternativa sem cron externo: `pg_cron` chamando a mesma rota com `pg_net`, o que mantém o
agendamento junto do banco e versionado em migration.

## 8. Observabilidade

- Logs estruturados JSON com `request_id`, `tenant_id` e `user_id` (sem dado pessoal).
- Sentry para erros do frontend e das Server Actions.
- Painel administrativo com métricas da fila (`outbox_jobs`) e de e-mails.
- Alertas: healthcheck falhando, fila com job > 5 min pendente, taxa de erro > 1%, banco > 80% de conexões.

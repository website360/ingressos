# Deploy num Droplet DigitalOcean

Ensaio do ambiente de produção. O desenho é o mesmo que o Cloudways vai usar
(`docs/08-deploy.md`): Nginx na frente, Next.js standalone em `127.0.0.1:3000`
sob PM2. O que quebrar aqui, quebraria lá.

O banco é externo (Supabase) — nada de Postgres no servidor.

## Droplet

|              |                                                    |
| ------------ | -------------------------------------------------- |
| Imagem       | Ubuntu 24.04 LTS                                   |
| Tamanho      | 2 vCPU / 4 GB (o `next build` é o pico de memória) |
| Autenticação | Chave SSH — nunca senha                            |

Com 2 GB o build costuma ser morto pelo OOM killer sem mensagem clara. O
`provision.sh` cria 2 GB de swap por causa disso, mas swap não substitui RAM:
se o build ficar lento demais, suba o droplet.

## 1. Provisionar (uma vez, como root)

```bash
ssh root@<ip> 'bash -s' < deploy/provision.sh
```

Instala Node 20, PM2, Nginx e o firewall (só 22/80/443), cria o usuário
`ingressos` e registra o PM2 no boot.

O vhost precisa ser copiado a partir do repositório:

```bash
scp deploy/nginx/ingressos.conf root@<ip>:/etc/nginx/sites-available/ingressos
ssh root@<ip> 'nginx -t && systemctl reload nginx'
```

## 2. Primeiro deploy (como `ingressos`)

```bash
ssh ingressos@<ip>
git clone <url-do-repo> app && cd app
cp .env.example .env.local && nano .env.local
ISR_CACHE_DIR=/home/ingressos/shared/next-cache bash scripts/deploy.sh
```

O `scripts/deploy.sh` faz `npm ci`, build, cópia dos estáticos para dentro do
bundle standalone (sem isso o site sobe sem CSS), o link do cache de ISR e o
`pm2 reload` sem downtime — terminando num smoke test em `/api/health`.

Variáveis obrigatórias em `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` (a URL pública real),
`SUPABASE_SERVICE_ROLE_KEY` e `REVALIDATE_SECRET`.

## 3. HTTPS

```bash
ssh root@<ip>
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d seudominio.com.br
```

Antes disso, aponte o domínio para o IP do droplet e troque o `server_name`
no vhost.

## 4. Fila de e-mails

`/api/jobs/outbox` processa a fila de efeitos colaterais em lotes. Precisa de
alguém chamando — no `crontab -e` do usuário `ingressos`:

```cron
* * * * * curl -fsS -H "x-job-secret: SEU_REVALIDATE_SECRET" http://127.0.0.1:3000/api/jobs/outbox > /dev/null
```

O endpoint escreve com a service role e é protegido pelo segredo compartilhado
`REVALIDATE_SECRET`; sem o cabeçalho, responde 401.

## Deploys seguintes

```bash
ssh ingressos@<ip> 'cd app && git pull && ISR_CACHE_DIR=/home/ingressos/shared/next-cache bash scripts/deploy.sh'
```

## O que verificar depois de subir

- `curl -fsS https://<dominio>/api/health` responde `ok`
- A home carrega **com CSS** — se vier sem estilo, a cópia de `.next/static`
  falhou
- Um check-in registra o IP real, não `127.0.0.1` — é o teste do
  `X-Forwarded-For` no vhost
- Upload de banner acima de 1 MB não devolve 413 (`client_max_body_size`)
- `pm2 logs ingressos` sem erro recorrente; `pm2 status` estável após 10 min

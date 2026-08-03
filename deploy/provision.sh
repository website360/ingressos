#!/usr/bin/env bash
# =============================================================================
# Provisionamento de um Droplet Ubuntu 24.04 para o Ingressos.
#
# Roda UMA vez, como root, num servidor recém-criado. O deploy do dia a dia é
# o scripts/deploy.sh, executado depois pelo usuário da aplicação.
#
#   ssh root@<ip> 'bash -s' < deploy/provision.sh
#
# O alvo é o mesmo desenho do Cloudways (docs/08): Nginx na frente, Next.js
# standalone em 127.0.0.1:3000 sob PM2. O que se aprender aqui vale lá.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-ingressos}"
APP_DIR="/home/${APP_USER}/app"
NODE_MAJOR=20

echo "▸ Pacotes base..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx ufw fail2ban unattended-upgrades

echo "▸ Node ${NODE_MAJOR} (NodeSource)..."
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y -qq nodejs
node --version

echo "▸ PM2..."
npm install -g pm2@latest

# O `next build` chega a pedir ~1,5 GB. Num droplet de 2 GB ele morre sem
# mensagem clara — o processo some e o deploy falha no passo seguinte. A swap
# não substitui RAM, mas evita esse fim silencioso.
if [ ! -f /swapfile ]; then
  echo "▸ Swap de 2 GB (o build de produção é o pico de memória da máquina)..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q -w vm.swappiness=10
fi

echo "▸ Usuário da aplicação..."
if ! id "$APP_USER" > /dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
  # A chave que abriu esta sessão serve para o usuário da aplicação também.
  mkdir -p "/home/${APP_USER}/.ssh"
  cp /root/.ssh/authorized_keys "/home/${APP_USER}/.ssh/authorized_keys" 2>/dev/null || true
  chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}/.ssh"
  chmod 700 "/home/${APP_USER}/.ssh"
fi
mkdir -p "$APP_DIR" "/home/${APP_USER}/shared/next-cache"
chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}"

echo "▸ Firewall (só 22, 80 e 443)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "▸ Nginx..."
install -m 644 "$(dirname "$0")/nginx/ingressos.conf" /etc/nginx/sites-available/ingressos 2>/dev/null ||
  echo "  (rode a partir do repositório para copiar o vhost; senão copie à mão)"
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/ingressos /etc/nginx/sites-enabled/ingressos
nginx -t && systemctl reload nginx

echo "▸ PM2 no boot..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" | tail -1 | bash

cat <<FIM

✓ Servidor pronto.

Próximos passos, como ${APP_USER}:

  su - ${APP_USER}
  git clone <url-do-repo> app && cd app
  cp .env.example .env.local && nano .env.local     # segredos do Supabase
  ISR_CACHE_DIR=/home/${APP_USER}/shared/next-cache bash scripts/deploy.sh

Depois, como root, o certificado:

  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d seudominio.com.br

E o cron da fila de e-mails (a cada minuto, como ${APP_USER}):

  * * * * * curl -fsS -H "x-job-secret: \$REVALIDATE_SECRET" http://127.0.0.1:3000/api/jobs/outbox > /dev/null

FIM

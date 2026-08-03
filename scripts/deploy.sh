#!/usr/bin/env bash
# =============================================================================
# Deploy no Cloudways — executado pelo hook de deploy após o git pull.
# docs/08-deploy.md
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CACHE_DIR="${ISR_CACHE_DIR:-$APP_DIR/../shared/next-cache}"

cd "$APP_DIR"

echo "▸ Node: $(node --version)"

echo "▸ Instalando dependências..."
npm ci

echo "▸ Build (standalone)..."
npm run build

# O standalone não copia `public` nem `.next/static` — sem isto, o site sobe sem CSS.
echo "▸ Copiando estáticos para o bundle standalone..."
rm -rf .next/standalone/public
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static

# O cache de ISR precisa sobreviver entre releases (docs/08, "Cuidados").
echo "▸ Vinculando cache de ISR persistente..."
mkdir -p "$CACHE_DIR"
rm -rf .next/standalone/.next/cache
ln -s "$CACHE_DIR" .next/standalone/.next/cache

echo "▸ Recarregando PM2 (zero downtime)..."
if pm2 describe ingressos > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "▸ Smoke test..."
sleep 3
for attempt in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:3000/api/health" > /dev/null; then
    echo "✓ Deploy concluído e saudável."
    exit 0
  fi
  echo "  tentativa $attempt falhou, aguardando..."
  sleep 3
done

echo "✗ Healthcheck falhou após o deploy. Verifique: pm2 logs ingressos"
exit 1

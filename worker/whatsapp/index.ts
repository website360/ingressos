/**
 * Entrada do worker do WhatsApp (processo separado do Next, sob o PM2).
 *
 *   npm run worker:build   → dist/worker.js
 *   pm2 start ecosystem.config.js --only ingressos-whatsapp
 *
 * Variáveis: DATABASE_URL (pooler em modo sessão), NEXT_PUBLIC_APP_URL (para
 * o link do QR), e opcionalmente META_ACCESS_TOKEN / META_PHONE_NUMBER_ID
 * (têm precedência sobre a credencial salva na tela), META_GRAPH_VERSION,
 * WORKER_ID e DATABASE_SSL_CA. O PM2 injeta o .env.local (ecosystem.config.js).
 */
import { startWorker } from "./dispatcher";
import { jsonLogger } from "./log";
import { reprocessPendingWebhooks } from "./webhooks";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!databaseUrl || !appUrl) {
    jsonLogger("error", "DATABASE_URL e NEXT_PUBLIC_APP_URL são obrigatórias");
    process.exit(1);
  }

  const worker = await startWorker({
    databaseUrl,
    appUrl,
    workerId: process.env.WORKER_ID,
    reprocessWebhooks: reprocessPendingWebhooks,
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    jsonLogger("info", "sinal recebido; terminando envios em voo", { signal });
    worker
      .stop()
      .then(() => process.exit(0))
      .catch((error: Error) => {
        jsonLogger("error", "falha ao parar o worker", { error: error.message });
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  jsonLogger("error", "promessa rejeitada sem tratamento", { error: String(reason) });
});

void main();

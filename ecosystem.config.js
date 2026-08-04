const fs = require("node:fs");
const path = require("node:path");

/**
 * Lê um arquivo no formato dotenv e devolve um objeto.
 *
 * Existe porque o bundle standalone NÃO leva o `.env.local`: o `next build`
 * copia para `.next/standalone` apenas o servidor e um node_modules mínimo.
 * Sem esta leitura, o processo sobe com as três variáveis declaradas abaixo e
 * mais nada — sem SUPABASE_SERVICE_ROLE_KEY, sem REVALIDATE_SECRET.
 *
 * E a falha é silenciosa, que é o pior tipo: a home continua funcionando,
 * porque as NEXT_PUBLIC_* já foram embutidas no bundle durante o build. O que
 * quebra é tudo que escreve no banco — inscrição, check-in, fila de e-mails —
 * e só na hora em que alguém tenta usar.
 */
function lerDotenv(arquivo) {
  const caminho = path.join(__dirname, arquivo);
  if (!fs.existsSync(caminho)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .filter((linha) => linha.trim() && !linha.trim().startsWith("#") && linha.includes("="))
      .map((linha) => {
        const corte = linha.indexOf("=");
        return [
          linha.slice(0, corte).trim(),
          linha
            .slice(corte + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

/**
 * PM2 — execução do Next.js standalone no Cloudways (docs/08, seção 2).
 * Reload em modo cluster garante deploy sem downtime.
 */
module.exports = {
  apps: [
    {
      name: "ingressos",
      script: ".next/standalone/server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        // O arquivo primeiro; as três abaixo mandam, porque descrevem como o
        // processo roda e não dependem do ambiente de quem editou o .env.local.
        ...lerDotenv(".env.local"),
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1",
        /*
          O servidor roda em UTC (docs/08). Sem esta linha, `formatDate` — que
          usa o fuso do sistema — renderiza 12:00 no HTML e o navegador do
          participante mostra 09:00 depois de hidratar: divergência que o React
          acusa (#418) e, pior, horário errado no HTML que o buscador indexa e
          que aparece antes de o JavaScript rodar.

          É mitigação, não cura: acerta para quem está no Brasil, que é o
          público, mas visitante em outro fuso continua vendo o horário
          convertido para o dele. A correção de verdade é formatar sempre pelo
          `timezone` do evento — a função `formatInTimezone` já existe para
          isso e é o que docs/08 manda fazer.
        */
        TZ: "America/Sao_Paulo",
      },
      max_memory_restart: "512M",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      time: true,
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: false,
    },
  ],
};

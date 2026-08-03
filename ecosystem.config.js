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
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1",
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

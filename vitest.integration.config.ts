import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Testes de integração: Postgres do Supabase LOCAL + Meta simulada.
 *
 * Nunca rodam contra produção — `tests/support/db.ts` recusa qualquer host que
 * não seja local. Precisa de `npx supabase start` e de `TEST_DATABASE_URL`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Os testes dividem um banco só (a empresa é única): nada de paralelismo
    // entre arquivos.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // As rotas do Next falam com o Supabase LOCAL. Estas são as chaves de
    // demonstração que o `supabase start` usa em toda máquina (públicas).
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
      REVALIDATE_SECRET: "segredo-de-teste-do-cron",
      NEXT_PUBLIC_APP_URL: "https://ingressos.example",
    },
  },
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "./tests/support/empty.ts"),
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "./shared"),
    },
  },
});

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
    // Os testes dividem um banco só (a empresa é única): nada de paralelismo
    // entre arquivos.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "./shared"),
    },
  },
});

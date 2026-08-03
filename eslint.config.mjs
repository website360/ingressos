import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "supabase/functions/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Regra anti-duplicação (docs/04): apenas repositories falam com o Supabase.
              group: ["**/lib/supabase/client", "**/lib/supabase/server"],
              importNames: ["createClient", "createServerClient"],
              message:
                "Acesso a dados deve passar por src/repositories/*. Ver docs/04-estrutura-pastas.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // A própria camada de dados e a infraestrutura podem importar os clients.
    files: [
      "src/repositories/**/*.ts",
      "src/lib/supabase/**/*.ts",
      "src/lib/auth/**/*.ts",
      "src/providers/**/*.tsx",
      "src/middleware.ts",
      "src/features/auth/**/*.ts",
      "src/features/auth/**/*.tsx",
      // Rotas de infraestrutura de autenticação (callback OAuth/PKCE).
      "src/app/auth/**/*.ts",
      // Worker da fila: usa o client administrativo, não a camada de domínio.
      "src/app/api/jobs/**/*.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // O `Image` do @react-pdf/renderer não é <img> e não aceita `alt` —
    // a regra de acessibilidade do JSX não se aplica ao renderizador de PDF.
    files: ["src/features/**/pdf/**/*.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
  {
    // O ecosystem é lido pelo PM2, que carrega o arquivo como CommonJS puro —
    // `require` não é escolha de estilo aqui, é o único formato que funciona.
    files: ["ecosystem.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // shared/ é consumido também pelo Deno (Edge Functions): nada específico de Node/React.
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "next/*", "node:*", "fs", "path"],
              message: "shared/ deve ser agnóstico de runtime (ADR-010).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

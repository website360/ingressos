import type { NextConfig } from "next";

/**
 * `output: "standalone"` é obrigatório para o deploy no Cloudways (ADR-012):
 * o build gera um servidor Node autocontido em `.next/standalone/server.js`,
 * executado pelo PM2 atrás do Nginx.
 */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "localhost";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // Câmera e geolocalização são liberadas apenas na própria origem (rotas de check-in).
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],

    serverActions: {
      // O padrão do Next é 1 MB — qualquer banner de evento real estoura.
      // Precisa ser maior que o limite validado na aplicação (8 MB), senão a
      // requisição morre no framework antes de chegar à validação, com um 413
      // que o formulário não consegue tratar.
      //
      // O arquivo trafega browser → servidor Next → Storage. Se o volume de
      // upload crescer, o passo seguinte é `createSignedUploadUrl` e envio
      // direto do navegador ao Supabase, tirando o servidor do caminho.
      bodySizeLimit: "10mb",
    },
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/storage/v1/object/public/**" },
    ],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;

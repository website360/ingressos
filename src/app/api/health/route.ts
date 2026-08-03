import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Healthcheck consumido pelo monitoramento externo e pelo smoke test do deploy
 * (docs/08, seção 4). Não toca no banco de propósito: precisa responder mesmo
 * com o Supabase degradado, para diferenciar "app caiu" de "banco caiu".
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "ingressos",
      version: process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

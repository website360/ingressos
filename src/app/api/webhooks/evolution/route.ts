import { NextResponse, type NextRequest } from "next/server";

import { extractQrCode, normalizeState } from "@/lib/evolution/protocol";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook da Evolution API.
 *
 * A Evolution avisa aqui quando o QR gira e quando a conexão muda de estado —
 * é o que faz a tela sair de "conectando" sozinha e o que revela que o número
 * caiu antes de um ingresso falhar.
 *
 * Autenticação pelo segredo na query, que é gravado por conexão e vai embutido
 * na URL registrada no servidor Evolution. A busca no banco é pelo próprio
 * segredo: se não casa com nenhuma linha, não há o que atualizar.
 *
 * Responde 200 mesmo para evento que não interessa. A Evolution repete o que
 * falha, e ficar devolvendo erro para `messages.upsert` (que este sistema
 * ignora) viraria retry infinito.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvolutionEvent {
  event?: string;
  instance?: string;
  data?: Record<string, unknown>;
}

/**
 * Segredo pelo header, com a query como plano B.
 *
 * `Authorization: Bearer` é o caminho normal: segredo em query string vaza em
 * log de proxy, em histórico e na tela de configuração do próprio servidor
 * Evolution. Mas `webhook.headers` só existe no dialeto aninhado (2.2+) — num
 * servidor mais antigo a query é a única forma, e recusá-la aqui quebraria a
 * integração justamente onde ela é mais frágil.
 */
function readSecret(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const value = header.slice(7).trim();
    if (value) return value;
  }
  return request.nextUrl.searchParams.get("s");
}

export async function POST(request: NextRequest) {
  const secret = readSecret(request);
  if (!secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("tenant_id, instance_name, phone_number")
    .eq("webhook_secret", secret)
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: EvolutionEvent;
  try {
    body = (await request.json()) as EvolutionEvent;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  // Segredo certo, instância errada: o servidor Evolution está mandando evento
  // de outra sessão para cá. Ignorar é mais seguro do que sobrescrever estado.
  if (body.instance && connection.instance_name && body.instance !== connection.instance_name) {
    return NextResponse.json({ ignored: "instância divergente" });
  }

  const event = (body.event ?? "").toLowerCase().replace(/_/g, ".");

  if (event === "qrcode.updated") {
    const qrCode = extractQrCode(body.data);
    if (qrCode) {
      await admin
        .from("whatsapp_connections")
        .update({
          qr_code: qrCode,
          qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
          state: "conectando",
        })
        .eq("tenant_id", connection.tenant_id);
    }
    return NextResponse.json({ ok: true });
  }

  if (event === "connection.update") {
    const state = normalizeState(body.data?.state as string | undefined);
    const connected = state === "conectado";

    // `wuid` / `owner` chegam como `5511999999999@s.whatsapp.net`.
    const owner = (body.data?.wuid ?? body.data?.owner) as string | undefined;
    const phone = owner ? owner.split("@")[0] : null;

    await admin
      .from("whatsapp_connections")
      .update({
        state,
        ...(phone ? { phone_number: phone } : {}),
        ...(connected
          ? {
              qr_code: null,
              qr_expires_at: null,
              last_connected_at: new Date().toISOString(),
              last_error: null,
            }
          : {}),
      })
      .eq("tenant_id", connection.tenant_id);

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ignored: event || "sem evento" });
}

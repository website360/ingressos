import { NextResponse, type NextRequest } from "next/server";

import { mapMetaStatus, shouldReplaceStatus, verifyMetaSignature } from "@/lib/meta/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook da API oficial do WhatsApp (Meta).
 *
 * GET  — aperto de mão: a Meta manda `hub.verify_token` e espera o
 *        `hub.challenge` de volta. O token é o que a tela de Configurações
 *        mostra para copiar.
 * POST — eventos. Interessam só as situações das mensagens que o sistema
 *        enviou (enviada/entregue/lida/falhou). Mensagem recebida é ignorada:
 *        o sistema não conversa, só entrega ingresso.
 *
 * A empresa é achada pelo id do número (`metadata.phone_number_id`) e o corpo
 * só é aceito se a assinatura bater com o segredo do app DAQUELA empresa.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token");

  if (params.get("hub.mode") !== "subscribe" || !token) {
    return new NextResponse("Requisição inválida.", { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_connections")
    .select("tenant_id")
    .eq("provider", "meta")
    .eq("meta_verify_token", token)
    .maybeSingle();

  if (!data) return new NextResponse("Token de verificação não confere.", { status: 403 });
  return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
}

interface MetaStatus {
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: { metadata?: { phone_number_id?: string }; statuses?: MetaStatus[] };
    }[];
  }[];
}

export async function POST(request: NextRequest) {
  // A assinatura é sobre o corpo CRU: ler como texto antes de qualquer parse.
  const raw = await request.text();

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(raw) as MetaWebhookBody;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const changes = (body.entry ?? []).flatMap((entry) => entry.changes ?? []);
  const phoneNumberId = changes.find((c) => c.value?.metadata?.phone_number_id)?.value?.metadata
    ?.phone_number_id;
  if (!phoneNumberId) return NextResponse.json({ ignored: "sem número" });

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("tenant_id, meta_app_secret")
    .eq("provider", "meta")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle();

  if (!connection?.meta_app_secret) {
    return NextResponse.json({ error: "Número não configurado." }, { status: 404 });
  }

  if (
    !verifyMetaSignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      connection.meta_app_secret,
    )
  ) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const statuses = changes.flatMap((c) => c.value?.statuses ?? []);

  for (const event of statuses) {
    const next = mapMetaStatus(event.status);
    if (!next || !event.id) continue;

    const { data: message } = await admin
      .from("whatsapp_messages")
      .select("id, status")
      .eq("tenant_id", connection.tenant_id)
      .eq("provider_message_id", event.id)
      .maybeSingle();

    if (!message || !shouldReplaceStatus(message.status, next)) continue;

    const error = event.errors?.[0];
    await admin
      .from("whatsapp_messages")
      .update({
        status: next,
        ...(next === "falhou"
          ? {
              last_error: `Meta: ${error?.error_data?.details ?? error?.message ?? error?.title ?? "falha na entrega"}${error?.code ? ` (${error.code})` : ""}`,
            }
          : {}),
      })
      .eq("id", message.id);
  }

  // A Meta reenvia o que não receber 200 — responder rápido e sempre 200 aqui.
  return NextResponse.json({ ok: true, statuses: statuses.length });
}

import { NextResponse, type NextRequest } from "next/server";

import { mapMetaStatus, shouldReplaceStatus, verifyMetaSignature } from "@/lib/meta/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook da API oficial do WhatsApp (Meta).
 *
 * GET  — aperto de mão: a Meta manda `hub.verify_token` e espera o
 *        `hub.challenge` de volta.
 * POST — eventos. A assinatura `X-Hub-Signature-256` (HMAC do corpo cru com o
 *        segredo do app) é conferida ANTES de qualquer gravação. Depois:
 *        1. o corpo cru vai para `whatsapp_webhook_events` e é processado no
 *           banco (`whatsapp_ingest_webhook`): situação das mensagens da fila
 *           nova, pedido de saída, qualidade do número, aprovação de modelo;
 *        2. mensagens antigas (enviadas pelo cron, em `whatsapp_messages`)
 *           seguem sendo atualizadas como antes.
 *
 * HTTP 200 da API de envio não é entrega: entrega é o "delivered" que chega
 * aqui. Responder 200 rápido — a Meta reenvia o que não receber 200, e o
 * processamento é idempotente.
 *
 * Variáveis de ambiente (META_APP_SECRET, META_VERIFY_TOKEN,
 * META_PHONE_NUMBER_ID) têm precedência sobre o que está salvo na tela.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token");

  if (params.get("hub.mode") !== "subscribe" || !token) {
    return new NextResponse("Requisição inválida.", { status: 400 });
  }

  const envToken = process.env.META_VERIFY_TOKEN;
  if (envToken) {
    if (token !== envToken) {
      return new NextResponse("Token de verificação não confere.", { status: 403 });
    }
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
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
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 });
  }

  // A assinatura é sobre o corpo CRU: ler como texto antes de qualquer parse.
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(raw) as MetaWebhookBody;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const changes = (body.entry ?? []).flatMap((entry) => entry.changes ?? []);
  const phoneNumberId =
    changes.find((c) => c.value?.metadata?.phone_number_id)?.value?.metadata?.phone_number_id ?? null;

  const admin = createAdminClient();
  const { data: connections } = await admin
    .from("whatsapp_connections")
    .select("tenant_id, meta_app_secret, meta_phone_number_id")
    .eq("provider", "meta");

  // Pelo id do número; sem ele (eventos de conta/qualidade), a única empresa
  // com Meta. O id vindo da variável de ambiente também identifica.
  const list = connections ?? [];
  const connection =
    list.find((c) => phoneNumberId && c.meta_phone_number_id === phoneNumberId) ??
    (list.length === 1 &&
    (!phoneNumberId || phoneNumberId === process.env.META_PHONE_NUMBER_ID)
      ? list[0]
      : undefined);

  const secret = process.env.META_APP_SECRET || connection?.meta_app_secret;
  if (!connection || !secret) {
    return NextResponse.json({ error: "Número não configurado." }, { status: 404 });
  }

  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  // 1. Fila nova: grava cru e processa no banco. Falha de processamento fica
  //    registrada no evento e o worker reprocessa — aqui não vira erro HTTP.
  const { error: ingestError } = await admin.rpc("whatsapp_ingest_webhook", {
    p_phone_number_id: phoneNumberId,
    p_payload: body as never,
  });
  if (ingestError) {
    // Nem gravou: devolve erro para a Meta tentar de novo mais tarde.
    return NextResponse.json({ error: "Falha ao registrar o evento." }, { status: 500 });
  }

  // 2. Caminho antigo: mensagens enviadas pelo cron.
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

  return NextResponse.json({ ok: true, statuses: statuses.length });
}

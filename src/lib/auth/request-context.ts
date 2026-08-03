import "server-only";

import { headers } from "next/headers";

import type { RequestContext } from "@shared/schemas/common";

/**
 * Contexto da requisição para auditoria (ADR-013).
 *
 * O IP real vem de `x-forwarded-for` — o Nginx do Cloudways precisa estar
 * configurado para propagá-lo (docs/08, seção 2). Sem isso, toda a trilha de
 * auditoria registra o IP do proxy.
 */
export async function getRequestContext(
  extra: Partial<RequestContext> = {},
): Promise<RequestContext> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    headerList.get("cf-connecting-ip") ??
    null;

  return {
    ip,
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    deviceId: headerList.get("x-device-id"),
    requestId: headerList.get("x-request-id"),
    latitude: null,
    longitude: null,
    accuracyM: null,
    ...extra,
  };
}

/** Formato aceito pelas RPCs (snake_case, como o banco espera). */
export function toRpcContext(context: RequestContext): Record<string, unknown> {
  return {
    ip: context.ip,
    user_agent: context.userAgent,
    device_id: context.deviceId,
    request_id: context.requestId,
    latitude: context.latitude,
    longitude: context.longitude,
    accuracy_m: context.accuracyM,
  };
}

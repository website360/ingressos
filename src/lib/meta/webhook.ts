import { createHmac, timingSafeEqual } from "node:crypto";

import type { Database } from "@/lib/supabase/database.types";

type LogStatus = Database["public"]["Enums"]["email_status"];

/**
 * Confere o `X-Hub-Signature-256` que a Meta manda em todo POST do webhook:
 * HMAC-SHA256 do corpo CRU com o segredo do app. Sem isso, qualquer um que
 * descobrisse a URL marcaria mensagens como entregues.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Situação da Meta → situação do log (o mesmo enum do e-mail). */
export function mapMetaStatus(status: string): LogStatus | null {
  switch (status) {
    case "sent":
      return "enviado";
    case "delivered":
      return "entregue";
    case "read":
      return "aberto";
    case "failed":
      return "falhou";
    default:
      return null;
  }
}

const RANK: Partial<Record<LogStatus, number>> = { fila: 0, enviado: 1, entregue: 2, aberto: 3 };

/**
 * Os eventos chegam fora de ordem ("lida" antes de "entregue" é comum). A
 * situação só avança; falha vale até a mensagem ter sido lida.
 */
export function shouldReplaceStatus(current: LogStatus, next: LogStatus): boolean {
  if (next === "falhou") return current !== "aberto";
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

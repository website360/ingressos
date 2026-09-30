/**
 * O protocolo da Evolution API, sem rede.
 *
 * Fica separado do cliente de propósito: são as partes que dão errado em
 * silêncio — o dialeto de webhook que mudou entre minors, o QR que vem em três
 * formatos diferentes, o estado em inglês — e são exatamente as que dá para
 * testar sem um servidor Evolution na frente.
 *
 * Sem `server-only`: é lógica pura, e o teste unitário importa daqui.
 */

export interface EvolutionVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/** `"v2.2.3"`, `"2.2.3"` e `"2.2"` entram; qualquer outra coisa vira `null`. */
export function parseEvolutionVersion(raw: string | null | undefined): EvolutionVersion | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    raw: raw.trim(),
  };
}

/**
 * Formato do corpo de `POST /webhook/set/{instância}`.
 *
 * Até a 2.1 o corpo é achatado (`{url, webhook_by_events, events}`); da 2.2 em
 * diante é aninhado sob `webhook`. Mandar o formato errado não dá erro: o
 * servidor aceita, ignora, e o webhook simplesmente nunca chega — por isso a
 * escolha é explícita e testada, em vez de tentativa e erro em produção.
 */
export type WebhookDialect = "achatado" | "aninhado";

/**
 * Versão desconhecida assume o dialeto novo: é o que uma instalação feita hoje
 * vai ter, e o erro nessa direção aparece na hora do teste de conexão.
 */
export function webhookDialectFor(version: EvolutionVersion | null): WebhookDialect {
  if (!version) return "aninhado";
  if (version.major > 2) return "aninhado";
  if (version.major < 2) return "achatado";
  return version.minor >= 2 ? "aninhado" : "achatado";
}

/** Só o que este sistema usa: parear o número e saber quando ele cai. */
export const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE"] as const;

/**
 * `secret` viaja em `Authorization: Bearer` no dialeto aninhado, que suporta
 * `webhook.headers` (2.2+). No achatado não há campo de header, e aí o segredo
 * só pode ir na query da própria URL — ver `webhookUrlFor` em
 * `connection.actions`, que é quem decide isso.
 */
export function buildWebhookBody(
  dialect: WebhookDialect,
  url: string,
  events: readonly string[] = WEBHOOK_EVENTS,
  secret?: string,
): Record<string, unknown> {
  if (dialect === "achatado") {
    return { url, webhook_by_events: false, webhook_base64: false, events: [...events] };
  }
  return {
    webhook: {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      events: [...events],
      ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
    },
  };
}

/** Estado da sessão no vocabulário do banco (enum `public.whatsapp_state`). */
export type WhatsappState = "nunca_conectado" | "conectando" | "conectado" | "desconectado";

/**
 * `open` / `connecting` / `close` viram o enum do banco. O que não for
 * reconhecido conta como desconectado: na dúvida, o sistema prefere avisar que
 * o número caiu a jurar que está no ar.
 */
export function normalizeState(raw: string | null | undefined): WhatsappState {
  switch ((raw ?? "").toLowerCase()) {
    case "open":
      return "conectado";
    case "connecting":
      return "conectando";
    default:
      return "desconectado";
  }
}

/**
 * Extrai o QR de uma resposta da Evolution.
 *
 * A mesma informação chega como `qrcode.base64`, `base64`, `qrcode.code` ou
 * `code`, conforme a versão e o endpoint — e às vezes já com o prefixo
 * `data:image`, às vezes sem (issue #2380 do projeto). Normalizamos para um
 * data URL pronto para jogar num `<img src>`.
 */
export function extractQrCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const root = payload as Record<string, unknown>;
  const nested = (root.qrcode ?? root.qrCode) as Record<string, unknown> | undefined;

  const candidate = [
    nested?.base64,
    root.base64,
    nested?.code,
    root.code,
    typeof root.qrcode === "string" ? root.qrcode : undefined,
  ].find((value) => typeof value === "string" && value.length > 0) as string | undefined;

  if (!candidate) return null;
  return candidate.startsWith("data:") ? candidate : `data:image/png;base64,${candidate}`;
}

/**
 * Nome da instância na Evolution, derivado do slug da empresa.
 *
 * Precisa ser estável: é a chave pela qual a Evolution reconhece a sessão
 * entre reinícios. E precisa ser conservador no alfabeto — instância com
 * caractere estranho quebra na hora de montar a URL do endpoint.
 */
export function instanceNameFor(slug: string): string {
  const clean = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `ingressos-${clean || "empresa"}`;
}

/** `"••••" + 4 últimos`. O que o painel mostra no lugar da chave. */
export function maskSecret(secret: string): string {
  const tail = secret.trim().slice(-4);
  return `••••${tail}`;
}

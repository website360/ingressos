/**
 * Cliente mínimo da Cloud API para o worker.
 *
 * Separado de `src/lib/meta/client.ts` porque aquele é `server-only` (pacote
 * que se recusa a carregar fora do Next) e o worker é um processo Node puro.
 *
 * O que este cliente acrescenta é a FASE da falha: o worker precisa saber se
 * a requisição chegou a sair. Erro de conexão (recusada, DNS) é "antes" —
 * seguro repetir. Timeout e conexão cortada são "depois" — pode ter chegado.
 */
import type { MetaTemplateMessage } from "./template-message";

const DEFAULT_VERSION = "v23.0";

export function metaGraphBase(env: Record<string, string | undefined> = process.env): string {
  const version = env.META_GRAPH_VERSION;
  const valid = version && /^v\d+\.\d+$/.test(version) ? version : DEFAULT_VERSION;
  return `https://graph.facebook.com/${valid}`;
}

export class MetaSendError extends Error {
  constructor(
    message: string,
    readonly phase: "before_send" | "after_send",
    readonly status?: number,
    readonly code?: number,
    readonly timeout = false,
  ) {
    super(message);
    this.name = "MetaSendError";
  }
}

/** Erros de rede em que a requisição comprovadamente NÃO saiu. */
const BEFORE_SEND = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function networkPhase(error: unknown): { phase: "before_send" | "after_send"; timeout: boolean } {
  const err = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  const code = err.cause?.code ?? err.code;
  if (code && BEFORE_SEND.has(code)) return { phase: "before_send", timeout: false };
  const timeout =
    err.name === "TimeoutError" || err.cause?.name === "TimeoutError" || err.name === "AbortError";
  return { phase: "after_send", timeout };
}

export interface MetaClientOptions {
  baseUrl: string;
  accessToken: string;
  phoneNumberId: string;
  timeoutMs?: number;
}

export class MetaGraphClient {
  constructor(private readonly options: MetaClientOptions) {}

  private url(path: string) {
    return `${this.options.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  /** Envia um modelo. Devolve o wamid; falha com `MetaSendError`. */
  async sendTemplate(
    to: string,
    template: MetaTemplateMessage,
    opts: { callbackData?: string } = {},
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.url(`/${this.options.phoneNumberId}/messages`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/^\+/, ""),
          type: "template",
          template,
          ...(opts.callbackData ? { biz_opaque_callback_data: opts.callbackData } : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      const { phase, timeout } = networkPhase(error);
      throw new MetaSendError(
        timeout ? "Tempo esgotado esperando a Meta." : "Falha de rede ao falar com a Meta.",
        phase,
        undefined,
        undefined,
        timeout,
      );
    }

    let body: {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // corpo vazio ou não-JSON: o status decide abaixo
    }

    const wamid = body.messages?.[0]?.id;
    if (response.ok && wamid) return wamid;

    const code = body.error?.code;
    const detail =
      body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${response.status}`;
    throw new MetaSendError(
      `Meta: ${detail}`.slice(0, 500),
      "after_send",
      response.ok ? 502 : response.status,
      code,
    );
  }
}

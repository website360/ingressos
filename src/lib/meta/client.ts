import "server-only";

import type { MetaTemplateMessage } from "@/lib/meta/templates";

/**
 * Cliente mínimo da WhatsApp Cloud API (Graph API da Meta).
 *
 * Só o que o sistema usa: ler o número (para validar a credencial), subir a
 * imagem do QR e enviar mensagem de modelo. A versão vai na URL base, gravada
 * na conexão — subir de versão é trocar a constante, não o código.
 */
export const META_GRAPH_BASE = "https://graph.facebook.com/v23.0";

export interface MetaPhoneInfo {
  display_phone_number: string;
  verified_name: string;
  quality_rating?: string;
}

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

/**
 * Erros mais comuns traduzidos — o texto cru da Meta vai para o log técnico,
 * mas quem lê a tela de envios precisa saber o que fazer.
 */
const KNOWN_ERRORS: Record<number, string> = {
  190: "Token de acesso da Meta inválido ou expirado. Gere um novo e salve em Configurações.",
  100: "Parâmetro recusado pela Meta. Confira o ID do número.",
  10: "O token não tem permissão para este número (whatsapp_business_messaging).",
  131026: "O número não pode receber mensagens (sem WhatsApp ou sem aceitar os termos).",
  131047: "Fora da janela de 24h: é preciso usar um modelo aprovado.",
  131051: "Tipo de mensagem não suportado.",
  132000: "A quantidade de variáveis não bate com o modelo aprovado na Meta.",
  132001: "Modelo não encontrado na Meta (nome ou idioma errado, ou ainda não aprovado).",
  132005: "Texto das variáveis longo demais para o modelo.",
  132007: "O conteúdo violou a política de modelos da Meta.",
  132012: "Formato das variáveis não bate com o modelo (ex.: imagem no cabeçalho).",
  130429: "Limite de envio da Meta atingido. A fila tenta de novo mais tarde.",
  131056: "Muitas mensagens para o mesmo número em pouco tempo.",
  368: "A conta foi temporariamente bloqueada pela Meta por violação de política.",
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class MetaWhatsAppClient {
  constructor(
    private readonly options: { baseUrl: string; accessToken: string; phoneNumberId: string },
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.options.accessToken}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as T & MetaErrorBody;
    if (!response.ok || body.error) {
      const code = body.error?.code ?? null;
      const known = code != null ? KNOWN_ERRORS[code] : undefined;
      const raw =
        body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${response.status}`;
      throw new MetaApiError(known ? `${known} (${code})` : `Meta: ${raw}`, code, response.status);
    }
    return body;
  }

  /** Lê o número — é o teste de credencial. */
  phoneInfo(): Promise<MetaPhoneInfo> {
    return this.request<MetaPhoneInfo>(
      `/${this.options.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
  }

  /** Sobe uma imagem e devolve o id de mídia (vale por 30 dias na Meta). */
  async uploadImage(png: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "image/png");
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), filename);

    const body = await this.request<{ id: string }>(`/${this.options.phoneNumberId}/media`, {
      method: "POST",
      body: form,
    });
    return body.id;
  }

  /** Envia mensagem de modelo. Devolve o id da mensagem (wamid), usado pelo webhook. */
  async sendTemplate(to: string, template: MetaTemplateMessage): Promise<string | null> {
    const body = await this.request<{ messages?: { id: string }[] }>(
      `/${this.options.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template,
        }),
      },
    );
    return body.messages?.[0]?.id ?? null;
  }
}

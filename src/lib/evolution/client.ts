import "server-only";

import { AppError } from "@/lib/errors";

import {
  buildWebhookBody,
  extractQrCode,
  normalizeState,
  parseEvolutionVersion,
  webhookDialectFor,
  WEBHOOK_EVENTS,
  type EvolutionVersion,
  type WebhookDialect,
  type WhatsappState,
} from "./protocol";

/**
 * Cliente HTTP da Evolution API.
 *
 * Toda chamada tem timeout: a Evolution costuma rodar num VPS do próprio
 * cliente, e um servidor fora do ar que aceita conexão mas nunca responde
 * prenderia o Server Action até o limite do Next.
 *
 * As mensagens de erro são em pt-BR e seguras para a tela — o corpo cru da
 * resposta vai em `details`, para o log.
 */

const TIMEOUT_MS = 15_000;

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
}

export interface InstanceStatus {
  state: WhatsappState;
  /** Número pareado, quando a Evolution informa. */
  phoneNumber: string | null;
}

export interface CreatedInstance {
  /** Token específico da instância (`hash`), usado no envio de mensagens. */
  token: string | null;
  qrCode: string | null;
}

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: EvolutionConfig) {
    // Barra no fim duplicaria na concatenação e vira 404 em alguns proxies.
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey.trim();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    apiKey?: string,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          apikey: apiKey ?? this.apiKey,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new AppError(
        "INTERNAL",
        timedOut
          ? "O servidor Evolution não respondeu a tempo. Confira a URL e se ele está no ar."
          : "Não foi possível falar com o servidor Evolution. Confira a URL.",
        { cause, details: { path } },
      );
    }

    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        // O corpo vai junto: a Evolution também responde 403 para "instância já
        // existe", e quem chama precisa distinguir isso de chave recusada.
        throw new AppError("FORBIDDEN", "A Evolution recusou a chave de API informada.", {
          details: { path, status: response.status, body: text.slice(0, 500) },
        });
      }
      throw new AppError("INTERNAL", `A Evolution respondeu ${response.status} em ${path}.`, {
        details: { path, status: response.status, body: text.slice(0, 500) },
      });
    }

    return payload as T;
  }

  /**
   * Sonda a raiz da Evolution para descobrir a versão.
   *
   * É o que decide o dialeto do webhook. Devolve `null` na versão que não deu
   * para ler, em vez de estourar: o servidor responde, só não se identificou —
   * e o dialeto tem um padrão razoável para esse caso.
   */
  async probe(): Promise<{ version: EvolutionVersion | null; dialect: WebhookDialect }> {
    const root = await this.request<{ version?: string; message?: string }>("GET", "/");
    const version = parseEvolutionVersion(root?.version);
    return { version, dialect: webhookDialectFor(version) };
  }

  /**
   * Cria a instância e já devolve o primeiro QR.
   *
   * O webhook vai no mesmo corpo: configurar depois abre uma janela em que a
   * instância existe e ninguém está ouvindo as mudanças de conexão dela.
   */
  async createInstance(
    instanceName: string,
    webhookUrl: string,
    dialect: WebhookDialect,
    webhookSecret?: string,
  ): Promise<CreatedInstance> {
    const payload = await this.request<Record<string, unknown>>("POST", "/instance/create", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      ...buildWebhookBody(dialect, webhookUrl, WEBHOOK_EVENTS, webhookSecret),
    });

    const hash = payload?.hash;
    const token =
      typeof hash === "string"
        ? hash
        : typeof (hash as Record<string, unknown>)?.apikey === "string"
          ? ((hash as Record<string, unknown>).apikey as string)
          : null;

    return { token, qrCode: extractQrCode(payload) };
  }

  /** Pede um QR novo para uma instância que já existe. */
  async connect(instanceName: string): Promise<string | null> {
    const payload = await this.request<unknown>(
      "GET",
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );
    return extractQrCode(payload);
  }

  async connectionState(instanceName: string): Promise<InstanceStatus> {
    const payload = await this.request<{
      instance?: { state?: string; owner?: string; profileName?: string };
    }>("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);

    const owner = payload?.instance?.owner ?? null;
    return {
      state: normalizeState(payload?.instance?.state),
      // A Evolution devolve `owner` como `5511999999999@s.whatsapp.net`.
      phoneNumber: owner ? (owner.split("@")[0] ?? null) : null,
    };
  }

  /** Reconfigura o webhook de uma instância existente. */
  async setWebhook(
    instanceName: string,
    webhookUrl: string,
    dialect: WebhookDialect,
    webhookSecret?: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/webhook/set/${encodeURIComponent(instanceName)}`,
      buildWebhookBody(dialect, webhookUrl, WEBHOOK_EVENTS, webhookSecret),
    );
  }

  /**
   * Desconecta o celular, mantendo a instância.
   *
   * O método mudou de POST para DELETE ao longo da v2 e a documentação
   * disponível se contradiz. Como desconectar é operação idempotente e sem
   * efeito destrutivo, tentar os dois é mais barato do que exigir que o
   * usuário descubra a versão exata do servidor dele.
   */
  async logout(instanceName: string): Promise<void> {
    const path = `/instance/logout/${encodeURIComponent(instanceName)}`;
    try {
      await this.request("DELETE", path);
    } catch (error) {
      if (!isMethodMismatch(error)) throw error;
      await this.request("POST", path);
    }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  async sendText(
    instanceName: string,
    number: string,
    text: string,
    instanceToken?: string | null,
  ): Promise<string | null> {
    const payload = await this.request<{ key?: { id?: string } }>(
      "POST",
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      { number, text },
      instanceToken ?? undefined,
    );
    return payload?.key?.id ?? null;
  }

  /** `media` é base64 puro, sem o prefixo `data:`. */
  async sendMedia(
    instanceName: string,
    number: string,
    media: string,
    caption: string,
    fileName: string,
    instanceToken?: string | null,
  ): Promise<string | null> {
    const payload = await this.request<{ key?: { id?: string } }>(
      "POST",
      `/message/sendMedia/${encodeURIComponent(instanceName)}`,
      { number, mediatype: "image", mimetype: "image/png", media, caption, fileName },
      instanceToken ?? undefined,
    );
    return payload?.key?.id ?? null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 404/405 na rota certa significa "este servidor espera o outro método". */
function isMethodMismatch(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const status = error.details?.status;
  return status === 404 || status === 405;
}

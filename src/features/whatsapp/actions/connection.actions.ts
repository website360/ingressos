"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { whatsappServerSchema, type WhatsappServerInput } from "@shared/schemas/whatsapp";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { EvolutionClient } from "@/lib/evolution/client";
import {
  instanceNameFor,
  maskSecret,
  type WebhookDialect,
  type WhatsappState,
} from "@/lib/evolution/protocol";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhatsappRepository, type WhatsappConnection } from "@/repositories/whatsapp.repository";

/**
 * Conexão do número de WhatsApp com a Evolution API.
 *
 * Todas as ações leem a credencial pelo client de service role: as colunas
 * `api_key`, `instance_token` e `webhook_secret` não são legíveis pelo client
 * do usuário, por GRANT de coluna. O segredo nunca sai do servidor.
 */

/** O QR do Baileys gira em segundos; 60s é o teto útil antes de pedir outro. */
const QR_TTL_MS = 60_000;

function adminRepo(): WhatsappRepository {
  return new WhatsappRepository(createAdminClient());
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * URL que a Evolution vai chamar.
 *
 * No dialeto aninhado (2.2+) o segredo vai em `Authorization: Bearer`, via
 * `webhook.headers`, e a URL fica limpa — segredo em query string acaba em log
 * de proxy, em histórico e na tela de configuração do servidor Evolution.
 * O dialeto achatado (<= 2.1) não tem campo de header: ali não há para onde ir
 * senão a query, e a rota aceita as duas formas por causa disso.
 */
function webhookUrlFor(secret: string, dialect: WebhookDialect): string {
  const base = `${appUrl()}/api/webhooks/evolution`;
  return dialect === "achatado" ? `${base}?s=${secret}` : base;
}

function revalidate() {
  revalidatePath(ROUTES.admin.whatsapp);
  revalidatePath(ROUTES.admin.settings.root);
}

/** Carrega a conexão com segredos, ou explica que ainda não há servidor salvo. */
async function loadConnection(tenantId: string): Promise<WhatsappConnection> {
  const connection = await adminRepo().findWithSecret(tenantId);
  if (!connection) {
    throw new AppError("NOT_FOUND", "Configure o servidor Evolution antes de conectar o celular.");
  }
  return connection;
}

// -----------------------------------------------------------------------------
// Servidor
// -----------------------------------------------------------------------------

/**
 * Salva URL e chave do servidor, sondando a versão no mesmo passo.
 *
 * A sondagem não é enfeite: é ela que decide o dialeto do webhook. Salvar sem
 * conseguir falar com o servidor deixaria uma configuração que parece boa na
 * tela e falha só lá na frente, na hora de parear — então a ação falha aqui.
 */
export async function saveEvolutionServer(
  input: WhatsappServerInput,
): Promise<Result<{ version: string | null }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = whatsappServerSchema.parse(input);
    const repo = adminRepo();

    const existing = await repo.findWithSecret(session.activeTenantId!);
    const apiKey = data.api_key || existing?.api_key;

    if (!apiKey) {
      throw new AppError("VALIDATION", "Informe a chave de API do servidor Evolution.", {
        details: { api_key: ["Informe a chave de API."] },
      });
    }

    const { version, dialect } = await new EvolutionClient({
      baseUrl: data.base_url,
      apiKey,
    }).probe();

    await repo.upsert({
      tenant_id: session.activeTenantId!,
      base_url: data.base_url,
      api_key: apiKey,
      api_key_hint: maskSecret(apiKey),
      server_version: version?.raw ?? null,
      webhook_dialect: dialect,
      updated_by: session.user.id,
      // Trocar de servidor invalida a instância antiga: o nome pode até existir
      // lá, mas a sessão pareada não vem junto.
      ...(existing && existing.base_url !== data.base_url
        ? {
            instance_name: null,
            instance_token: null,
            state: "nunca_conectado" as const,
            qr_code: null,
          }
        : {}),
    });

    revalidate();
    return ok({ version: version?.raw ?? null });
  } catch (error) {
    return fail(error);
  }
}

/** Testa a credencial salva sem alterar nada. */
export async function testEvolutionServer(): Promise<Result<{ version: string | null }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_READ);
    const connection = await loadConnection(session.activeTenantId!);

    const { version } = await new EvolutionClient({
      baseUrl: connection.base_url,
      apiKey: connection.api_key,
    }).probe();

    return ok({ version: version?.raw ?? null });
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Pareamento
// -----------------------------------------------------------------------------

export interface ConnectionSnapshot {
  state: WhatsappState;
  qrCode: string | null;
  phoneNumber: string | null;
}

/**
 * Pede o QR Code para parear o celular.
 *
 * Cria a instância na primeira vez; nas seguintes, só pede um QR novo. A
 * Evolution recusa a criação de instância que já existe, e essa recusa é o
 * caminho normal a partir do segundo pareamento — por isso vira `connect`, e
 * não erro na tela.
 */
export async function connectWhatsapp(): Promise<Result<ConnectionSnapshot>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const repo = adminRepo();
    const connection = await loadConnection(session.activeTenantId!);

    const client = new EvolutionClient({
      baseUrl: connection.base_url,
      apiKey: connection.api_key,
    });

    const instanceName =
      connection.instance_name ?? instanceNameFor(session.activeTenant?.slug ?? "empresa");
    const webhookSecret = connection.webhook_secret ?? randomBytes(24).toString("base64url");
    const dialect: WebhookDialect =
      connection.webhook_dialect === "achatado" ? "achatado" : "aninhado";
    const webhookUrl = webhookUrlFor(webhookSecret, dialect);

    let qrCode: string | null = null;
    let instanceToken = connection.instance_token;

    try {
      const created = await client.createInstance(instanceName, webhookUrl, dialect, webhookSecret);
      qrCode = created.qrCode;
      instanceToken = created.token ?? instanceToken;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;

      // A instância sobreviveu a um pareamento anterior. Reafirma o webhook
      // (o segredo pode ter mudado) e pede um QR novo.
      await client.setWebhook(instanceName, webhookUrl, dialect, webhookSecret);
      qrCode = await client.connect(instanceName);
    }

    await repo.update(session.activeTenantId!, {
      instance_name: instanceName,
      instance_token: instanceToken,
      webhook_secret: webhookSecret,
      qr_code: qrCode,
      qr_expires_at: qrCode ? new Date(Date.now() + QR_TTL_MS).toISOString() : null,
      state: "conectando",
      last_error: null,
      updated_by: session.user.id,
    });

    revalidate();
    return ok({ state: "conectando", qrCode, phoneNumber: null });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Pergunta o estado à Evolution e grava.
 *
 * A tela chama isto em laço enquanto o QR está aberto. O webhook também grava
 * o estado — este caminho existe porque a Evolution pode não alcançar o
 * sistema (rede fechada, `NEXT_PUBLIC_APP_URL` apontando para localhost), e aí
 * a consulta ativa é a única forma de a tela sair de "conectando".
 */
export async function refreshWhatsappStatus(): Promise<Result<ConnectionSnapshot>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_READ);
    const repo = adminRepo();
    const connection = await loadConnection(session.activeTenantId!);

    if (!connection.instance_name) {
      return ok({ state: connection.state, qrCode: null, phoneNumber: null });
    }

    const client = new EvolutionClient({
      baseUrl: connection.base_url,
      apiKey: connection.api_key,
    });

    const status = await client.connectionState(connection.instance_name);
    const connected = status.state === "conectado";

    await repo.update(session.activeTenantId!, {
      state: status.state,
      phone_number: status.phoneNumber ?? connection.phone_number,
      // Conectou: o QR cumpriu o papel e não deve continuar guardado.
      qr_code: connected ? null : connection.qr_code,
      qr_expires_at: connected ? null : connection.qr_expires_at,
      last_connected_at: connected ? new Date().toISOString() : connection.last_connected_at,
    });

    revalidate();
    return ok({
      state: status.state,
      qrCode: connected ? null : connection.qr_code,
      phoneNumber: status.phoneNumber ?? connection.phone_number,
    });
  } catch (error) {
    return fail(error);
  }
}

/** Desconecta o celular, preservando a instância para reparear depois. */
export async function disconnectWhatsapp(): Promise<Result<{ state: WhatsappState }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const repo = adminRepo();
    const connection = await loadConnection(session.activeTenantId!);

    if (connection.instance_name) {
      const client = new EvolutionClient({
        baseUrl: connection.base_url,
        apiKey: connection.api_key,
      });
      await client.logout(connection.instance_name);
    }

    await repo.update(session.activeTenantId!, {
      state: "desconectado",
      qr_code: null,
      qr_expires_at: null,
      phone_number: null,
      updated_by: session.user.id,
    });

    revalidate();
    return ok({ state: "desconectado" });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Remove a integração inteira: apaga a instância na Evolution e a linha aqui.
 *
 * A falha ao apagar lá não impede apagar aqui — o servidor pode já ter sido
 * desligado, e deixar a empresa presa a uma configuração morta seria pior do
 * que uma instância órfã num servidor que ela controla.
 */
export async function removeWhatsappIntegration(): Promise<Result<{ removed: true }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const repo = adminRepo();
    const connection = await repo.findWithSecret(session.activeTenantId!);

    if (connection?.instance_name) {
      try {
        await new EvolutionClient({
          baseUrl: connection.base_url,
          apiKey: connection.api_key,
        }).deleteInstance(connection.instance_name);
      } catch {
        // Instância órfã é aceitável; configuração zumbi no painel, não.
      }
    }

    await repo.remove(session.activeTenantId!);
    revalidate();
    return ok({ removed: true });
  } catch (error) {
    return fail(error);
  }
}

/**
 * "Já existe" chega como 403 ou 400 conforme a versão, sempre com o nome no
 * corpo. Olhar só o status confundiria com chave recusada.
 */
function isAlreadyExists(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const body = String(error.details?.body ?? "").toLowerCase();
  return body.includes("already in use") || body.includes("already exists") || body.includes("já");
}

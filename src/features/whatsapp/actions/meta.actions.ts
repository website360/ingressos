"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { metaConnectionSchema, type MetaConnectionInput } from "@shared/schemas/whatsapp";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { EvolutionClient } from "@/lib/evolution/client";
import { maskSecret } from "@/lib/evolution/protocol";
import { META_GRAPH_BASE, MetaApiError, MetaWhatsAppClient } from "@/lib/meta/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhatsappRepository } from "@/repositories/whatsapp.repository";

/**
 * Conexão com a API oficial do WhatsApp (Meta Cloud API).
 *
 * Mesma regra da Evolution: os segredos (token e segredo do app) são lidos só
 * pelo client de service role, dentro do servidor. A tela grava e nunca lê.
 */

function adminRepo(): WhatsappRepository {
  return new WhatsappRepository(createAdminClient());
}

function revalidate() {
  revalidatePath(ROUTES.admin.whatsapp);
  revalidatePath(ROUTES.admin.settings.root);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface MetaProbe {
  phone: string;
  verifiedName: string;
  quality: string | null;
}

/**
 * Salva as credenciais e confere na hora, lendo o número na Meta.
 *
 * Salvar sem conseguir ler o número deixaria uma configuração que parece boa e
 * falha só no primeiro ingresso — então a ação falha aqui, com a mensagem da
 * Meta traduzida. Passar para a Meta substitui a Evolution: a instância antiga
 * é apagada no servidor Evolution (melhor esforço), como na remoção.
 */
export async function saveMetaConnection(input: MetaConnectionInput): Promise<Result<MetaProbe>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = metaConnectionSchema.parse(input);
    const repo = adminRepo();
    const tenantId = session.activeTenantId!;

    const existing = await repo.findWithSecret(tenantId);
    const wasMeta = existing?.provider === "meta";

    const accessToken = data.access_token || (wasMeta ? existing!.api_key : "");
    const appSecret = data.app_secret || (wasMeta ? existing!.meta_app_secret : "") || "";

    if (!accessToken) {
      throw new AppError("VALIDATION", "Informe o token de acesso da Meta.", {
        details: { access_token: ["Informe o token de acesso."] },
      });
    }
    if (!appSecret) {
      throw new AppError("VALIDATION", "Informe o segredo do app — ele valida o webhook.", {
        details: { app_secret: ["Informe o segredo do app."] },
      });
    }

    let info;
    try {
      info = await new MetaWhatsAppClient({
        baseUrl: META_GRAPH_BASE,
        accessToken,
        phoneNumberId: data.phone_number_id,
      }).phoneInfo();
    } catch (error) {
      throw new AppError(
        "VALIDATION",
        error instanceof MetaApiError
          ? `A Meta recusou a credencial: ${error.message}`
          : "Não foi possível falar com a Meta. Tente novamente.",
        { cause: error },
      );
    }

    if (existing && !wasMeta && existing.instance_name) {
      try {
        await new EvolutionClient({
          baseUrl: existing.base_url,
          apiKey: existing.api_key,
        }).deleteInstance(existing.instance_name);
      } catch {
        // Instância órfã no servidor Evolution é aceitável; travar a troca, não.
      }
    }

    const phone = info.display_phone_number.replace(/\D/g, "");

    await repo.upsert({
      tenant_id: tenantId,
      provider: "meta",
      base_url: META_GRAPH_BASE,
      api_key: accessToken,
      api_key_hint: maskSecret(accessToken),
      server_version: info.verified_name,
      webhook_dialect: null,
      meta_phone_number_id: data.phone_number_id,
      meta_waba_id: data.waba_id || null,
      meta_app_secret: appSecret,
      meta_verify_token:
        (wasMeta && existing!.meta_verify_token) || randomBytes(18).toString("base64url"),
      meta_templates: data.templates,
      phone_number: phone,
      state: "conectado",
      last_connected_at: new Date().toISOString(),
      last_error: null,
      instance_name: null,
      instance_token: null,
      webhook_secret: null,
      qr_code: null,
      qr_expires_at: null,
      updated_by: session.user.id,
    });

    revalidate();
    return ok({
      phone,
      verifiedName: info.verified_name,
      quality: info.quality_rating ?? null,
    });
  } catch (error) {
    return fail(error);
  }
}

/** Confere a credencial salva e atualiza a situação do número. */
export async function testMetaConnection(): Promise<Result<MetaProbe>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_READ);
    const repo = adminRepo();
    const tenantId = session.activeTenantId!;
    const connection = await repo.findWithSecret(tenantId);

    if (connection?.provider !== "meta" || !connection.meta_phone_number_id) {
      throw new AppError("NOT_FOUND", "A API oficial da Meta não está configurada.");
    }

    try {
      const info = await new MetaWhatsAppClient({
        baseUrl: connection.base_url,
        accessToken: connection.api_key,
        phoneNumberId: connection.meta_phone_number_id,
      }).phoneInfo();

      await repo.update(tenantId, {
        state: "conectado",
        last_error: null,
        last_connected_at: new Date().toISOString(),
        server_version: info.verified_name,
      });
      revalidate();
      return ok({
        phone: info.display_phone_number.replace(/\D/g, ""),
        verifiedName: info.verified_name,
        quality: info.quality_rating ?? null,
      });
    } catch (error) {
      // Credencial recusada derruba o estado: a fila para de tentar em vez de
      // queimar as 5 tentativas de cada ingresso.
      await repo.update(tenantId, { state: "desconectado", last_error: describe(error) });
      revalidate();
      throw new AppError("VALIDATION", describe(error), { cause: error });
    }
  } catch (error) {
    return fail(error);
  }
}

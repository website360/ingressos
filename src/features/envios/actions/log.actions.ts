"use server";

import { revalidatePath } from "next/cache";

import { whatsappPacingSchema, type WhatsappPacingInput } from "@shared/schemas/whatsapp";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fail, ok, type Result } from "@/lib/errors";
import { getRepositories } from "@/repositories";

/**
 * Reenvio de mensagens e ajuste do ritmo.
 *
 * O reenvio passa pelo repositório, como todo acesso a dados (ADR-009), e roda
 * com o client do USUÁRIO: a RPC é `security definer` e checa
 * `settings.manage` por dentro, então quem autoriza é o banco, não só a
 * checagem daqui.
 */

export async function retryMessages(jobIds: string[]): Promise<Result<{ requeued: number }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

    const ids = [...new Set((jobIds ?? []).filter(Boolean))];
    if (ids.length === 0) {
      return ok({ requeued: 0 });
    }

    const { messages } = await getRepositories();
    const requeued = await messages.retry(ids);

    revalidatePath(ROUTES.admin.messages);
    return ok({ requeued });
  } catch (error) {
    return fail(error);
  }
}

/** Intervalo entre mensagens e teto diário do WhatsApp. */
export async function saveWhatsappPacing(
  input: WhatsappPacingInput,
): Promise<Result<{ saved: true }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = whatsappPacingSchema.parse(input);

    const { whatsapp } = await getRepositories();
    await whatsapp.update(session.activeTenantId!, {
      send_interval_seconds: data.send_interval_seconds,
      daily_send_limit: data.daily_send_limit,
      updated_by: session.user.id,
    });

    revalidatePath(ROUTES.admin.messages);
    revalidatePath(ROUTES.admin.settings.root);
    return ok({ saved: true });
  } catch (error) {
    return fail(error);
  }
}

"use server";

import { revalidatePath } from "next/cache";

import { faqTemplateListSchema, type FaqTemplateListInput } from "@shared/schemas/faq-template";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fail, ok, type Result } from "@/lib/errors";
import { getRepositories } from "@/repositories";

/**
 * Substitui a lista de perguntas padrão (Configurações → Perguntas padrão).
 *
 * Não toca em evento nenhum: cada evento guardou a sua cópia na criação.
 */
export async function saveFaqTemplates(
  input: FaqTemplateListInput,
): Promise<Result<{ count: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = faqTemplateListSchema.parse(input);

    const { events } = await getRepositories();
    await events.replaceFaqTemplates(session.activeTenantId!, data.items);

    revalidatePath(ROUTES.admin.settings.root);
    revalidatePath(ROUTES.admin.events);
    return ok({ count: data.items.length });
  } catch (error) {
    return fail(error);
  }
}

/** Acrescenta ao fim da lista — o "salvar também como padrão" do assistente. */
export async function addFaqTemplates(
  input: FaqTemplateListInput,
): Promise<Result<{ count: number }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = faqTemplateListSchema.parse(input);

    const { events } = await getRepositories();
    await events.appendFaqTemplates(session.activeTenantId!, data.items);

    revalidatePath(ROUTES.admin.settings.root);
    revalidatePath(ROUTES.admin.events);
    return ok({ count: data.items.length });
  } catch (error) {
    return fail(error);
  }
}

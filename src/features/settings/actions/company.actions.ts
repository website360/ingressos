"use server";

import { revalidatePath } from "next/cache";

import { companySchema, type CompanyInput } from "@shared/schemas/company";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fail, ok, type Result } from "@/lib/errors";
import { getRepositories } from "@/repositories";

/**
 * Atualiza os dados da empresa.
 *
 * A permissão é checada aqui para dar mensagem clara, mas quem realmente
 * bloqueia é a política de RLS `tenants_update` — sem `settings.manage`, o
 * UPDATE simplesmente não afeta nenhuma linha.
 */
export async function updateCompany(input: CompanyInput): Promise<Result<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = companySchema.parse(input);

    const nullable = (value: string | undefined) =>
      value && value.trim() !== "" ? value.trim() : null;

    const { tenant } = await getRepositories();
    await tenant.update(session.activeTenantId!, {
      name: data.name,
      document: nullable(data.document),
      contact_email: nullable(data.contact_email),
      contact_phone: nullable(data.contact_phone),
      brand_color: nullable(data.brand_color) ?? "#2563eb",
      timezone: data.timezone,
      address: nullable(data.address),
      city: nullable(data.city),
      state: nullable(data.state),
      zip_code: nullable(data.zip_code),
    });

    revalidatePath(ROUTES.admin.settings.root);
    return ok({ id: session.activeTenantId! });
  } catch (error) {
    return fail(error);
  }
}

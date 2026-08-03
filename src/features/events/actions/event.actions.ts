"use server";

import { revalidatePath } from "next/cache";

import { eventSchema, publishRequirements, type EventInput } from "@shared/schemas/event";

import { ROUTES } from "@/constants/routes";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";
import type { TablesInsert } from "@/lib/supabase/database.types";

/** Converte o formulário no formato do banco (datas ISO, vazios como null). */
function toRow(input: EventInput, tenantId: string): TablesInsert<"events"> {
  const nullable = (value: string | null | undefined) =>
    value && value.trim() !== "" ? value.trim() : null;

  return {
    tenant_id: tenantId,
    name: input.name,
    slug: input.slug,
    short_description: nullable(input.short_description),
    description: nullable(input.description),
    starts_at: new Date(input.starts_at).toISOString(),
    ends_at: new Date(input.ends_at).toISOString(),
    venue_name: nullable(input.venue_name),
    address: nullable(input.address),
    address_number: nullable(input.address_number),
    complement: nullable(input.complement),
    district: nullable(input.district),
    city: nullable(input.city),
    state: nullable(input.state),
    zip_code: nullable(input.zip_code),
    // geography aceita EWKT em texto — evita uma RPC só para gravar o ponto.
    location:
      input.latitude != null && input.longitude != null
        ? (`SRID=4326;POINT(${input.longitude} ${input.latitude})` as never)
        : null,
    allowed_radius_m: input.allowed_radius_m,
    capacity: input.capacity,
    overbooking_pct: input.overbooking_pct,
    registration_deadline: input.registration_deadline
      ? new Date(input.registration_deadline).toISOString()
      : null,
    // organizer_name / contact_* são herdados da empresa por trigger no banco.
    status: input.status,
    published_at: input.status === "publicado" ? new Date().toISOString() : null,
  };
}

export async function createEvent(input: EventInput): Promise<Result<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_CREATE);
    const data = eventSchema.parse(input);

    if (data.status === "publicado") {
      const missing = publishRequirements(data);
      if (missing.length) {
        throw new AppError("VALIDATION", `Para publicar, preencha: ${missing.join(", ")}.`);
      }
    }

    const { events } = await getRepositories();
    const event = await events.create(toRow(data, session.activeTenantId!));

    revalidatePath(ROUTES.admin.events);
    return ok({ id: event.id });
  } catch (error) {
    return fail(error);
  }
}

export async function updateEvent(id: string, input: EventInput): Promise<Result<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_UPDATE);
    const data = eventSchema.parse(input);

    if (data.status === "publicado") {
      const missing = publishRequirements(data);
      if (missing.length) {
        throw new AppError("VALIDATION", `Para publicar, preencha: ${missing.join(", ")}.`);
      }
    }

    const { events } = await getRepositories();
    await events.update(id, toRow(data, session.activeTenantId!));

    revalidatePath(ROUTES.admin.events);
    revalidatePath(ROUTES.admin.event(id));
    return ok({ id });
  } catch (error) {
    return fail(error);
  }
}

export async function archiveEvent(id: string): Promise<Result<{ id: string }>> {
  try {
    await requirePermission(PERMISSIONS.EVENT_DELETE);
    const { events } = await getRepositories();
    await events.archive(id);

    revalidatePath(ROUTES.admin.events);
    return ok({ id });
  } catch (error) {
    return fail(error);
  }
}

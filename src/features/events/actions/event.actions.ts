"use server";

import { revalidatePath } from "next/cache";

import { eventSchema, publishRequirements, type EventInput } from "@shared/schemas/event";

import { ROUTES } from "@/constants/routes";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { revalidatePublicEvent } from "@/lib/revalidate-event";
import { createAdminClient } from "@/lib/supabase/admin";
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

    // Perguntas padrão da empresa entram por cópia: editar o padrão depois não
    // muda este evento. Gravar FAQ exige event.update (RLS); sem ela, o evento
    // nasce sem perguntas — e a falha aqui não desfaz a criação.
    if (session.permissions.includes(PERMISSIONS.EVENT_UPDATE)) {
      try {
        const templates = await events.listFaqTemplates();
        await events.replaceContent(
          "event_faqs",
          event.id,
          templates.map((template, index) => ({
            tenant_id: session.activeTenantId!,
            event_id: event.id,
            position: index,
            question: template.question,
            answer: template.answer,
          })),
        );
      } catch (error) {
        console.error("[createEvent] cópia das perguntas padrão falhou", error);
      }
    }

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
    const before = await events.findById(id);
    const after = await events.update(id, toRow(data, session.activeTenantId!));

    revalidatePath(ROUTES.admin.events);
    revalidatePath(ROUTES.admin.event(id));
    // Endereço antigo e novo: se o slug mudou, o antigo vira redirecionamento.
    revalidatePublicEvent(before.slug, after.slug);
    return ok({ id });
  } catch (error) {
    return fail(error);
  }
}

export async function archiveEvent(id: string): Promise<Result<{ id: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_DELETE);
    const { events } = await getRepositories();
    // Leitura com o client do usuário: a RLS já garante que o evento é da
    // empresa dele; a comparação abaixo é a segunda trava.
    const event = await events.findById(id);
    if (event.tenant_id !== session.activeTenantId) throw AppError.forbidden();

    // "Excluir" no painel. RN-10: o evento nunca é apagado de verdade — as
    // inscrições e check-ins continuam nos relatórios. Some da lista e da
    // página pública, e o endereço fica livre para um evento novo.
    //
    // A gravação vai pelo service role porque a policy de SELECT de `events`
    // esconde `deleted_at` preenchido, e o Postgres recusa um UPDATE cuja
    // linha nova o próprio usuário deixaria de enxergar (42501). Permissão e
    // empresa já foram conferidas acima.
    const { error } = await createAdminClient()
      .from("events")
      .update({
        deleted_at: new Date().toISOString(),
        status: "encerrado",
        slug: `${event.slug}-excluido-${Date.now().toString(36)}`,
      })
      .eq("id", id)
      .eq("tenant_id", event.tenant_id)
      .is("deleted_at", null);
    if (error) throw error;

    revalidatePath(ROUTES.admin.events);
    revalidatePath(ROUTES.admin.dashboard);
    revalidatePublicEvent(event.slug);
    return ok({ id });
  } catch (error) {
    return fail(error);
  }
}

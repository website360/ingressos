"use server";

import { revalidatePath } from "next/cache";

import {
  eventContentSchema,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  type EventContentInput,
} from "@shared/schemas/event-content";

import { ROUTES } from "@/constants/routes";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";

/**
 * Grava todo o conteúdo da landing numa chamada.
 *
 * Programação, palestrantes e FAQ são substituídos por completo — é como a
 * edição realmente acontece. Os documentos seguem outro caminho: cada alteração
 * publica uma VERSÃO nova, porque o aceite do participante referencia a versão
 * que ele leu (RF-05.4).
 */
export async function saveEventContent(
  eventId: string,
  input: EventContentInput,
): Promise<Result<{ eventId: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_UPDATE);
    const data = eventContentSchema.parse(input);
    const tenantId = session.activeTenantId!;

    const { events } = await getRepositories();
    const base = { tenant_id: tenantId, event_id: eventId };
    const nullable = (value?: string) => (value && value.trim() !== "" ? value.trim() : null);

    await events.replaceContent(
      "event_schedule_items",
      eventId,
      data.schedule.map((item, index) => ({
        ...base,
        position: index,
        starts_at: nullable(item.starts_at),
        ends_at: nullable(item.ends_at),
        title: item.title,
        speaker: nullable(item.speaker),
        description: nullable(item.description),
      })),
    );

    await events.replaceContent(
      "event_speakers",
      eventId,
      data.speakers.map((item, index) => ({
        ...base,
        position: index,
        name: item.name,
        role: nullable(item.role),
        company: nullable(item.company),
        bio: nullable(item.bio),
        photo_url: nullable(item.photo_url),
      })),
    );

    await events.replaceContent(
      "event_faqs",
      eventId,
      data.faqs.map((item, index) => ({
        ...base,
        position: index,
        question: item.question,
        answer: item.answer,
      })),
    );

    for (const [type, content] of [
      ["regulamento", data.regulamento],
      ["cancelamento", data.cancelamento],
      ["lgpd", data.lgpd],
    ] as const) {
      if (content && content.trim() !== "") {
        await events.publishDocument(tenantId, eventId, type, content.trim());
      }
    }

    revalidatePath(ROUTES.admin.event(eventId));
    revalidatePath("/evento", "layout");
    return ok({ eventId });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Upload de capa ou banner.
 *
 * O caminho começa pelo `tenant_id` porque é o que a política de RLS do Storage
 * verifica — arquivo fora da pasta da empresa é recusado pelo banco, não só
 * pela aplicação.
 */
export async function uploadEventImage(
  eventId: string,
  kind: "cover" | "banner",
  formData: FormData,
): Promise<Result<{ url: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_UPDATE);
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("VALIDATION", "Selecione uma imagem.");
    }

    if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
      throw new AppError("VALIDATION", "Formato não suportado. Use JPG, PNG, WebP ou AVIF.");
    }

    if (file.size > IMAGE_MAX_BYTES) {
      throw new AppError("VALIDATION", "A imagem deve ter no máximo 8 MB.");
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    // Timestamp no nome força o cache do navegador a buscar a versão nova.
    const path = `${session.activeTenantId}/${eventId}/${kind}-${Date.now()}.${extension}`;

    const { events } = await getRepositories();
    const url = await events.uploadImage(path, file);

    await events.update(eventId, kind === "cover" ? { cover_url: url } : { banner_url: url });

    revalidatePath(ROUTES.admin.event(eventId));
    revalidatePath("/evento", "layout");
    return ok({ url });
  } catch (error) {
    return fail(error);
  }
}

export async function removeEventImage(
  eventId: string,
  kind: "cover" | "banner",
): Promise<Result<{ eventId: string }>> {
  try {
    await requirePermission(PERMISSIONS.EVENT_UPDATE);

    const { events } = await getRepositories();
    await events.update(eventId, kind === "cover" ? { cover_url: null } : { banner_url: null });

    revalidatePath(ROUTES.admin.event(eventId));
    return ok({ eventId });
  } catch (error) {
    return fail(error);
  }
}

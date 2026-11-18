"use server";

import { revalidatePath } from "next/cache";

import { revalidatePublicEvent } from "@/lib/revalidate-event";

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

export type ContentSection = "schedule" | "speakers" | "faqs" | "documents";

const ALL_SECTIONS: ContentSection[] = ["schedule", "speakers", "faqs", "documents"];

const nullable = (value?: string) => (value && value.trim() !== "" ? value.trim() : null);

/**
 * Grava as seções pedidas do conteúdo da landing.
 *
 * Programação, palestrantes e FAQ são substituídos por completo — é como a
 * edição realmente acontece. Os documentos seguem outro caminho: cada alteração
 * publica uma VERSÃO nova, porque o aceite do participante referencia a versão
 * que ele leu (RF-05.4). Texto idêntico não gera versão.
 */
async function writeSections(
  tenantId: string,
  eventId: string,
  data: EventContentInput,
  sections: ContentSection[],
) {
  const { events } = await getRepositories();

  // O conteúdo é público por `event_id`, e a RLS só confere o `tenant_id` da
  // linha gravada — não a quem pertence o evento apontado. Sem esta checagem,
  // uma conta de outra empresa conseguiria pendurar perguntas ou programação na
  // landing de um evento alheio. A leitura já passa pela RLS (evento de outra
  // empresa não é encontrado); a comparação explícita é a segunda trava.
  const event = await events.findById(eventId);
  if (event.tenant_id !== tenantId) throw AppError.forbidden();

  const base = { tenant_id: tenantId, event_id: eventId };

  if (sections.includes("schedule")) {
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
  }

  if (sections.includes("speakers")) {
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
  }

  if (sections.includes("faqs")) {
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
  }

  if (sections.includes("documents")) {
    for (const [type, content] of [
      ["regulamento", data.regulamento],
      ["cancelamento", data.cancelamento],
      ["lgpd", data.lgpd],
    ] as const) {
      if (content && content.trim() !== "") {
        await events.publishDocument(tenantId, eventId, type, content.trim());
      }
    }
  }

  revalidatePath(ROUTES.admin.event(eventId));
  revalidatePublicEvent(event.slug);
}

/** Grava todo o conteúdo da landing numa chamada (tela de edição). */
export async function saveEventContent(
  eventId: string,
  input: EventContentInput,
): Promise<Result<{ eventId: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_UPDATE);
    const data = eventContentSchema.parse(input);
    await writeSections(session.activeTenantId!, eventId, data, ALL_SECTIONS);
    return ok({ eventId });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Grava uma seção só (assistente de criação). Cada etapa salva a sua parte sem
 * tocar nas outras — salvar a programação não pode apagar as perguntas.
 */
export async function saveEventContentSection(
  eventId: string,
  section: ContentSection,
  input: EventContentInput,
): Promise<Result<{ eventId: string }>> {
  try {
    const session = await requirePermission(PERMISSIONS.EVENT_UPDATE);
    if (!ALL_SECTIONS.includes(section)) {
      throw new AppError("VALIDATION", "Seção desconhecida.");
    }
    const data = eventContentSchema.parse(input);
    await writeSections(session.activeTenantId!, eventId, data, [section]);
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

    const event = await events.update(
      eventId,
      kind === "cover" ? { cover_url: url } : { banner_url: url },
    );

    revalidatePath(ROUTES.admin.event(eventId));
    revalidatePublicEvent(event.slug);
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
    const event = await events.update(
      eventId,
      kind === "cover" ? { cover_url: null } : { banner_url: null },
    );

    revalidatePath(ROUTES.admin.event(eventId));
    revalidatePublicEvent(event.slug);
    return ok({ eventId });
  } catch (error) {
    return fail(error);
  }
}

import type { EventInput } from "@shared/schemas/event";
import type { EventContentInput } from "@shared/schemas/event-content";

import type { Tables } from "@/lib/supabase/database.types";

/** `datetime-local` exige o formato YYYY-MM-DDTHH:mm, sem fuso nem segundos. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Valores iniciais do formulário do evento — novo ou existente. */
export function eventFormDefaults(event?: Tables<"events">): EventInput {
  return {
    name: event?.name ?? "",
    slug: event?.slug ?? "",
    short_description: event?.short_description ?? "",
    description: event?.description ?? "",
    starts_at: toLocalInput(event?.starts_at),
    ends_at: toLocalInput(event?.ends_at),
    venue_name: event?.venue_name ?? "",
    address: event?.address ?? "",
    address_number: event?.address_number ?? "",
    complement: event?.complement ?? "",
    district: event?.district ?? "",
    city: event?.city ?? "",
    state: (event?.state as EventInput["state"]) ?? "",
    zip_code: event?.zip_code ?? "",
    latitude: null,
    longitude: null,
    allowed_radius_m: event?.allowed_radius_m ?? 300,
    capacity: event?.capacity ?? 100,
    overbooking_pct: event?.overbooking_pct ?? 0,
    registration_deadline: toLocalInput(event?.registration_deadline),
    status: event?.status ?? "rascunho",
  };
}

export interface EventContentRows {
  schedule: Tables<"event_schedule_items">[];
  speakers: Tables<"event_speakers">[];
  faqs: Tables<"event_faqs">[];
  documents: Tables<"event_documents">[];
}

/** Última versão publicada de cada documento. */
function latestDocument(documents: Tables<"event_documents">[], type: string): string {
  return (
    documents.filter((doc) => doc.document_type === type).sort((a, b) => b.version - a.version)[0]
      ?.content ?? ""
  );
}

/** Valores iniciais do formulário de conteúdo da landing. */
export function contentFormDefaults(content?: EventContentRows): EventContentInput {
  return {
    schedule: (content?.schedule ?? []).map((item) => ({
      starts_at: item.starts_at?.slice(0, 5) ?? "",
      ends_at: item.ends_at?.slice(0, 5) ?? "",
      title: item.title,
      speaker: item.speaker ?? "",
      description: item.description ?? "",
    })),
    speakers: (content?.speakers ?? []).map((item) => ({
      name: item.name,
      role: item.role ?? "",
      company: item.company ?? "",
      bio: item.bio ?? "",
      photo_url: item.photo_url ?? "",
    })),
    faqs: (content?.faqs ?? []).map((item) => ({ question: item.question, answer: item.answer })),
    regulamento: latestDocument(content?.documents ?? [], "regulamento"),
    cancelamento: latestDocument(content?.documents ?? [], "cancelamento"),
    lgpd: latestDocument(content?.documents ?? [], "lgpd"),
  };
}

import type { EventInput } from "@shared/schemas/event";
import type { EventContentInput } from "@shared/schemas/event-content";

import type { ContentSection } from "@/features/events/actions/content.actions";

/**
 * As etapas do assistente de criação, na ordem.
 *
 * `kind` diz como a etapa grava:
 * - `event`: campos do próprio evento, por `createEvent` (1ª vez) / `updateEvent`;
 * - `content`: uma seção da landing, por `saveEventContentSection`;
 * - `images`: o envio já é imediato, a etapa só avança;
 * - `faqs`: padrão + personalizadas, montadas em `faq-selection`;
 * - `review`: pendências para publicar e o desfecho (rascunho ou publicar).
 */
export type WizardStep =
  | { id: string; title: string; kind: "event"; fields: (keyof EventInput)[] }
  | {
      id: string;
      title: string;
      kind: "content";
      section: ContentSection;
      fields: (keyof EventContentInput)[];
    }
  | { id: string; title: string; kind: "images" | "faqs" }
  | { id: string; title: string; kind: "review"; fields: (keyof EventInput)[] };

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: "essencial",
    title: "Essencial",
    kind: "event",
    fields: ["name", "slug", "starts_at", "ends_at", "capacity"],
  },
  {
    id: "descricao",
    title: "Descrição",
    kind: "event",
    fields: ["short_description", "description"],
  },
  {
    id: "local",
    title: "Local",
    kind: "event",
    fields: [
      "venue_name",
      "zip_code",
      "address",
      "address_number",
      "complement",
      "district",
      "city",
      "state",
      "latitude",
      "longitude",
      "allowed_radius_m",
    ],
  },
  { id: "fotos", title: "Fotos", kind: "images" },
  {
    id: "programacao",
    title: "Programação",
    kind: "content",
    section: "schedule",
    fields: ["schedule"],
  },
  {
    id: "palestrantes",
    title: "Palestrantes",
    kind: "content",
    section: "speakers",
    fields: ["speakers"],
  },
  { id: "perguntas", title: "Perguntas frequentes", kind: "faqs" },
  {
    id: "regulamento",
    title: "Regulamento",
    kind: "content",
    section: "documents",
    fields: ["regulamento", "cancelamento", "lgpd"],
  },
  {
    id: "revisar",
    title: "Revisar",
    kind: "review",
    fields: ["overbooking_pct", "registration_deadline"],
  },
];

export type StepStatus = "pending" | "done" | "skipped";

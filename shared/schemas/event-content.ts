import { z } from "zod";

/** Conteúdo da landing: programação, palestrantes, perguntas e documentos. */

export const scheduleItemSchema = z.object({
  starts_at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM.")
    .optional()
    .or(z.literal("")),
  ends_at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM.")
    .optional()
    .or(z.literal("")),
  title: z.string().trim().min(2, "Informe o título.").max(160),
  speaker: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const speakerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  role: z.string().trim().max(120).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  bio: z.string().trim().max(600).optional().or(z.literal("")),
  photo_url: z.string().trim().url("URL inválida.").optional().or(z.literal("")),
});

export const faqSchema = z.object({
  question: z.string().trim().min(5, "Informe a pergunta.").max(200),
  answer: z.string().trim().min(2, "Informe a resposta.").max(1000),
});

export const eventContentSchema = z.object({
  schedule: z.array(scheduleItemSchema).max(60),
  speakers: z.array(speakerSchema).max(40),
  faqs: z.array(faqSchema).max(40),
  regulamento: z.string().trim().max(20000).optional().or(z.literal("")),
  cancelamento: z.string().trim().max(20000).optional().or(z.literal("")),
  lgpd: z.string().trim().max(20000).optional().or(z.literal("")),
});

export type ScheduleItemInput = z.infer<typeof scheduleItemSchema>;
export type SpeakerInput = z.infer<typeof speakerSchema>;
export type FaqInput = z.infer<typeof faqSchema>;
export type EventContentInput = z.infer<typeof eventContentSchema>;

/** Limites do upload, aplicados no cliente e revalidados no servidor. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

import { z } from "zod";

import { slugSchema, stateSchema } from "./common";

export const eventStatusSchema = z.enum([
  "rascunho",
  "publicado",
  "privado",
  "encerrado",
  "cancelado",
]);

export const eventSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "O nome deve ter ao menos 3 caracteres.")
      .max(160, "O nome deve ter no máximo 160 caracteres."),
    slug: slugSchema,
    short_description: z
      .string()
      .trim()
      .max(280, "Máximo de 280 caracteres.")
      .optional()
      .or(z.literal("")),
    description: z.string().trim().optional().or(z.literal("")),

    starts_at: z.string().min(1, "Informe a data de início."),
    ends_at: z.string().min(1, "Informe a data de término."),

    venue_name: z.string().trim().max(160).optional().or(z.literal("")),
    address: z.string().trim().max(200).optional().or(z.literal("")),
    address_number: z.string().trim().max(20).optional().or(z.literal("")),
    complement: z.string().trim().max(100).optional().or(z.literal("")),
    district: z.string().trim().max(100).optional().or(z.literal("")),
    city: z.string().trim().max(100).optional().or(z.literal("")),
    state: stateSchema.optional().or(z.literal("")),
    zip_code: z.string().trim().max(9).optional().or(z.literal("")),

    latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
    longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
    allowed_radius_m: z.coerce
      .number()
      .int()
      .min(20, "Mínimo de 20 metros.")
      .max(50000, "Máximo de 50 km.")
      .default(300),

    capacity: z.coerce.number().int().min(1, "A capacidade deve ser ao menos 1."),
    overbooking_pct: z.coerce.number().min(0).max(50).default(0),
    registration_deadline: z.string().optional().or(z.literal("")),

    // Organizador e contato NÃO entram no formulário: são sempre os da empresa
    // e vêm por herança no banco (migration 20260801092200).
    status: eventStatusSchema.default("rascunho"),
  })
  .refine((data) => new Date(data.ends_at) > new Date(data.starts_at), {
    message: "O término deve ser depois do início.",
    path: ["ends_at"],
  })
  .refine(
    (data) =>
      !data.registration_deadline ||
      new Date(data.registration_deadline) <= new Date(data.starts_at),
    { message: "O prazo deve ser anterior ao início do evento.", path: ["registration_deadline"] },
  );

export type EventInput = z.infer<typeof eventSchema>;

/** Publicar exige mais do que salvar rascunho (RF-03.7). */
export const publishRequirements = (event: Partial<EventInput>) => {
  const missing: string[] = [];
  if (!event.capacity || event.capacity < 1) missing.push("capacidade maior que zero");
  if (!event.starts_at || new Date(event.starts_at) <= new Date()) missing.push("data futura");
  if (!event.city) missing.push("cidade do local");
  if (!event.short_description) missing.push("descrição curta");
  return missing;
};

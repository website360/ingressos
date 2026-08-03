import { z } from "zod";

import { emailSchema, phoneSchema, stateSchema } from "./common";

/**
 * Dados da empresa.
 *
 * Como o sistema opera uma única empresa, estes valores são a origem do
 * organizador e do contato de TODO evento — preenchidos uma vez, herdados
 * sempre (migration 20260801092200).
 */
export const companySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(120, "Nome muito longo."),
  document: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => value === "" || value.length === 14, "CNPJ deve ter 14 dígitos.")
    .optional(),
  contact_email: emailSchema.optional().or(z.literal("")),
  contact_phone: phoneSchema.optional().or(z.literal("")),
  brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use um código de cor no formato #2563eb.")
    .optional()
    .or(z.literal("")),
  timezone: z.string().min(1).default("America/Sao_Paulo"),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: stateSchema.optional().or(z.literal("")),
  zip_code: z.string().trim().max(9).optional().or(z.literal("")),
});

export type CompanyInput = z.infer<typeof companySchema>;

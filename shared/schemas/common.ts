import { z } from "zod";

import { isValidCpf, onlyDigits } from "../validation/cpf";
import { BR_STATES, isValidBrPhone } from "../validation/phone";

/**
 * Blocos reutilizáveis de validação. Um schema por conceito, usado por
 * cliente, servidor e Edge Function (ADR-010).
 */

export const uuidSchema = z.string().uuid("Identificador inválido.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Informe o e-mail.")
  .email("E-mail inválido.")
  .max(255);

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres.")
  .max(72, "A senha deve ter no máximo 72 caracteres.")
  .regex(/[a-z]/, "Inclua ao menos uma letra minúscula.")
  .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula.")
  .regex(/[0-9]/, "Inclua ao menos um número.");

export const cpfSchema = z
  .string()
  .transform(onlyDigits)
  .refine((value) => value.length === 11, "O CPF deve ter 11 dígitos.")
  .refine(isValidCpf, "CPF inválido.");

export const phoneSchema = z
  .string()
  .transform(onlyDigits)
  .refine(isValidBrPhone, "Telefone inválido. Use DDD + número.");

export const stateSchema = z.enum(BR_STATES, {
  errorMap: () => ({ message: "Selecione um estado válido." }),
});

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "O identificador deve ter ao menos 3 caracteres.")
  .max(60, "O identificador deve ter no máximo 60 caracteres.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens.");

export const paginationSchema = z.object({
  cursor: z.string().nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Contexto de requisição propagado às RPCs para auditoria (ADR-013). */
export const requestContextSchema = z.object({
  ip: z.string().nullish(),
  userAgent: z.string().max(500).nullish(),
  deviceId: z.string().max(120).nullish(),
  requestId: z.string().uuid().nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyM: z.number().nonnegative().nullish(),
});

export type RequestContext = z.infer<typeof requestContextSchema>;

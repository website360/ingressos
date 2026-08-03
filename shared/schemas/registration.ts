import { z } from "zod";

import { cpfSchema, emailSchema, phoneSchema, stateSchema } from "./common";

/** Idade mínima padrão. Configurável por evento em `settings` (fase 2). */
const MIN_AGE = 16;

export const registrationSchema = z.object({
  first_name: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome muito longo."),
  last_name: z.string().trim().min(2, "Informe seu sobrenome.").max(120, "Sobrenome muito longo."),
  cpf: cpfSchema,
  phone: phoneSchema,
  email: emailSchema,
  city: z.string().trim().min(2, "Informe sua cidade.").max(100),
  state: stateSchema,
  birth_date: z
    .string()
    .min(1, "Informe sua data de nascimento.")
    .refine((value) => {
      const birth = new Date(value);
      if (Number.isNaN(birth.getTime())) return false;
      const age = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= MIN_AGE && age < 120;
    }, `É necessário ter ao menos ${MIN_AGE} anos.`),
  // Empresa, cargo e "como conheceu" foram removidos do formulário: cada campo
  // opcional a mais derruba a conversão, e nenhum deles era usado em relatório.
  // As colunas permanecem no banco com o histórico já coletado.

  // Aceites obrigatórios: `literal(true)` recusa o valor falso na origem,
  // em vez de depender de uma checagem espalhada pela interface.
  accept_lgpd: z.literal(true, {
    errorMap: () => ({ message: "É necessário aceitar a política de privacidade." }),
  }),
  accept_rules: z.literal(true, {
    errorMap: () => ({ message: "É necessário aceitar o regulamento." }),
  }),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export const cancelRegistrationSchema = z.object({
  reason_code: z.string().min(1, "Selecione um motivo."),
  reason_text: z.string().trim().max(500).optional().or(z.literal("")),
});

export type CancelRegistrationInput = z.infer<typeof cancelRegistrationSchema>;

export const CANCEL_REASONS = [
  { value: "conflito_agenda", label: "Conflito de agenda" },
  { value: "nao_vou_conseguir", label: "Não vou conseguir comparecer" },
  { value: "inscricao_duplicada", label: "Inscrição duplicada" },
  { value: "mudanca_evento", label: "Mudança de data ou local do evento" },
  { value: "outro", label: "Outro motivo" },
] as const;

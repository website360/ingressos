import { z } from "zod";

import { hasSurname, normalizeFullName } from "../validation/name";
import { cpfSchema, emailSchema, phoneSchema, stateSchema } from "./common";

export const registrationSchema = z.object({
  // Um campo só: quem digita não precisa decidir onde termina o nome e começa o
  // sobrenome. A divisão para `first_name`/`last_name` acontece na Server Action.
  full_name: z
    .string()
    .transform(normalizeFullName)
    .refine((value) => value.length >= 3, "Informe seu nome completo.")
    .refine(hasSurname, "Informe nome e sobrenome.")
    .refine((value) => value.length <= 200, "Nome muito longo."),
  cpf: cpfSchema,
  phone: phoneSchema,
  email: emailSchema,
  city: z.string().trim().min(2, "Informe sua cidade.").max(100),
  state: stateSchema,
  // Empresa, cargo, "como conheceu" e data de nascimento foram removidos do
  // formulário: cada campo a mais derruba a conversão, e nenhum deles era usado
  // em relatório. As colunas permanecem no banco com o histórico já coletado.

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

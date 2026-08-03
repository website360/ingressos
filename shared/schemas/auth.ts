import { z } from "zod";

import { emailSchema, passwordSchema } from "./common";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha."),
  remember: z.boolean().default(true),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const mfaVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código tem 6 dígitos."),
  factorId: z.string().min(1),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "organizador", "recepcao", "suporte"], {
    errorMap: () => ({ message: "Selecione um perfil." }),
  }),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const profileSchema = z.object({
  full_name: z.string().trim().min(3, "Informe o nome completo.").max(120, "Nome muito longo."),
  phone: z.string().trim().optional().nullable(),
  locale: z.string().default("pt-BR"),
});
export type ProfileInput = z.infer<typeof profileSchema>;

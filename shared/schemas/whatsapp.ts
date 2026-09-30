import { z } from "zod";

/**
 * Dados do servidor Evolution.
 *
 * A URL precisa ser a raiz da API (`https://evo.exemplo.com.br`), não um
 * endpoint — é sobre ela que o cliente monta `/instance/create` e companhia.
 */
export const whatsappServerSchema = z.object({
  base_url: z
    .string()
    .trim()
    .min(1, "Informe a URL do servidor Evolution.")
    .max(300, "URL muito longa.")
    .url("URL inválida. Use o endereço completo, com https://")
    .refine((value) => /^https?:\/\//i.test(value), "A URL precisa começar com http:// ou https://")
    // Barra no fim duplicaria na hora de montar o endpoint; some já na entrada.
    .transform((value) => value.replace(/\/+$/, "")),

  /**
   * Vazio significa "manter a chave que já está salva" — a tela nunca recebe a
   * chave de volta para preencher o campo, então exigir que ela fosse
   * redigitada a cada ajuste de URL seria só atrito.
   */
  api_key: z.union([
    z.string().trim().min(8, "A chave parece curta demais.").max(500, "Chave muito longa."),
    z.literal(""),
  ]),
});

export type WhatsappServerInput = z.infer<typeof whatsappServerSchema>;

/**
 * Ritmo de envio.
 *
 * Os limites do schema espelham os CHECK do banco — validar aqui dá mensagem
 * em português no campo; quem impede de verdade é a constraint.
 */
export const whatsappPacingSchema = z.object({
  send_interval_seconds: z.coerce
    .number()
    .int("Use um número inteiro de segundos.")
    .min(5, "Menos de 5 segundos entre mensagens é pedir para ser banido.")
    .max(3600, "O intervalo máximo é 3600 segundos (1 hora)."),

  daily_send_limit: z.coerce
    .number()
    .int("Use um número inteiro.")
    .min(1, "O teto diário precisa ser ao menos 1.")
    .max(100000, "Teto diário alto demais."),
});

export type WhatsappPacingInput = z.infer<typeof whatsappPacingSchema>;

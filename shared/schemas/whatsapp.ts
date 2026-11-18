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

/**
 * Capacidade do número na API oficial (Meta). Espelha os CHECK de
 * `whatsapp_connections` (20260801094100).
 *
 * - vazão: mensagens por segundo, para o número inteiro (todos os workers);
 *   a Meta permite 80/s por padrão e até 1000/s com aprovação.
 * - teto: destinatários ÚNICOS em 24 h — o nível de limite da conta
 *   (1 mil, 10 mil, 100 mil...). Configurar acima do nível real não acelera
 *   nada: a Meta recusa e a qualidade do número cai.
 * - concorrência: requisições em voo ao mesmo tempo, por worker.
 */
export const whatsappCapacitySchema = z.object({
  rate_per_second: z.coerce
    .number()
    .int("Use um número inteiro.")
    .min(1, "A vazão mínima é 1 mensagem por segundo.")
    .max(1000, "A Meta não passa de 1000 mensagens por segundo por número."),
  daily_unique_limit: z.coerce
    .number()
    .int("Use um número inteiro.")
    .min(1, "O teto precisa ser ao menos 1.")
    .max(10_000_000, "Teto alto demais."),
  worker_concurrency: z.coerce
    .number()
    .int("Use um número inteiro.")
    .min(1, "Ao menos 1 envio por vez.")
    .max(256, "No máximo 256 envios simultâneos."),
});

export type WhatsappCapacityInput = z.infer<typeof whatsappCapacitySchema>;

/**
 * Credenciais da API oficial (Meta Cloud API).
 *
 * Token e segredo do app seguem a regra da chave da Evolution: vazio mantém o
 * que já está salvo, porque a tela nunca recebe os segredos de volta.
 */
const metaId = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]{5,30}$/, `${label}: só números, como aparece no painel da Meta.`);

const templateName = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,512}$/, "Use só minúsculas, números e _ (como no Gerenciador da Meta).");

export const metaConnectionSchema = z.object({
  access_token: z.union([
    z.string().trim().min(20, "O token parece curto demais.").max(1000, "Token muito longo."),
    z.literal(""),
  ]),
  app_secret: z.union([
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{16,128}$/, "O segredo do app tem só letras e números (32 caracteres)."),
    z.literal(""),
  ]),
  phone_number_id: metaId("ID do número"),
  waba_id: z.union([metaId("ID da conta"), z.literal("")]),
  templates: z.object({
    confirmed: templateName,
    cancelled: templateName,
    code: templateName,
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Idioma no formato da Meta, como pt_BR."),
  }),
});

export type MetaConnectionInput = z.infer<typeof metaConnectionSchema>;

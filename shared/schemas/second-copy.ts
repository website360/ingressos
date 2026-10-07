import { z } from "zod";

import { onlyDigits } from "../validation/cpf";
import { cpfSchema } from "./common";

/**
 * Segunda via do ingresso.
 *
 * Quem perdeu o link do ingresso se identifica pelo CPF, recebe um código de
 * seis dígitos nos contatos que já deu na inscrição e, com ele, chega à lista
 * dos próprios ingressos. Os dois passos validam aqui e no banco — o schema é
 * a borda, a regra de verdade está nas RPCs (ADR-010).
 */

/** Minutos de validade do código. A tela e a mensagem citam este número. */
export const TICKET_CODE_TTL_MINUTES = 15;

/** Dígitos do código. */
export const TICKET_CODE_LENGTH = 6;

/**
 * O código chega colado de e-mail ou WhatsApp, às vezes com espaço no meio.
 * Tirar o que não é dígito antes de medir o tamanho resolve isso sem precisar
 * ensinar a pessoa a digitar — e, de quebra, recusa letra: `12a456` perde o
 * `a` e fica com cinco dígitos.
 */
export const ticketCodeSchema = z
  .string()
  .transform(onlyDigits)
  .refine(
    (value) => value.length === TICKET_CODE_LENGTH,
    `O código tem ${TICKET_CODE_LENGTH} dígitos.`,
  );

export const ticketCodeRequestSchema = z.object({ cpf: cpfSchema });

export type TicketCodeRequestInput = z.infer<typeof ticketCodeRequestSchema>;

export const ticketCodeVerifySchema = z.object({ cpf: cpfSchema, code: ticketCodeSchema });

export type TicketCodeVerifyInput = z.infer<typeof ticketCodeVerifySchema>;

/**
 * Resposta do pedido de código.
 *
 * Só as máscaras dos contatos — o e-mail e o telefone de verdade não saem do
 * banco, para a tela não virar uma consulta de dados de participante.
 */
export interface TicketCodeRequest {
  email_mask: string | null;
  phone_mask: string | null;
}

/** Um ingresso ativo na lista que aparece depois do código conferido. */
export interface SecondCopyTicket {
  token: string;
  number: string;
  ticket_code: string;
  event_name: string;
  event_slug: string;
  event_starts_at: string;
  venue: string | null;
  city: string | null;
  state: string | null;
}

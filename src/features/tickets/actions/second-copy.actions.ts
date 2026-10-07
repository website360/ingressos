"use server";

import {
  ticketCodeRequestSchema,
  ticketCodeVerifySchema,
  type SecondCopyTicket,
  type TicketCodeRequest,
  type TicketCodeRequestInput,
  type TicketCodeVerifyInput,
} from "@shared/schemas/second-copy";

import { getRequestContext } from "@/lib/auth/request-context";
import { AppError, fail, mapPostgrestError, ok, type Result } from "@/lib/errors";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Segunda via do ingresso — a borda das duas RPCs.
 *
 * Como na inscrição, toda a regra que importa (limites, validade do código,
 * tentativas, quais ingressos listar) está no banco, numa transação só. Aqui
 * ficam a validação do formulário e a tradução do resultado.
 *
 * Nenhuma das duas actions revalida cache: não há página estática que dependa
 * disso, e o resultado é pessoal.
 */

export async function requestTicketCode(
  input: TicketCodeRequestInput,
): Promise<Result<TicketCodeRequest & { found: boolean }>> {
  try {
    const data = ticketCodeRequestSchema.parse(input);
    const context = await getRequestContext();

    const client = createPublicClient();
    const { data: result, error } = await client.rpc("request_ticket_code", {
      p_cpf: data.cpf,
      p_context: { ip: context.ip, user_agent: context.userAgent },
    });

    if (error) throw mapPostgrestError(error);
    if (!result) throw AppError.internal();

    return ok(result as unknown as TicketCodeRequest & { found: boolean });
  } catch (error) {
    return fail(error);
  }
}

export async function verifyTicketCode(
  input: TicketCodeVerifyInput,
): Promise<Result<{ tickets: SecondCopyTicket[] }>> {
  try {
    const data = ticketCodeVerifySchema.parse(input);

    const client = createPublicClient();
    const { data: result, error } = await client.rpc("verify_ticket_code", {
      p_cpf: data.cpf,
      p_code: data.code,
    });

    if (error) throw mapPostgrestError(error);

    const payload = (result ?? { ok: false }) as unknown as {
      ok: boolean;
      tickets?: SecondCopyTicket[];
    };

    // A RPC não distingue código errado de expirado, usado ou inexistente — e a
    // mensagem aqui também não, por isso é uma só.
    if (!payload.ok) {
      throw new AppError(
        "TICKET_INVALID",
        "Código inválido ou expirado. Peça um novo para tentar de novo.",
      );
    }

    return ok({ tickets: payload.tickets ?? [] });
  } catch (error) {
    return fail(error);
  }
}

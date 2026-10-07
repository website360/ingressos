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
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Segunda via do ingresso — a borda das duas RPCs.
 *
 * Como na inscrição, toda a regra que importa (limites, validade do código,
 * tentativas, quais ingressos listar) está no banco, numa transação só. Aqui
 * ficam a validação do formulário e a tradução do resultado.
 *
 * Usa o client de service role, e não o público, porque o limite por IP de
 * `request_ticket_code` só vale se o IP for confiável. Com as funções abertas
 * ao papel anônimo, qualquer um as chamaria direto no PostgREST com a chave
 * `anon` (pública, embutida no bundle) e escolheria o próprio IP — ou o
 * omitiria, zerando a checagem. Fechadas ao service_role, o único caminho é
 * este, e o IP vem de `getRequestContext()` (20260801093800).
 *
 * O poder extra do service role não se estende a mais nada: as duas funções já
 * eram `security definer`, e daqui não sai nenhuma consulta livre — só estas
 * duas chamadas, com os argumentos validados acima.
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

    const client = createAdminClient();
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

    const client = createAdminClient();
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

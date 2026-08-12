"use server";

import { revalidatePath } from "next/cache";

import {
  cancelRegistrationSchema,
  registrationSchema,
  type CancelRegistrationInput,
  type RegistrationInput,
} from "@shared/schemas/registration";
import { splitFullName } from "@shared/validation/name";

import { getRequestContext } from "@/lib/auth/request-context";
import { AppError, fail, mapPostgrestError, ok, type Result } from "@/lib/errors";
import { createPublicClient } from "@/lib/supabase/public";

export interface RegistrationResult {
  status: "confirmada";
  token?: string;
  number?: string;
}

/**
 * Inscrição pública.
 *
 * Toda a regra crítica — vagas, duplicidade, ingresso, consentimento — está na
 * RPC `create_registration`, numa única transação com lock do evento. Esta
 * action é apenas a borda: valida com o mesmo schema do formulário e propaga o
 * contexto da requisição para a auditoria.
 */
export async function submitRegistration(
  eventId: string,
  input: RegistrationInput,
): Promise<Result<RegistrationResult>> {
  try {
    const data = registrationSchema.parse(input);
    const context = await getRequestContext();

    const client = createPublicClient();
    const { data: result, error } = await client.rpc("create_registration", {
      p_event_id: eventId,
      p_attendee: {
        // O banco continua com nome e sobrenome separados (busca e views de
        // check-in dependem disso); o formulário coleta uma linha só.
        ...splitFullName(data.full_name),
        cpf: data.cpf,
        email: data.email,
        phone: data.phone,
        city: data.city,
        state: data.state,
      },
      p_consents: [
        { type: "lgpd", version: 1, accepted: data.accept_lgpd },
        { type: "regulamento", version: 1, accepted: data.accept_rules },
      ],
      p_context: {
        source: "landing",
        ip: context.ip,
        user_agent: context.userAgent,
        request_id: context.requestId,
      },
    });

    if (error) throw mapPostgrestError(error);
    if (!result) throw AppError.internal();

    const payload = result as unknown as RegistrationResult;

    revalidatePath("/evento");
    return ok(payload);
  } catch (error) {
    return fail(error);
  }
}

/** Cancelamento pelo próprio participante, a partir da página do ingresso. */
export async function cancelOwnRegistration(
  registrationId: string,
  input: CancelRegistrationInput,
): Promise<Result<{ cancelled: true }>> {
  try {
    const data = cancelRegistrationSchema.parse(input);
    const context = await getRequestContext();

    const client = createPublicClient();
    const { error } = await client.rpc("cancel_registration", {
      p_registration_id: registrationId,
      p_reason_code: data.reason_code,
      p_reason_text: data.reason_text || null,
      p_context: { ip: context.ip, user_agent: context.userAgent },
    });

    if (error) throw mapPostgrestError(error);

    return ok({ cancelled: true });
  } catch (error) {
    return fail(error);
  }
}

/** Contador de vagas — consultado pelo cliente, fora do cache da landing. */
export async function fetchAvailability(eventId: string) {
  const client = createPublicClient();
  const { data } = await client
    .from("v_event_stats")
    .select("capacity, seats_taken, seats_available, status")
    .eq("event_id", eventId)
    .maybeSingle();

  return data;
}

import type { PostgrestError } from "@supabase/supabase-js";

import { AppError, type ErrorCode } from "./app-error";

/**
 * Tradução de erros do Postgres para o domínio (docs/02, seção 12).
 * Nenhuma mensagem crua do banco chega à interface.
 */

/** Constraint/índice → erro de domínio. A chave é o nome exato criado na migration. */
const CONSTRAINT_MAP: Record<string, { code: ErrorCode; message: string }> = {
  uq_registration_active_cpf: {
    code: "ALREADY_REGISTERED",
    message: "Este CPF já possui uma inscrição ativa neste evento.",
  },
  chk_capacity: {
    code: "EVENT_FULL",
    message: "As vagas para este evento se esgotaram.",
  },
  uq_checkin_valid: {
    code: "TICKET_ALREADY_USED",
    message: "Este ingresso já foi utilizado.",
  },
  uq_tenant_slug: {
    code: "CONFLICT",
    message: "Já existe uma empresa com este identificador.",
  },
  uq_event_slug: {
    code: "CONFLICT",
    message: "Já existe um evento com este endereço (slug) nesta empresa.",
  },
  uq_membership_user_tenant: {
    code: "CONFLICT",
    message: "Este usuário já faz parte desta empresa.",
  },
};

/** Erros levantados com RAISE EXCEPTION ... USING ERRCODE nas RPCs. */
const PG_ERRCODE_MAP: Record<string, { code: ErrorCode; message: string }> = {
  IG001: {
    code: "REGISTRATION_CLOSED",
    message: "As inscrições para este evento estão encerradas.",
  },
  IG002: { code: "EVENT_FULL", message: "As vagas para este evento se esgotaram." },
  IG003: { code: "TICKET_INVALID", message: "Ingresso inválido." },
  IG004: { code: "TICKET_ALREADY_USED", message: "Este ingresso já foi utilizado." },
  IG005: { code: "FORBIDDEN", message: "Você não tem permissão para executar esta ação." },
  IG006: { code: "TENANT_REQUIRED", message: "Nenhuma empresa ativa selecionada." },
  IG007: { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde alguns instantes." },
};

function findConstraint(error: PostgrestError): string | undefined {
  const haystack = `${error.message} ${error.details ?? ""}`;
  return Object.keys(CONSTRAINT_MAP).find((name) => haystack.includes(name));
}

export function mapPostgrestError(error: PostgrestError): AppError {
  // Erros customizados das RPCs (RAISE ... USING ERRCODE = 'IG00X')
  const custom = PG_ERRCODE_MAP[error.code];
  if (custom) {
    return new AppError(custom.code, custom.message, { cause: error });
  }

  // Violação de constraint (unique 23505 / check 23514 / fk 23503 / not null 23502)
  if (["23505", "23514", "23503", "23502"].includes(error.code)) {
    const constraint = findConstraint(error);
    if (constraint) {
      const mapped = CONSTRAINT_MAP[constraint]!;
      return new AppError(mapped.code, mapped.message, { cause: error });
    }
    if (error.code === "23505") {
      return new AppError("CONFLICT", "Este registro já existe.", { cause: error });
    }
    if (error.code === "23503") {
      return new AppError("CONFLICT", "Existem registros vinculados que impedem esta operação.", {
        cause: error,
      });
    }
  }

  // RLS negou a operação (nenhuma policy aplicável) ou permissão insuficiente.
  if (error.code === "42501" || error.code === "PGRST301") {
    return AppError.forbidden();
  }

  // Nenhuma linha retornada em consulta com .single()
  if (error.code === "PGRST116") {
    return AppError.notFound();
  }

  return AppError.internal(error);
}

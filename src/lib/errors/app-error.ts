/**
 * Erro de aplicação tipado (docs/02, seção 12).
 * `message` é sempre seguro para exibir ao usuário final, em pt-BR.
 * Detalhes técnicos vão em `cause`/`details` e só chegam ao log.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EVENT_FULL"
  | "ALREADY_REGISTERED"
  | "TICKET_ALREADY_USED"
  | "TICKET_INVALID"
  | "REGISTRATION_CLOSED"
  | "TENANT_REQUIRED"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EVENT_FULL: 409,
  ALREADY_REGISTERED: 409,
  TICKET_ALREADY_USED: 409,
  TICKET_INVALID: 422,
  REGISTRATION_CLOSED: 409,
  TENANT_REQUIRED: 400,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
  httpStatus?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? DEFAULT_STATUS[code];
    this.details = options.details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }

  static unauthenticated(message = "Sessão expirada. Faça login novamente.") {
    return new AppError("UNAUTHENTICATED", message);
  }

  static forbidden(message = "Você não tem permissão para executar esta ação.") {
    return new AppError("FORBIDDEN", message);
  }

  static notFound(message = "Registro não encontrado.") {
    return new AppError("NOT_FOUND", message);
  }

  static internal(cause?: unknown) {
    return new AppError("INTERNAL", "Ocorreu um erro inesperado. Tente novamente.", { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

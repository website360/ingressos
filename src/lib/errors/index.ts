export { AppError, isAppError, type ErrorCode } from "./app-error";
export { mapPostgrestError } from "./pg-error-map";

import { ZodError } from "zod";

import { AppError, isAppError } from "./app-error";

/**
 * Normaliza qualquer erro em AppError. Usado nas bordas:
 * Server Actions, Route Handlers e boundaries de erro do React.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    const fieldErrors = error.flatten().fieldErrors as Record<string, unknown>;
    return new AppError("VALIDATION", "Verifique os campos destacados.", {
      details: fieldErrors,
      cause: error,
    });
  }

  return AppError.internal(error);
}

/** Resultado tipado — evita try/catch espalhado pela UI. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  return { ok: false, error: appError.toJSON() };
}

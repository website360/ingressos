"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from "@shared/schemas/auth";

import { ROUTES } from "@/constants/routes";
import { getRequestContext } from "@/lib/auth/request-context";
import { AppError, fail, ok, type Result } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Server Actions de autenticação.
 * Validam com o MESMO schema do formulário (ADR-010) e registram a trilha em
 * `audit.auth_events` — inclusive as tentativas malsucedidas.
 */

async function logAuthEvent(
  eventType: string,
  success: boolean,
  email?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = await createServerClient();
    const context = await getRequestContext();
    await supabase.rpc("log_auth_event", {
      p_event_type: eventType,
      p_success: success,
      p_email: email ?? null,
      p_metadata: { ...metadata, ip: context.ip, user_agent: context.userAgent } as never,
    });
  } catch {
    // Falha de auditoria nunca bloqueia o login.
  }
}

export async function signIn(input: LoginInput): Promise<Result<{ redirectTo: string }>> {
  try {
    const data = loginSchema.parse(input);
    const supabase = await createServerClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      await logAuthEvent("login_failed", false, data.email, { reason: error.message });
      // Mensagem genérica de propósito: não revela se o e-mail existe.
      throw new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
    }

    await logAuthEvent("login", true, data.email);

    const { data: context } = await supabase.rpc("my_context");
    const tenants = (context as { tenants?: unknown[] } | null)?.tenants ?? [];

    return ok({
      redirectTo: tenants.length > 1 ? ROUTES.auth.selectTenant : ROUTES.admin.dashboard,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await logAuthEvent("logout", true);
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(ROUTES.auth.login);
}

export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<Result<{ sent: true }>> {
  try {
    const data = forgotPasswordSchema.parse(input);
    const supabase = await createServerClient();

    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}${ROUTES.auth.callback}?next=${ROUTES.auth.resetPassword}`,
    });

    await logAuthEvent("password_reset", true, data.email);

    // Resposta sempre positiva — não permite enumerar e-mails cadastrados.
    return ok({ sent: true });
  } catch (error) {
    return fail(error);
  }
}

export async function resetPassword(input: ResetPasswordInput): Promise<Result<{ updated: true }>> {
  try {
    const data = resetPasswordSchema.parse(input);
    const supabase = await createServerClient();

    const { error } = await supabase.auth.updateUser({ password: data.password });
    if (error)
      throw new AppError("VALIDATION", "Não foi possível alterar a senha.", { cause: error });

    return ok({ updated: true });
  } catch (error) {
    return fail(error);
  }
}

import "server-only";

import { cache } from "react";

import { AppError } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

import { can, canAny, type Permission } from "./permissions";

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string | null;
  status: string;
  role: UserRole;
  is_owner: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  locale: string;
  mfa_enabled: boolean;
  is_platform_admin: boolean;
}

export interface Session {
  user: SessionUser;
  activeTenantId: string | null;
  activeTenant: SessionTenant | null;
  tenants: SessionTenant[];
  role: UserRole | null;
  permissions: string[];
}

/**
 * Contexto da sessão em uma única chamada (RPC api.my_context).
 * `cache` do React deduplica entre todos os Server Components da mesma
 * requisição — o painel inteiro custa um round-trip.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sem usuário = visitante. É o único caso legítimo de sessão nula.
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_context");

  if (error || !data) {
    // Usuário autenticado cujo contexto não carrega é falha de infraestrutura,
    // não sessão expirada. Tratar como "deslogado" aqui produziria uma tela em
    // branco silenciosa — o erro precisa chegar ao log com a causa real.
    // Mensagem em linha única: o overlay de erro do Next colapsa objetos e
    // esconderia justamente o código do Postgres, que é o que interessa aqui.
    const code = error?.code ?? "SEM_ERRO";
    const detail = error?.message ?? "a RPC respondeu vazio";

    console.error(
      `[session] api.my_context falhou — código=${code} · ${detail}` +
        (code === "PGRST106"
          ? "\n  → O schema `api` não está exposto na Data API do Supabase." +
            "\n    Painel → Project Settings → Data API → Exposed schemas → adicionar `api` e `audit`." +
            "\n    Diagnóstico completo: npm run doctor"
          : "") +
        `\n  usuário=${user.id}`,
    );

    throw new AppError(
      "INTERNAL",
      code === "PGRST106"
        ? "A API do banco não está configurada: o schema `api` precisa ser exposto no painel do Supabase."
        : "Não foi possível carregar os dados da sua empresa. Tente novamente em instantes.",
      { details: { code, message: detail }, cause: error },
    );
  }

  const context = data as unknown as {
    user: SessionUser;
    active_tenant_id: string | null;
    tenants: SessionTenant[];
    permissions: string[];
    role: UserRole | null;
  };

  const activeTenant =
    context.tenants.find((tenant) => tenant.id === context.active_tenant_id) ?? null;

  return {
    user: context.user,
    activeTenantId: context.active_tenant_id,
    activeTenant,
    tenants: context.tenants,
    role: context.role,
    permissions: context.permissions ?? [],
  };
});

/** Exige sessão. Use em Server Components e Server Actions do painel. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw AppError.unauthenticated();
  return session;
}

/** Exige sessão com empresa ativa. */
export async function requireTenant(): Promise<Session & { activeTenantId: string }> {
  const session = await requireSession();
  if (!session.activeTenantId) {
    throw new AppError("TENANT_REQUIRED", "Selecione uma empresa para continuar.");
  }
  return session as Session & { activeTenantId: string };
}

/** Exige uma permissão específica. A RLS é a barreira real; isto melhora a mensagem. */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireTenant();
  if (!can(session.permissions, permission)) throw AppError.forbidden();
  return session;
}

export async function requireAnyPermission(permissions: readonly Permission[]): Promise<Session> {
  const session = await requireTenant();
  if (!canAny(session.permissions, permissions)) throw AppError.forbidden();
  return session;
}

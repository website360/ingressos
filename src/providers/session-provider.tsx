"use client";

import * as React from "react";

import type { Session } from "@/lib/auth/session";
import { can, canAll, canAny, type Permission } from "@/lib/auth/permissions";

interface SessionContextValue extends Session {
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

/**
 * Sessão hidratada pelo servidor — o cliente não refaz a consulta no boot.
 *
 * Sistema de empresa única: não há troca de empresa. A infraestrutura de
 * `tenant_id` permanece no banco (ver migration 20260801091200_single_company),
 * mas não existe escolha na interface.
 */
export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const value = React.useMemo<SessionContextValue>(
    () => ({
      ...session,
      can: (permission) => can(session.permissions, permission),
      canAny: (permissions) => canAny(session.permissions, permissions),
      canAll: (permissions) => canAll(session.permissions, permissions),
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error("useSession deve ser usado dentro de <SessionProvider>.");
  return context;
}

/** Açúcar para esconder ações que o usuário não pode executar. */
export function usePermission(permission: Permission): boolean {
  return useSession().can(permission);
}

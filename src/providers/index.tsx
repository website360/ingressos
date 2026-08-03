"use client";

import * as React from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import type { Session } from "@/lib/auth/session";

import { QueryProvider } from "./query-provider";
import { SessionProvider } from "./session-provider";
import { ThemeProvider } from "./theme-provider";

/** Providers globais da aplicação (sem sessão — usado no layout raiz). */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}

/** Providers do painel autenticado. */
export function AdminProviders({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}

"use client";

import * as React from "react";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";

/**
 * Boundary do painel. Sem ele, uma falha em Server Component do grupo (admin)
 * — sessão, permissão, RPC — resulta em página em branco sem pista alguma.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[admin-error]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <CardTitle>Não foi possível carregar esta página</CardTitle>
          <CardDescription>{error.message}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error.digest && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Código: {error.digest}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={reset} className="flex-1">
              <RotateCcw /> Tentar novamente
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <Link href={ROUTES.auth.login}>Voltar ao login</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

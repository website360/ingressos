"use client";

import * as React from "react";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // O digest correlaciona esta tela com o log do servidor (docs/02, seção 14).
    console.error("[app-error]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <CardTitle>Algo deu errado</CardTitle>
          <CardDescription>
            Não foi possível carregar esta página. Tente novamente — se persistir, informe o código
            abaixo ao suporte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.digest && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {error.digest}
            </p>
          )}
          <Button onClick={reset} className="w-full">
            <RotateCcw /> Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Acessar o painel</CardTitle>
        <CardDescription>Entre com suas credenciais para gerenciar seus eventos.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* useSearchParams exige um boundary de Suspense no App Router. */}
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}

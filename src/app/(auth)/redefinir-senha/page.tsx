import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = {
  title: "Nova senha",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Criar nova senha</CardTitle>
        <CardDescription>
          Use ao menos 8 caracteres, com letras maiúsculas, minúsculas e números.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}

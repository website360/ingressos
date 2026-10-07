import type { Metadata } from "next";
import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SecondCopyForm } from "@/features/tickets/components/second-copy-form";

export const metadata: Metadata = {
  title: "Segunda via do ingresso",
  description: "Perdeu o link do seu ingresso? Recupere pelo CPF usado na inscrição.",
  // A página leva ao ingresso de alguém: fora do índice, como a do próprio
  // ingresso.
  robots: { index: false, follow: false, nocache: true },
};

export default function SecondCopyPage() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Segunda via do ingresso</h1>
        <p className="text-sm text-muted-foreground">
          Perdeu o e-mail com o link? Informe o CPF da inscrição e recupere o ingresso em dois
          passos.
        </p>
      </div>

      <SecondCopyForm />

      <Alert variant="info">
        <Info />
        <AlertTitle>Por que pedimos um código</AlertTitle>
        <AlertDescription>
          O link do ingresso vale como entrada no evento: quem o tem passa na portaria. O código
          enviado aos seus contatos é o que garante que o ingresso só chegue a você.
        </AlertDescription>
      </Alert>
    </div>
  );
}

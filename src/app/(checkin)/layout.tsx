import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ScanLine } from "lucide-react";

import { ROUTES } from "@/constants/routes";
import { getSession } from "@/lib/auth/session";

/**
 * Layout do aplicativo de check-in.
 *
 * Enxuto de propósito: sem sidebar, sem busca global, sem navegação lateral.
 * Quem opera a portaria tem uma tarefa só, com uma fila esperando — cada
 * elemento a mais na tela é uma chance de toque errado.
 */
export default async function CheckinLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect(ROUTES.auth.login);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4">
        <Link
          href={ROUTES.admin.dashboard}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Voltar ao painel"
        >
          <ArrowLeft className="size-5" />
        </Link>

        <span className="flex items-center gap-2 font-semibold">
          <ScanLine className="size-5 text-primary" />
          Check-in
        </span>

        <span className="ml-auto truncate text-sm text-muted-foreground">
          {session.user.full_name.split(" ")[0]}
        </span>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}

import Link from "next/link";
import { Ticket } from "lucide-react";

import { ROUTES } from "@/constants/routes";

/**
 * Layout das telas de autenticação.
 * Usa as superfícies especiais do Design System (.bg-grid + .bg-radial-primary).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="bg-radial-primary pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        <Link
          href={ROUTES.home}
          className="mb-8 flex items-center justify-center gap-2.5 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow">
            <Ticket className="size-5" />
          </span>
          Ingressos
        </Link>

        {children}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Ao continuar, você concorda com os termos de uso e a política de privacidade.
        </p>
      </div>
    </div>
  );
}

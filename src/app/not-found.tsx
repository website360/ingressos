import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="relative z-10 space-y-4">
        <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Compass className="size-6" />
        </span>
        <h1 className="text-gradient text-4xl font-semibold tracking-tight">404</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <Button asChild>
          <Link href={ROUTES.home}>Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
}

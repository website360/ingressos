"use client";

import * as React from "react";

import { Check, Copy, ExternalLink, Link2Off } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES } from "@/constants/routes";
import type { EventStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** A página pública só existe para evento publicado — a RLS bloqueia o resto. */
function isLive(status: EventStatus | string | null | undefined): boolean {
  return status === "publicado";
}

interface Props {
  slug: string;
  status: EventStatus | string | null | undefined;
  /** `full` mostra a URL e o botão de copiar; `icon` é só o ícone, para tabelas. */
  variant?: "full" | "icon";
  className?: string;
}

export function PublicEventLink({ slug, status, variant = "full", className }: Props) {
  const [copied, setCopied] = React.useState(false);
  const [origin, setOrigin] = React.useState("");

  // A origem real só é conhecida no cliente — em produção o domínio é outro.
  React.useEffect(() => setOrigin(window.location.origin), []);

  const path = ROUTES.public.event(slug);
  const url = `${origin}${path}`;
  const live = isLive(status);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

  if (variant === "icon") {
    if (!live) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-8 items-center justify-center text-muted-foreground/40">
              <Link2Off className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Publique o evento para gerar a página pública</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            // A linha inteira navega para o painel; o link público é outra coisa.
            onClick={(event) => event.stopPropagation()}
          >
            <a href={path} target="_blank" rel="noreferrer" aria-label="Abrir página pública">
              <ExternalLink />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Abrir página pública</TooltipContent>
      </Tooltip>
    );
  }

  if (!live) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Link2Off className="size-4 shrink-0" />
        Publique o evento para que a página pública fique acessível.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted px-3 py-2 text-xs">
        {url || path}
      </code>

      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={path} target="_blank" rel="noreferrer">
            <ExternalLink /> Abrir
          </a>
        </Button>
      </div>
    </div>
  );
}

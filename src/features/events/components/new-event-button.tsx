"use client";

import * as React from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  NewEventWizard,
  type WizardTemplate,
} from "@/features/events/components/wizard/new-event-wizard";

interface Props {
  templates: WizardTemplate[];
  canPublish: boolean;
  canManageSettings: boolean;
}

/**
 * Botão "Novo evento" e o assistente. `?novo=1` abre direto — é para onde
 * `/eventos/novo` redireciona, para não quebrar links e favoritos antigos.
 */
export function NewEventButton(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(searchParams.get("novo") === "1");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && searchParams.get("novo")) {
      const params = new URLSearchParams(searchParams);
      params.delete("novo");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlus /> Novo evento
      </Button>
      <NewEventWizard open={open} onOpenChange={onOpenChange} {...props} />
    </>
  );
}

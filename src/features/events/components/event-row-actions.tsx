"use client";

import * as React from "react";

import { MoreVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteEventDialog } from "@/features/events/components/delete-event-button";

interface Props {
  eventId: string;
  name: string;
  registrations: number;
}

/** Menu "⋯" de ações de um evento na lista. */
export function EventRowActions({ eventId, name, registrations }: Props) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Menu e diálogo vão para portais, mas o clique do React ainda sobe pela
  // árvore até a linha da tabela — e a linha abre o evento.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label={`Ações de ${name}`}
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteEventDialog
        eventId={eventId}
        name={name}
        registrations={registrations}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
      />
    </span>
  );
}

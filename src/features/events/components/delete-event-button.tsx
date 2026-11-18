"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROUTES } from "@/constants/routes";
import { archiveEvent } from "@/features/events/actions/event.actions";
import { toastActionFailure } from "@/lib/action-failure";
import { formatNumber } from "@/lib/format";

interface Props {
  eventId: string;
  name: string;
  /** Inscrições ativas — entram no aviso, para ninguém excluir sem perceber. */
  registrations: number;
  /** `icon` para a linha da tabela; `button` para o cabeçalho do evento. */
  variant?: "icon" | "button";
}

/**
 * Exclui o evento: some da lista e a página pública sai do ar. As inscrições
 * ficam guardadas (RN-10) — o aviso diz isso para não assustar nem enganar.
 */
export function DeleteEventButton({ eventId, name, registrations, variant = "button" }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function confirm() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof archiveEvent>>;
      try {
        result = await archiveEvent(eventId);
      } catch (error) {
        toastActionFailure(error);
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Evento excluído.");
      setOpen(false);
      // Na página do evento não há o que mostrar depois; na lista, fica nela
      // (com filtros e página atuais) e só some a linha.
      if (variant === "button") router.push(ROUTES.admin.events);
      router.refresh();
    });
  }

  // O Dialog vai para um portal, mas o evento de clique do React ainda sobe
  // pela árvore até a linha da tabela — e a linha abre o evento.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      {variant === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Excluir ${name}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 /> Excluir
        </Button>
      )}

      <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{name}”?</DialogTitle>
            <DialogDescription>
              O evento sai da lista e a página pública deixa de funcionar — o link de inscrição
              para de aceitar novos participantes.
            </DialogDescription>
          </DialogHeader>

          {registrations > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              Este evento tem <strong>{formatNumber(registrations)}</strong>{" "}
              {registrations === 1 ? "inscrição" : "inscrições"}. Elas continuam guardadas, mas
              ninguém é avisado da exclusão — se o evento foi cancelado, avise os inscritos antes.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Manter evento
            </Button>
            <Button variant="destructive" onClick={confirm} loading={isPending}>
              <Trash2 /> Excluir evento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

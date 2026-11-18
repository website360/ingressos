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

interface EventRef {
  eventId: string;
  name: string;
  /** Inscrições ativas — entram no aviso, para ninguém excluir sem perceber. */
  registrations: number;
}

interface DialogProps extends EventRef {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Para onde ir depois de excluir. Sem valor, fica na tela e só atualiza. */
  redirectTo?: string;
}

/**
 * Confirmação de exclusão. O evento some da lista e a página pública sai do
 * ar; as inscrições ficam guardadas (RN-10) — o aviso diz isso para não
 * assustar nem enganar.
 */
export function DeleteEventDialog({
  eventId,
  name,
  registrations,
  open,
  onOpenChange,
  redirectTo,
}: DialogProps) {
  const router = useRouter();
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
      onOpenChange(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir “{name}”?</DialogTitle>
          <DialogDescription>
            O evento sai da lista e a página pública deixa de funcionar — o link de inscrição para
            de aceitar novos participantes.
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Manter evento
          </Button>
          <Button variant="destructive" onClick={confirm} loading={isPending}>
            <Trash2 /> Excluir evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Excluir" do cabeçalho da página do evento. */
export function DeleteEventButton(props: EventRef) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 /> Excluir
      </Button>
      <DeleteEventDialog
        {...props}
        open={open}
        onOpenChange={setOpen}
        redirectTo={ROUTES.admin.events}
      />
    </>
  );
}

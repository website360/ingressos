"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

import {
  CANCEL_REASONS,
  cancelRegistrationSchema,
  type CancelRegistrationInput,
} from "@shared/schemas/registration";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cancelOwnRegistration } from "@/features/registrations/actions/registration.actions";

/**
 * Cancelamento pelo participante.
 *
 * Exige motivo e confirmação explícita: a operação é irreversível (RN-04) —
 * reinscrever gera um ingresso novo, com QR novo. O antigo é revogado na mesma
 * transação que libera a vaga.
 */
export function CancelRegistration({
  registrationId,
  eventName,
}: {
  registrationId: string;
  eventName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<CancelRegistrationInput>({
    resolver: zodResolver(cancelRegistrationSchema),
    defaultValues: { reason_code: "", reason_text: "" },
  });

  function onSubmit(values: CancelRegistrationInput) {
    startTransition(async () => {
      const result = await cancelOwnRegistration(registrationId, values);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Inscrição cancelada. Sua vaga foi liberada.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full text-muted-foreground">
          <XCircle /> Cancelar minha inscrição
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar inscrição</DialogTitle>
          <DialogDescription>
            Você deixará de participar de <span className="font-medium">{eventName}</span>. O
            ingresso é invalidado na hora e a vaga volta a ficar livre para outra pessoa. Esta ação
            não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o motivo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CANCEL_REASONS.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comentário (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ajuda a melhorar os próximos eventos." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Manter inscrição
              </Button>
              <Button type="submit" variant="destructive" loading={isPending}>
                Confirmar cancelamento
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

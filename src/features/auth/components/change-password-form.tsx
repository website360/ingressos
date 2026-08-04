"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { resetPasswordSchema, type ResetPasswordInput } from "@shared/schemas/auth";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/features/auth/actions/auth.actions";

/**
 * Troca de senha de quem já está logado.
 *
 * Compartilha a ação e o schema com a redefinição por e-mail — é a mesma
 * operação no Supabase (`updateUser`), muda só o que trouxe a pessoa até aqui.
 * O que difere do outro formulário é o depois: lá o destino é o painel, porque
 * a pessoa chegou por um link e precisa ser levada para dentro; aqui ela já
 * está onde queria e só recebe a confirmação.
 */
export function ChangePasswordForm() {
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            const result = await resetPassword(values);
            if (!result.ok) {
              toast.error(result.error.message);
              return;
            }
            toast.success("Senha alterada com sucesso.");
            form.reset();
          }),
        )}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nova senha</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="new-password"
                  startIcon={<KeyRound />}
                  disabled={isPending}
                />
              </FormControl>
              <FormDescription>
                Mínimo de 8 caracteres, com maiúscula, minúscula e número.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirmar nova senha</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="new-password"
                  startIcon={<KeyRound />}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" loading={isPending}>
          Salvar nova senha
        </Button>
      </form>
    </Form>
  );
}

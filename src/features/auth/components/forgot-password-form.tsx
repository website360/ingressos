"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Mail } from "lucide-react";
import { useForm } from "react-hook-form";

import { forgotPasswordSchema, type ForgotPasswordInput } from "@shared/schemas/auth";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/auth/actions/auth.actions";

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  if (sent) {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Verifique seu e-mail</AlertTitle>
        <AlertDescription>
          Se houver uma conta com este e-mail, o link de redefinição chegará em instantes. Ele vale
          por 1 hora.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            await requestPasswordReset(values);
            // Sempre confirma, mesmo se o e-mail não existir: impede enumeração de contas.
            setSent(true);
          }),
        )}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>E-mail</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="email"
                  placeholder="voce@empresa.com.br"
                  startIcon={<Mail />}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" loading={isPending}>
          Enviar link de recuperação
        </Button>
      </form>
    </Form>
  );
}

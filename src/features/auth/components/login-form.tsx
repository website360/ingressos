"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { loginSchema, type LoginInput } from "@shared/schemas/auth";

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
import { ROUTES } from "@/constants/routes";
import { signIn } from "@/features/auth/actions/auth.actions";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", remember: true },
  });

  function onSubmit(values: LoginInput) {
    startTransition(async () => {
      const result = await signIn(values);

      if (!result.ok) {
        form.setError("password", { message: result.error.message });
        toast.error(result.error.message);
        return;
      }

      // `next` só é aceito se for um caminho interno — evita open redirect.
      const next = searchParams.get("next");
      const destination =
        next?.startsWith("/") && !next.startsWith("//") ? next : result.data.redirectTo;

      router.replace(destination);
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Senha</FormLabel>
                <Link
                  href={ROUTES.auth.forgotPassword}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <FormControl>
                <Input
                  {...field}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  startIcon={<KeyRound />}
                  disabled={isPending}
                  endIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="pointer-events-auto transition-colors hover:text-foreground"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" size="lg" loading={isPending}>
          Entrar
        </Button>
      </form>
    </Form>
  );
}

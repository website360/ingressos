"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { companySchema, type CompanyInput } from "@shared/schemas/company";
import { BR_STATES, formatBrPhone } from "@shared/validation/phone";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateCompany } from "@/features/settings/actions/company.actions";
import type { Tables } from "@/lib/supabase/database.types";

interface Props {
  company: Tables<"tenants">;
  canEdit: boolean;
}

export function CompanyForm({ company, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<CompanyInput>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: company.name,
      document: company.document ?? "",
      contact_email: company.contact_email ?? "",
      contact_phone: company.contact_phone ?? "",
      brand_color: company.brand_color ?? "#2563eb",
      timezone: company.timezone,
      address: company.address ?? "",
      city: company.city ?? "",
      state: (company.state as CompanyInput["state"]) ?? "",
      zip_code: company.zip_code ?? "",
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          startTransition(async () => {
            const result = await updateCompany(values);
            if (!result.ok) {
              toast.error(result.error.message);
              return;
            }
            toast.success("Dados da empresa atualizados.");
            router.refresh();
          }),
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados da empresa</CardTitle>
            <CardDescription>
              Aparecem nas páginas públicas, nos ingressos em PDF e nos e-mails.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Alert variant="info" className="sm:col-span-2">
              <AlertDescription>
                O contato abaixo é herdado por todo evento novo — não é pedido de novo no cadastro
                de eventos.
              </AlertDescription>
            </Alert>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!canEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="document"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CNPJ</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="numeric" disabled={!canEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contact_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail de contato</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" disabled={!canEdit} />
                  </FormControl>
                  <FormDescription>Exibido na página pública dos eventos.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contact_phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="(11) 99999-8888"
                      disabled={!canEdit}
                      onChange={(event) => field.onChange(formatBrPhone(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cidade</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!canEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                    disabled={!canEdit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="UF" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BR_STATES.map((uf) => (
                        <SelectItem key={uf} value={uf}>
                          {uf}
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
              name="brand_color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cor da marca</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input {...field} placeholder="#2563eb" disabled={!canEdit} />
                    </FormControl>
                    <span
                      className="size-9 shrink-0 rounded-lg border"
                      style={{ backgroundColor: field.value || "#2563eb" }}
                      aria-hidden
                    />
                  </div>
                  <FormDescription>Usada nas páginas públicas, não no painel.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuso horário</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!canEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {canEdit && (
              <div className="sm:col-span-2">
                <Button type="submit" loading={isPending}>
                  <Save /> Salvar alterações
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}

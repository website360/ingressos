"use client";

import * as React from "react";

import { QrCode, ShieldCheck } from "lucide-react";

import { EvolutionServerForm } from "@/features/whatsapp/components/evolution-server-form";
import { MetaConnectionForm } from "@/features/whatsapp/components/meta-connection-form";
import { cn } from "@/lib/utils";
import type { WhatsappConnectionView } from "@/repositories/whatsapp.repository";

interface Props {
  connection: WhatsappConnectionView | null;
  canEdit: boolean;
  appUrl: string;
}

type Provider = "evolution" | "meta";

const OPTIONS: { value: Provider; title: string; hint: string; icon: typeof QrCode }[] = [
  {
    value: "evolution",
    title: "Evolution (QR Code)",
    hint: "Número comum pareado pelo celular. Sem custo por mensagem; risco de bloqueio.",
    icon: QrCode,
  },
  {
    value: "meta",
    title: "API oficial da Meta",
    hint: "Número verificado e modelos aprovados. Custo por mensagem, cobrado pela Meta.",
    icon: ShieldCheck,
  },
];

/**
 * Escolha do provedor do WhatsApp. Só um fica ativo por empresa: o formulário
 * do outro só passa a valer depois de salvo, e salvar substitui o anterior.
 */
export function WhatsappProviderSettings({ connection, canEdit, appUrl }: Props) {
  const active = (connection?.provider as Provider | undefined) ?? null;
  const [shown, setShown] = React.useState<Provider>(active ?? "evolution");

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Provedor do WhatsApp"
        className="grid gap-3 sm:grid-cols-2"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = shown === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setShown(option.value)}
              className={cn(
                "flex gap-3 rounded-xl border p-4 text-left transition-colors",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", selected && "text-primary")} />
              <span className="space-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {option.title}
                  {active === option.value && (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                      Em uso
                    </span>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {active && shown !== active && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Ao salvar, o envio passa a ser feito por{" "}
          <strong>{OPTIONS.find((o) => o.value === shown)!.title}</strong> e a configuração atual
          {active === "evolution"
            ? " da Evolution é removida (o celular é desconectado)."
            : " da Meta é removida."}
        </p>
      )}

      {shown === "evolution" ? (
        <EvolutionServerForm
          connection={active === "evolution" ? connection : null}
          canEdit={canEdit}
        />
      ) : (
        <MetaConnectionForm connection={connection} canEdit={canEdit} appUrl={appUrl} />
      )}
    </div>
  );
}

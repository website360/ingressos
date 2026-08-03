"use client";

import * as React from "react";

import {
  AlertTriangle,
  CheckCircle2,
  MapPinOff,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CheckinResponse } from "@/features/checkin/actions/checkin.actions";
import { formatDateTime, formatDistanceMeters } from "@/lib/format";
import { cn } from "@/lib/utils";

const RESULT_UI = {
  sucesso: {
    icon: CheckCircle2,
    title: "Entrada confirmada",
    tone: "border-success/40 bg-success/10 text-success",
  },
  duplicado: {
    icon: AlertTriangle,
    title: "INGRESSO JÁ UTILIZADO",
    tone: "border-warning/40 bg-warning/10 text-warning",
  },
  cancelado: {
    icon: XCircle,
    title: "Inscrição cancelada",
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  invalido: {
    icon: ShieldAlert,
    title: "Ingresso inválido",
    tone: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  fora_do_raio: {
    icon: MapPinOff,
    title: "Fora do local do evento",
    tone: "border-warning/40 bg-warning/10 text-warning",
  },
} as const;

interface Props {
  result: CheckinResponse;
  canOverride: boolean;
  onDismiss: () => void;
  onOverride: (reason: string) => void;
  isPending: boolean;
}

export function CheckinResult({ result, canOverride, onDismiss, onOverride, isPending }: Props) {
  const [reason, setReason] = React.useState("");
  const ui = RESULT_UI[result.result];
  const Icon = ui.icon;

  // Retorno sonoro e tátil: na portaria o operador olha para a fila, não para
  // a tela. Frequência e padrão distintos por resultado.
  React.useEffect(() => {
    const patterns: Record<string, number[]> = {
      sucesso: [40],
      duplicado: [60, 60, 60],
      cancelado: [120, 60, 120],
      invalido: [120, 60, 120],
      fora_do_raio: [60, 60, 60],
    };
    navigator.vibrate?.(patterns[result.result] ?? [40]);

    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.frequency.value = result.result === "sucesso" ? 880 : 220;
      gain.gain.value = 0.08;
      oscillator.start();
      oscillator.stop(audio.currentTime + (result.result === "sucesso" ? 0.12 : 0.3));
    } catch {
      // Sem áudio disponível: a vibração e a cor já comunicam.
    }
  }, [result]);

  return (
    <Card className={cn("border-2", ui.tone)}>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Icon className="size-12" />
          <p className="text-lg font-semibold uppercase tracking-wide">{ui.title}</p>
        </div>

        {result.attendee && (
          <div className="space-y-1 rounded-lg bg-background p-4 text-center">
            <p className="text-xl font-semibold text-foreground">{result.attendee.name}</p>
            <p className="tabular text-sm text-muted-foreground">{result.attendee.cpf_masked}</p>
            {result.registration_number && (
              <p className="tabular text-xs text-muted-foreground">{result.registration_number}</p>
            )}
            {result.event && (
              <Badge variant="muted" className="mt-1">
                {result.event.name}
              </Badge>
            )}
          </div>
        )}

        {/* Duplicidade precisa mostrar a prova da primeira entrada (RF-07.4). */}
        {result.result === "duplicado" && result.first_checkin && (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Primeira entrada</AlertTitle>
            <AlertDescription>
              {formatDateTime(result.first_checkin.at)}
              {result.first_checkin.operator && ` · por ${result.first_checkin.operator}`}
            </AlertDescription>
          </Alert>
        )}

        {result.result === "fora_do_raio" && (
          <div className="space-y-3">
            <Alert variant="warning">
              <MapPinOff />
              <AlertTitle>Check-in a {formatDistanceMeters(result.distance_m)} do local</AlertTitle>
              <AlertDescription>
                {canOverride
                  ? "Você pode validar mesmo assim. A exceção fica registrada na auditoria com o motivo informado."
                  : "Seu perfil não permite validar fora do raio. Procure um administrador."}
              </AlertDescription>
            </Alert>

            {canOverride && (
              <div className="space-y-2">
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Motivo (obrigatório)"
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={reason.trim().length < 3}
                  loading={isPending}
                  onClick={() => onOverride(reason.trim())}
                >
                  Validar mesmo assim
                </Button>
              </div>
            )}
          </div>
        )}

        {result.message && !result.attendee && (
          <p className="text-center text-sm text-muted-foreground">{result.message}</p>
        )}

        <Button size="lg" className="w-full" onClick={onDismiss}>
          <RotateCcw /> Próximo participante
        </Button>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut, QrCode, RefreshCw, Smartphone } from "lucide-react";

import { formatBrPhone } from "@shared/validation/phone";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  connectWhatsapp,
  disconnectWhatsapp,
  refreshWhatsappStatus,
} from "@/features/whatsapp/actions/connection.actions";
import type { WhatsappState } from "@/lib/evolution/protocol";
import type { WhatsappConnectionView } from "@/repositories/whatsapp.repository";

interface Props {
  connection: WhatsappConnectionView;
  canManage: boolean;
  /** `NEXT_PUBLIC_APP_URL` — o endereço que a Evolution vai chamar de volta. */
  appUrl: string;
}

const STATE_LABEL: Record<WhatsappState, string> = {
  nunca_conectado: "Nunca conectado",
  conectando: "Aguardando leitura",
  conectado: "Conectado",
  desconectado: "Desconectado",
};

const STATE_VARIANT: Record<WhatsappState, "success" | "warning" | "muted" | "destructive"> = {
  nunca_conectado: "muted",
  conectando: "warning",
  conectado: "success",
  desconectado: "destructive",
};

/** De quanto em quanto tempo perguntamos o estado enquanto o QR está na tela. */
const POLL_MS = 3_000;

export function ConnectionPanel({ connection, canManage, appUrl }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [state, setState] = React.useState<WhatsappState>(connection.state);
  const [phone, setPhone] = React.useState(connection.phone_number);
  const [qrCode, setQrCode] = React.useState<string | null>(connection.qr_code);
  const [expiresAt, setExpiresAt] = React.useState<number | null>(
    connection.qr_expires_at ? new Date(connection.qr_expires_at).getTime() : null,
  );
  const [expired, setExpired] = React.useState(false);

  const waiting = state === "conectando" && Boolean(qrCode);

  /**
   * A Evolution avisa por webhook, mas ela precisa alcançar este servidor para
   * isso — e num ambiente local, ou atrás de rede fechada, não alcança. A
   * consulta em laço é o caminho que sempre funciona; o webhook só a torna
   * instantânea.
   */
  React.useEffect(() => {
    if (!waiting) return;

    const timer = setInterval(async () => {
      const result = await refreshWhatsappStatus();
      if (!result.ok) return;

      setState(result.data.state);
      setPhone(result.data.phoneNumber);

      if (result.data.state === "conectado") {
        setQrCode(null);
        setExpiresAt(null);
        toast.success("WhatsApp conectado.");
        router.refresh();
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [waiting, router]);

  /** O QR do WhatsApp morre em menos de um minuto; avisa em vez de enganar. */
  React.useEffect(() => {
    if (!waiting || !expiresAt) return;
    setExpired(false);

    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }

    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [waiting, expiresAt]);

  function requestQr() {
    startTransition(async () => {
      const result = await connectWhatsapp();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!result.data.qrCode) {
        toast.error("A Evolution não devolveu o QR Code. Tente novamente em alguns segundos.");
        return;
      }
      setQrCode(result.data.qrCode);
      setState("conectando");
      setExpiresAt(Date.now() + 60_000);
      setExpired(false);
    });
  }

  const localhost = /localhost|127\.0\.0\.1/.test(appUrl);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" /> Situação do número
          </CardTitle>
          <CardDescription>
            Instância <code>{connection.instance_name ?? "ainda não criada"}</code> no servidor{" "}
            <code>{connection.base_url}</code>.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
          {phone && <span className="text-sm text-muted-foreground">{formatBrPhone(phone)}</span>}
          {connection.last_connected_at && state === "conectado" && (
            <span className="text-xs text-muted-foreground">
              desde {new Date(connection.last_connected_at).toLocaleString("pt-BR")}
            </span>
          )}
          {connection.last_error && (
            <span className="text-xs text-destructive">{connection.last_error}</span>
          )}
        </CardContent>
      </Card>

      {localhost && (
        <Alert>
          <AlertDescription>
            <code>NEXT_PUBLIC_APP_URL</code> aponta para <code>{appUrl}</code>. O servidor Evolution
            não consegue chamar esse endereço, então o aviso de conexão não chega por webhook — esta
            tela vai descobrir o pareamento perguntando a cada {POLL_MS / 1000} segundos, o que
            funciona igual. Para o webhook funcionar, publique o sistema num endereço acessível.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="size-4" /> Parear o celular
          </CardTitle>
          <CardDescription>
            No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {qrCode && state !== "conectado" ? (
            <div className="flex flex-col items-center gap-3">
              {/* Data URL vinda da Evolution: o otimizador do next/image não
                  tem o que fazer com base64, e `<img>` evita o round-trip. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt="QR Code para conectar o WhatsApp"
                width={288}
                height={288}
                className={`size-72 rounded-lg border bg-white p-2 ${expired ? "opacity-30" : ""}`}
              />

              {expired ? (
                <p className="text-sm text-muted-foreground">
                  Este QR Code expirou. Gere outro para continuar.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Aguardando a leitura…
                </p>
              )}
            </div>
          ) : state === "conectado" ? (
            <p className="text-sm text-muted-foreground">
              O número está conectado. Os ingressos são enviados por WhatsApp junto com o e-mail.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum pareamento em andamento. Gere o QR Code para conectar o celular.
            </p>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2">
              {state !== "conectado" && (
                <Button onClick={requestQr} disabled={isPending}>
                  {isPending ? <Loader2 className="animate-spin" /> : <QrCode />}
                  {qrCode ? "Gerar novo QR Code" : "Conectar celular"}
                </Button>
              )}

              <Button
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await refreshWhatsappStatus();
                    if (!result.ok) {
                      toast.error(result.error.message);
                      return;
                    }
                    setState(result.data.state);
                    setPhone(result.data.phoneNumber);
                    toast.success(`Situação: ${STATE_LABEL[result.data.state]}.`);
                    router.refresh();
                  })
                }
              >
                <RefreshCw /> Atualizar situação
              </Button>

              {state === "conectado" && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={isPending}
                  onClick={() => {
                    if (!confirm("Desconectar o número? Os envios param até parear de novo."))
                      return;
                    startTransition(async () => {
                      const result = await disconnectWhatsapp();
                      if (!result.ok) {
                        toast.error(result.error.message);
                        return;
                      }
                      setState("desconectado");
                      setPhone(null);
                      setQrCode(null);
                      toast.success("Número desconectado.");
                      router.refresh();
                    });
                  }}
                >
                  <LogOut /> Desconectar
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

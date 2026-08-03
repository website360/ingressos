"use client";

import * as React from "react";

import { toast } from "sonner";
import {
  CloudOff,
  Download,
  Loader2,
  MapPin,
  RefreshCw,
  ScanLine,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadManifest,
  performCheckin,
  searchAttendees,
  syncOfflineCheckins,
  type AttendeeSearchResult,
  type CheckinResponse,
} from "@/features/checkin/actions/checkin.actions";
import { CheckinResult } from "@/features/checkin/components/checkin-result";
import { QrScanner } from "@/features/checkin/components/qr-scanner";
import { useDebounce } from "@/hooks/use-debounce";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatRelative } from "@/lib/format";
import {
  getDeviceId,
  hashCode,
  offlineDb,
  type OfflineManifest,
  type QueuedCheckin,
} from "@/lib/offline/db";

interface Props {
  eventId: string;
  eventName: string;
  canOverride: boolean;
}

export function CheckinStation({ eventId, eventName, canOverride }: Props) {
  const [result, setResult] = React.useState<CheckinResponse | null>(null);
  const [lastToken, setLastToken] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const [manifest, setManifest] = React.useState<OfflineManifest | null>(null);
  const [pending, setPending] = React.useState<QueuedCheckin[]>([]);
  const [isPreparing, setIsPreparing] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);

  const { position, state: geoState, request: requestGeo } = useGeolocation();

  const refreshPending = React.useCallback(async () => {
    setPending(await offlineDb.pending());
  }, []);

  const sync = React.useCallback(async () => {
    const queue = await offlineDb.pending();
    if (queue.length === 0) return;

    setIsSyncing(true);
    const outcome = await syncOfflineCheckins(
      queue.map((item) => ({
        idempotency_key: item.idempotency_key,
        token: item.token,
        checked_in_at: item.checked_in_at,
        device_id: item.device_id,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy_m: item.accuracy_m,
        override: item.override,
        override_reason: item.override_reason,
      })),
    );
    setIsSyncing(false);

    if (!outcome.ok) {
      toast.error(`Falha ao sincronizar: ${outcome.error.message}`);
      return;
    }

    await offlineDb.markSynced(outcome.data.map((item) => item.idempotency_key));
    await refreshPending();

    const conflicts = outcome.data.filter(
      (item) => item.result !== "sucesso" && item.result !== "ja_sincronizado",
    );

    toast.success(
      `${outcome.data.length} check-ins sincronizados` +
        (conflicts.length ? ` · ${conflicts.length} com divergência` : ""),
    );
  }, [refreshPending]);

  const isOnline = useOnlineStatus(sync);

  React.useEffect(() => {
    offlineDb.getManifest(eventId).then((value) => setManifest(value ?? null));
    void refreshPending();
  }, [eventId, refreshPending]);

  // ---------------------------------------------------------------------------
  async function prepareOffline() {
    setIsPreparing(true);
    const outcome = await downloadManifest(eventId);
    setIsPreparing(false);

    if (!outcome.ok) {
      toast.error(outcome.error.message);
      return;
    }

    const data = outcome.data as OfflineManifest;
    const stored: OfflineManifest = { ...data, eventId };
    await offlineDb.saveManifest(stored);
    setManifest(stored);

    toast.success(`Modo offline pronto — ${data.tickets.length} ingressos disponíveis.`);
  }

  /** Validação local quando não há rede: confere o hash contra o manifesto. */
  async function resolveOffline(token: string): Promise<CheckinResponse> {
    const code = token.split(".")[0] ?? "";

    if (!manifest) {
      return { result: "invalido", message: "Sem dados offline. Prepare o modo offline antes." };
    }

    const hash = await hashCode(code);
    const ticket = manifest.tickets.find((item) => item.h === hash);

    if (!ticket) return { result: "invalido", message: "Ingresso não encontrado neste evento." };
    if (ticket.s === "cancelado") {
      return {
        result: "cancelado",
        attendee: { name: ticket.n, cpf_masked: ticket.c, photo_url: null },
      };
    }

    const queue = await offlineDb.getQueue();
    const already = queue.some((item) => item.token.split(".")[0] === code);

    if (ticket.u || already) {
      return {
        result: "duplicado",
        attendee: { name: ticket.n, cpf_masked: ticket.c, photo_url: null },
        registration_number: ticket.r,
      };
    }

    const item: QueuedCheckin = {
      idempotency_key: crypto.randomUUID(),
      event_id: eventId,
      token,
      checked_in_at: new Date().toISOString(),
      device_id: getDeviceId(),
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracy_m: position?.accuracy ?? null,
      attendee_name: ticket.n,
      synced: false,
    };

    await offlineDb.enqueue(item);
    await refreshPending();

    return {
      result: "sucesso",
      attendee: { name: ticket.n, cpf_masked: ticket.c, photo_url: null },
      registration_number: ticket.r,
    };
  }

  function handleToken(token: string, override?: string) {
    setLastToken(token);

    startTransition(async () => {
      if (!isOnline) {
        setResult(await resolveOffline(token));
        return;
      }

      const outcome = await performCheckin(token, {
        deviceId: getDeviceId(),
        latitude: position?.latitude,
        longitude: position?.longitude,
        accuracyM: position?.accuracy,
        override: Boolean(override),
        overrideReason: override ?? null,
      });

      if (!outcome.ok) {
        toast.error(outcome.error.message);
        setResult({ result: "invalido", message: outcome.error.message });
        return;
      }

      setResult(outcome.data);
    });
  }

  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{eventName}</p>
          <p className="text-xs text-muted-foreground">
            {geoState.status === "granted"
              ? `Localização ativa · ±${Math.round(position?.accuracy ?? 0)} m`
              : geoState.status === "locating"
                ? "Obtendo localização..."
                : "Sem localização"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge variant={isOnline ? "success" : "warning"}>
            {isOnline ? <Wifi /> : <WifiOff />}
            {isOnline ? "Online" : "Offline"}
          </Badge>
          {pending.length > 0 && (
            <Badge variant="warning">
              <CloudOff /> {pending.length}
            </Badge>
          )}
        </div>
      </div>

      {geoState.status !== "granted" && geoState.status !== "locating" && (
        <Button variant="outline" size="sm" className="w-full" onClick={requestGeo}>
          <MapPin /> Ativar localização
        </Button>
      )}

      {result ? (
        <CheckinResult
          result={result}
          canOverride={canOverride}
          isPending={isPending}
          onDismiss={() => setResult(null)}
          onOverride={(reason) => lastToken && handleToken(lastToken, reason)}
        />
      ) : (
        <Tabs defaultValue="scanner">
          <TabsList className="w-full">
            <TabsTrigger value="scanner" className="flex-1">
              <ScanLine /> Scanner
            </TabsTrigger>
            <TabsTrigger value="busca" className="flex-1">
              <Search /> Busca
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner">
            <QrScanner onDetect={handleToken} paused={isPending || Boolean(result)} />
            {isPending && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Validando...
              </p>
            )}
          </TabsContent>

          <TabsContent value="busca">
            <ManualSearch eventId={eventId} onSelect={handleToken} isPending={isPending} />
          </TabsContent>
        </Tabs>
      )}

      {/* Painel de operação offline */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium">Modo offline</p>
              <p className="text-xs text-muted-foreground">
                {manifest
                  ? `${manifest.tickets.length} ingressos · atualizado ${formatRelative(manifest.generated_at)}`
                  : "Baixe os dados antes de perder o sinal."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={prepareOffline}
              loading={isPreparing}
              disabled={!isOnline}
            >
              <Download /> {manifest ? "Atualizar" : "Preparar"}
            </Button>
          </div>

          {pending.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-sm">
                <span className="font-medium">{pending.length}</span> check-ins aguardando envio
              </p>
              <Button size="sm" onClick={sync} loading={isSyncing} disabled={!isOnline}>
                <RefreshCw /> Sincronizar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Busca manual: CPF, nome, e-mail ou número da inscrição no mesmo campo. */
function ManualSearch({
  eventId,
  onSelect,
  isPending,
}: {
  eventId: string;
  onSelect: (token: string) => void;
  isPending: boolean;
}) {
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<AttendeeSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const debounced = useDebounce(term, 300);

  React.useEffect(() => {
    if (debounced.trim().length < 3) {
      setResults([]);
      return;
    }

    let active = true;
    setIsSearching(true);

    searchAttendees(eventId, debounced).then((outcome) => {
      if (!active) return;
      setIsSearching(false);
      if (outcome.ok) setResults(outcome.data);
    });

    return () => {
      active = false;
    };
  }, [debounced, eventId]);

  return (
    <div className="space-y-3">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="CPF, nome, e-mail ou nº da inscrição"
        startIcon={isSearching ? <Loader2 className="animate-spin" /> : <Search />}
        autoComplete="off"
        inputMode="search"
      />

      {term.trim().length >= 3 && results.length === 0 && !isSearching && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum participante encontrado.
        </p>
      )}

      <div className="space-y-2">
        {results.map((item) => (
          <button
            key={item.registration_id}
            type="button"
            disabled={isPending || !item.ticket_code}
            onClick={() => onSelect(`${item.ticket_code}.${item.ticket_signature}`)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.full_name}</p>
              <p className="tabular text-xs text-muted-foreground">
                {item.cpf} · {item.number}
              </p>
            </div>
            {item.checked_in ? (
              <Badge variant="warning">Já entrou</Badge>
            ) : item.status === "cancelada" ? (
              <Badge variant="destructive">Cancelada</Badge>
            ) : (
              <Badge variant="success">Válido</Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

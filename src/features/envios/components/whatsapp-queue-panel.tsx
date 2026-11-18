"use client";

import * as React from "react";

import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Ban,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Users,
} from "lucide-react";

import { maskPhone } from "@shared/whatsapp/mask";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelPending,
  getQueueSnapshot,
  pauseQueue,
  resumeQueue,
  retryFailed,
} from "@/features/envios/actions/queue.actions";
import { queueView, type QueueStats } from "@/features/envios/lib/queue-format";
import { toastActionFailure } from "@/lib/action-failure";
import { formatDateTime } from "@/lib/format";
import type { QueueRow } from "@/repositories/whatsapp-queue.repository";

const STATUS_LABEL: Record<string, string> = {
  pendente: "Na fila",
  processando: "Enviando",
  aceita: "Aceita pela Meta",
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
  falhou: "Falhou",
  cancelada: "Cancelada",
  incerta: "Incerta",
  bloqueada: "Bloqueada",
};

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "muted"> = {
  pendente: "muted",
  processando: "default",
  aceita: "default",
  enviada: "default",
  entregue: "success",
  lida: "success",
  falhou: "destructive",
  cancelada: "muted",
  incerta: "warning",
  bloqueada: "warning",
};

const BLOCK_LABEL: Record<string, string> = {
  sem_consentimento: "sem consentimento",
  optout: "pediu para não receber",
  telefone_invalido: "telefone inválido",
};

const PERIODS = [
  { value: "24h", label: "Últimas 24 horas", hours: 24 },
  { value: "7d", label: "Últimos 7 dias", hours: 24 * 7 },
  { value: "30d", label: "Últimos 30 dias", hours: 24 * 30 },
  { value: "all", label: "Todo o período", hours: null },
] as const;

const REFRESH_MS = 5_000;

interface Props {
  events: { id: string; name: string }[];
  canManage: boolean;
}

type Confirm = null | "pause" | "cancel" | "retry";

/**
 * Fila do WhatsApp (API oficial) — números ao vivo e controles.
 *
 * Atualiza a cada 5 s enquanto a aba está visível. Toda ação em massa abre
 * uma confirmação com a CONTAGEM do que vai mudar no recorte do filtro.
 */
export function WhatsappQueuePanel({ events, canManage }: Props) {
  const [eventId, setEventId] = React.useState<string>("all");
  const [period, setPeriod] = React.useState<string>("all");
  const [status, setStatus] = React.useState<string>("all");
  const [stats, setStats] = React.useState<QueueStats | null>(null);
  const [rows, setRows] = React.useState<QueueRow[]>([]);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [reason, setReason] = React.useState("");
  const [includeUncertain, setIncludeUncertain] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const filters = React.useMemo(() => {
    const hours = PERIODS.find((p) => p.value === period)?.hours ?? null;
    return {
      eventId: eventId === "all" ? null : eventId,
      from: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : null,
      to: null,
      status: status === "all" ? null : status,
    };
  }, [eventId, period, status]);

  const refresh = React.useCallback(async () => {
    try {
      const result = await getQueueSnapshot(filters);
      if (result.ok) {
        setStats(result.data.stats);
        setRows(result.data.rows);
      }
    } catch {
      // Falha de rede numa atualização automática: a próxima tenta de novo.
    }
  }, [filters]);

  React.useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const view = stats ? queueView(stats) : null;
  const count = (key: string) => stats?.por_status[key] ?? 0;
  const pendingCount = count("pendente");
  const failedCount = count("falhou");
  const uncertainCount = count("incerta");

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          toast.error(result.error?.message ?? "Não foi possível concluir.");
          return;
        }
        toast.success(done);
        setConfirm(null);
        setReason("");
        setIncludeUncertain(false);
        await refresh();
      } catch (error) {
        toastActionFailure(error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Evento</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os eventos</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Período</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Situação (lista)</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canManage && stats && (
          <div className="ml-auto flex flex-wrap gap-2">
            {stats.pausado ? (
              <Button
                variant="outline"
                onClick={() => run(resumeQueue, "Envios retomados.")}
                loading={isPending}
              >
                <Play /> Retomar envios
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirm("pause")}>
                <Pause /> Pausar envios
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setConfirm("retry")}
              disabled={failedCount + uncertainCount === 0}
            >
              <RotateCcw /> Reenviar falhas
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirm("cancel")}
              disabled={pendingCount === 0}
            >
              <Ban /> Cancelar pendentes
            </Button>
          </div>
        )}
      </div>

      {view?.alerts.map((alert) => (
        <Alert key={alert} variant="warning">
          <AlertTriangle className="size-4" />
          <AlertDescription>{alert}</AlertDescription>
        </Alert>
      ))}

      {!stats ? (
        <p className="text-sm text-muted-foreground">Carregando a fila…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={Users} label="Inscrições" value={stats.inscricoes} />
            <Metric
              icon={Clock}
              label="Na fila"
              value={stats.em_fila}
              hint={stats.agendadas > 0 ? `+ ${stats.agendadas} aguardando nova tentativa` : undefined}
            />
            <Metric icon={Activity} label="Velocidade" text={view!.speed} hint={`configurada: ${stats.vazao_configurada} msg/s`} />
            <Metric icon={Timer} label="Esvazia em" text={view!.drain} hint={`mais antiga: ${view!.oldest}`} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Enviando" value={count("processando")} small />
            <Metric label="Aceitas pela Meta" value={stats.marcos.aceitas} small />
            <Metric label="Enviadas" value={stats.marcos.enviadas} small />
            <Metric label="Entregues" value={stats.marcos.entregues} small hint={view!.deliveryPct} />
            <Metric label="Lidas" value={stats.marcos.lidas} small />
            <Metric label="Falhas" value={failedCount} small hint={view!.failurePct} />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Incertas" value={uncertainCount} small hint="podem ter saído; reenvio só manual" />
            <Metric label="Bloqueadas" value={count("bloqueada")} small hint="sem consentimento, opt-out ou número inválido" />
            <Metric label="Destinatários em 24 h" text={view!.daily} small hint={stats.nivel ? `nível: ${stats.nivel}` : undefined} />
            <Metric
              label="Workers ativos"
              value={stats.workers}
              small
              hint={stats.qualidade ? `qualidade: ${stats.qualidade}` : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimas mensagens</CardTitle>
              <CardDescription>
                As 50 mais recentes do filtro. “Aceita” é a Meta recebendo o pedido; entrega de
                verdade é “Entregue”.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Para</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Tentativas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Nada neste filtro.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDateTime(row.created_at)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-sm">
                          {row.kind === "ticket_code" ? "Segunda via" : (row.event_name ?? "—")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {maskPhone(row.phone_e164)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant={STATUS_VARIANT[row.status] ?? "muted"}>
                            {STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                          {(row.block_reason || row.last_error) && (
                            <p className="mt-1 max-w-80 truncate text-xs text-muted-foreground">
                              {row.block_reason ? BLOCK_LABEL[row.block_reason] : row.last_error}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">{row.attempts}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !isPending && !open && setConfirm(null)}>
        <DialogContent>
          {confirm === "pause" && (
            <>
              <DialogHeader>
                <DialogTitle>Pausar os envios de WhatsApp?</DialogTitle>
                <DialogDescription>
                  Nada sai até alguém retomar. As inscrições continuam entrando e as mensagens
                  ficam na fila, na ordem.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="pause-reason">Motivo (aparece no painel)</Label>
                <Input
                  id="pause-reason"
                  value={reason}
                  maxLength={200}
                  placeholder="Ex.: conferindo o modelo com a Meta"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
                  Voltar
                </Button>
                <Button onClick={() => run(() => pauseQueue(reason), "Envios pausados.")} loading={isPending}>
                  <Pause /> Pausar
                </Button>
              </DialogFooter>
            </>
          )}

          {confirm === "cancel" && (
            <>
              <DialogHeader>
                <DialogTitle>Cancelar {pendingCount.toLocaleString("pt-BR")} mensagens na fila?</DialogTitle>
                <DialogDescription>
                  Estas pessoas NÃO vão receber a confirmação pelo WhatsApp (o e-mail não é
                  afetado). Vale para o filtro atual{eventId !== "all" ? " (só o evento escolhido)" : " (todos os eventos)"}. Não dá para desfazer em lote.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
                  Manter na fila
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    run(async () => {
                      const r = await cancelPending(filters);
                      return r;
                    }, "Pendentes canceladas.")
                  }
                  loading={isPending}
                >
                  <Ban /> Cancelar {pendingCount.toLocaleString("pt-BR")}
                </Button>
              </DialogFooter>
            </>
          )}

          {confirm === "retry" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Reenviar {(failedCount + (includeUncertain ? uncertainCount : 0)).toLocaleString("pt-BR")} mensagens?
                </DialogTitle>
                <DialogDescription>
                  Voltam para a fila as falhas que ainda podem dar certo. Número inexistente, bloqueio
                  e quem pediu para sair ficam de fora.
                </DialogDescription>
              </DialogHeader>
              {uncertainCount > 0 && (
                <label className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  <Checkbox
                    checked={includeUncertain}
                    onCheckedChange={(c) => setIncludeUncertain(c === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Incluir as {uncertainCount.toLocaleString("pt-BR")} incertas. Elas podem já ter
                    chegado — quem recebeu pode receber de novo.
                  </span>
                </label>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
                  Voltar
                </Button>
                <Button
                  onClick={() => run(() => retryFailed(filters, includeUncertain), "Mensagens recolocadas na fila.")}
                  loading={isPending}
                >
                  <RotateCcw /> Reenviar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  text,
  hint,
  small = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  text?: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <Card>
      <CardContent className={small ? "space-y-1 p-4" : "space-y-1 p-5"}>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </p>
        <p className={small ? "text-xl font-semibold tabular-nums" : "text-2xl font-semibold tabular-nums"}>
          {text ?? (value ?? 0).toLocaleString("pt-BR")}
        </p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

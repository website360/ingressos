"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, MessageCircle, RefreshCw, Search } from "lucide-react";

import { formatBrPhone } from "@shared/validation/phone";

import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { EMAIL_STATUS } from "@/config/status-maps";
import { retryMessages } from "@/features/envios/actions/log.actions";
import { formatDateTime } from "@/lib/format";
import { describeBatch, type PacingConfig } from "@/lib/outbox/estimate";
import type { MessageLogRow } from "@/repositories/message.repository";

interface Props {
  rows: MessageLogRow[];
  pacing: PacingConfig;
  canRetry: boolean;
  /** Eventos presentes no log, para o filtro. */
  events: { id: string; name: string }[];
}

const TODOS = "__todos__";

/**
 * Log de envios com reenvio em massa.
 *
 * A filtragem acontece no cliente: o servidor entrega as últimas 200 linhas e
 * filtrar entre elas é instantâneo, sem ida ao servidor a cada tecla. Quando o
 * volume crescer a ponto de 200 não bastar, o filtro sobe para a consulta —
 * mas antecipar isso agora seria complexidade sem sintoma.
 */
export function MessageLog({ rows, pacing, canRetry, events }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const [channel, setChannel] = React.useState<string>(TODOS);
  const [status, setStatus] = React.useState<string>(TODOS);
  const [eventId, setEventId] = React.useState<string>(TODOS);
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (channel !== TODOS && r.channel !== channel) return false;
      if (status !== TODOS && r.status !== status) return false;
      if (eventId !== TODOS && r.event_id !== eventId) return false;
      if (term && !(r.recipient ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, channel, status, eventId, search]);

  /**
   * Só o que já terminou em falha pode ser reenviado. Linha ainda na fila tem
   * a vez dela garantida pelo slot — recolocá-la só bagunçaria a ordem.
   */
  const retriable = React.useMemo(
    () => filtered.filter((r) => r.job_id && (r.status === "falhou" || r.status === "bounce")),
    [filtered],
  );

  const retriableIds = React.useMemo(() => new Set(retriable.map((r) => r.job_id!)), [retriable]);

  // Seleção sempre restrita ao que está visível e é reenviável: filtrar não
  // pode deixar para trás uma linha marcada que ninguém mais vê.
  const effective = React.useMemo(
    () => [...selected].filter((id) => retriableIds.has(id)),
    [selected, retriableIds],
  );

  const allChecked = retriable.length > 0 && effective.length === retriable.length;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(retriable.map((r) => r.job_id!)));
  }

  function toggle(jobId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function doRetry() {
    startTransition(async () => {
      const result = await retryMessages(effective);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        result.data.requeued === 1
          ? "1 mensagem recolocada na fila."
          : `${result.data.requeued} mensagens recolocadas na fila.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  const falhas = rows.filter((r) => r.status === "falhou" || r.status === "bounce").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Mensagens enviadas</CardTitle>
              <CardDescription>
                {rows.length} registros · {falhas} com falha. O ritmo do WhatsApp é de uma mensagem
                a cada {pacing.intervalSeconds}s, no máximo {pacing.dailyLimit} por dia (
                {pacing.sentToday} já saíram hoje).
              </CardDescription>
            </div>

            {canRetry && (
              <Button onClick={doRetry} disabled={isPending || effective.length === 0}>
                {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {describeBatch(effective.length, pacing)}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar destinatário…"
                className="pl-8"
              />
            </div>

            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os canais</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Situação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas as situações</SelectItem>
                {Object.entries(EMAIL_STATUS).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {events.length > 0 && (
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Evento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os eventos</SelectItem>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "Nenhuma mensagem ainda. Elas aparecem aqui assim que a fila rodar."
                : "Nenhuma mensagem corresponde aos filtros."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    {canRetry && retriable.length > 0 && (
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todas as falhas visíveis"
                      />
                    )}
                  </TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filtered.map((row) => {
                  const canPick = canRetry && row.job_id && retriableIds.has(row.job_id);
                  return (
                    <TableRow key={`${row.channel}-${row.id}`}>
                      <TableCell>
                        {canPick && (
                          <Checkbox
                            checked={selected.has(row.job_id!)}
                            onCheckedChange={() => toggle(row.job_id!)}
                            aria-label={`Selecionar mensagem para ${row.recipient}`}
                          />
                        )}
                      </TableCell>

                      <TableCell className="text-sm">
                        {row.channel === "whatsapp" && row.recipient
                          ? formatBrPhone(row.recipient.replace(/^55/, ""))
                          : row.recipient}
                        {row.last_error && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-destructive">
                            {row.last_error}
                          </p>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant="muted" className="gap-1">
                          {row.channel === "whatsapp" ? (
                            <MessageCircle className="size-3" />
                          ) : (
                            <Mail className="size-3" />
                          )}
                          {row.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
                        </Badge>
                      </TableCell>

                      <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                        {row.event_name ?? "—"}
                      </TableCell>

                      <TableCell>
                        <StatusBadge map={EMAIL_STATUS} value={row.status} />
                        {row.attempts != null && row.attempts > 1 && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {row.attempts}ª tentativa
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {row.sent_at
                          ? formatDateTime(row.sent_at)
                          : row.scheduled_at
                            ? `agendada ${formatDateTime(row.scheduled_at)}`
                            : row.created_at
                              ? formatDateTime(row.created_at)
                              : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

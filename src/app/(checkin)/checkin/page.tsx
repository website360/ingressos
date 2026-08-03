import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX, ChevronRight, MapPin, Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Check-in" };

export default async function CheckinEventsPage() {
  await requirePermission(PERMISSIONS.CHECKIN_EXECUTE);

  const { events } = await getRepositories();
  const { items } = await events.list({ status: "publicado", limit: 50 });

  // Prioriza o que acontece hoje: é o que a portaria vai operar agora.
  const now = Date.now();
  const sorted = [...items].sort(
    (a, b) =>
      Math.abs(new Date(a.starts_at!).getTime() - now) -
      Math.abs(new Date(b.starts_at!).getTime() - now),
  );

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Selecione o evento</h1>
        <p className="text-sm text-muted-foreground">
          Prepare o modo offline antes de começar, se o local tiver sinal fraco.
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="Nenhum evento publicado"
          description="Só eventos publicados aparecem aqui para operação de portaria."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((event) => {
            const startsAt = new Date(event.starts_at!);
            const isToday = startsAt.toDateString() === new Date().toDateString();

            return (
              <Link key={event.event_id} href={ROUTES.checkin.event(event.event_id!)}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{event.name}</p>
                        {isToday && <Badge variant="success">Hoje</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(event.starts_at)}
                      </p>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="size-3" />
                          {formatNumber(event.seats_taken ?? 0)} inscritos ·{" "}
                          {formatNumber(event.checked_in_count ?? 0)} presentes
                        </span>
                        {event.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" />
                            {event.city}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

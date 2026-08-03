import { Suspense } from "react";
import type { Metadata } from "next";

import { AttendeesTable } from "@/features/registrations/components/attendees-table";
import { ExportButton } from "@/components/shared/export-button";
import { ListFilters } from "@/components/shared/list-filters";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { REGISTRATION_STATUS } from "@/config/status-maps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { getRepositories } from "@/repositories";
import type { RegistrationStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Participantes" };

interface PageProps {
  searchParams: Promise<{
    q?: string;
    event?: string;
    status?: string;
    presente?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function AttendeesPage({ searchParams }: PageProps) {
  const session = await requirePermission(PERMISSIONS.REGISTRATION_READ);
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? 1), 1);

  const { registrations, events } = await getRepositories();

  const [eventOptions, result] = await Promise.all([
    events.listOptions(),
    registrations.list({
      q: params.q,
      eventId: params.event,
      status: params.status as RegistrationStatus | undefined,
      checkedIn: params.presente as "sim" | "nao" | undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  // CPF completo só para quem tem a permissão específica (LGPD, RF-12.4).
  const canSeeSensitive = session.permissions.includes(PERMISSIONS.ATTENDEE_READ_SENSITIVE);

  return (
    <>
      <PageHeader
        title="Participantes"
        description={`${formatNumber(result.total)} ${result.total === 1 ? "inscrição encontrada" : "inscrições encontradas"}`}
        actions={
          session.permissions.includes(PERMISSIONS.REGISTRATION_EXPORT) && (
            <Suspense fallback={null}>
              <ExportButton href="/api/exports/participantes" />
            </Suspense>
          )
        }
      />

      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full max-w-xs" />}>
        <ListFilters
          searchPlaceholder="Nome, e-mail, CPF ou número da inscrição..."
          selects={[
            {
              key: "event",
              placeholder: "Todos os eventos",
              options: eventOptions.map((event) => ({ value: event.id, label: event.name })),
            },
            {
              key: "status",
              placeholder: "Todos os status",
              options: Object.entries(REGISTRATION_STATUS).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
            },
            {
              key: "presente",
              placeholder: "Presença",
              options: [
                { value: "sim", label: "Compareceu" },
                { value: "nao", label: "Não compareceu" },
              ],
            },
          ]}
        />
      </Suspense>

      <AttendeesTable registrations={result.items} showSensitive={canSeeSensitive} />

      <p className="mt-4 text-sm text-muted-foreground">
        Exibindo {formatNumber(result.items.length)} de {formatNumber(result.total)}
        {result.total > PAGE_SIZE && ` · página ${page}`}
      </p>
    </>
  );
}

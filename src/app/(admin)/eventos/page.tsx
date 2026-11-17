import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { EventsTable } from "@/features/events/components/events-table";
import { NewEventButton } from "@/features/events/components/new-event-button";
import { ListFilters } from "@/components/shared/list-filters";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/constants/routes";
import { EVENT_STATUS } from "@/config/status-maps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";
import type { EventStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Eventos" };

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

const PAGE_SIZE = 25;

export default async function EventsPage({ searchParams }: PageProps) {
  const session = await requirePermission(PERMISSIONS.EVENT_READ);
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? 1), 1);

  const { events } = await getRepositories();
  const { items, total } = await events.list({
    q: params.q,
    status: params.status as EventStatus | undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // O assistente grava cada etapa com event.update — só criar não basta.
  const canCreate =
    session.permissions.includes(PERMISSIONS.EVENT_CREATE) &&
    session.permissions.includes(PERMISSIONS.EVENT_UPDATE);
  const templates = canCreate ? await events.listFaqTemplates().catch(() => []) : [];

  return (
    <>
      <PageHeader
        title="Eventos"
        description={`${total} ${total === 1 ? "evento cadastrado" : "eventos cadastrados"}`}
        actions={
          canCreate && (
            <Suspense fallback={null}>
              <NewEventButton
                templates={templates.map(({ id, question, answer }) => ({ id, question, answer }))}
                canPublish={session.permissions.includes(PERMISSIONS.EVENT_PUBLISH)}
                canManageSettings={session.permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
              />
            </Suspense>
          )
        }
      />

      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full max-w-xs" />}>
        <ListFilters
          searchPlaceholder="Buscar por nome do evento..."
          selects={[
            {
              key: "status",
              placeholder: "Todos os status",
              options: Object.entries(EVENT_STATUS).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
            },
          ]}
        />
      </Suspense>

      <EventsTable events={items} />

      {total > PAGE_SIZE && (
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} params={params} />
      )}
    </>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  params,
}: {
  page: number;
  total: number;
  pageSize: number;
  params: Record<string, string | undefined>;
}) {
  const lastPage = Math.ceil(total / pageSize);
  const buildHref = (target: number) => {
    const search = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value) as [string, string][],
    );
    search.set("page", String(target));
    return `${ROUTES.admin.events}?${search.toString()}`;
  };

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página {page} de {lastPage}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild disabled={page <= 1}>
          <Link href={buildHref(Math.max(page - 1, 1))}>Anterior</Link>
        </Button>
        <Button variant="outline" size="sm" asChild disabled={page >= lastPage}>
          <Link href={buildHref(Math.min(page + 1, lastPage))}>Próxima</Link>
        </Button>
      </div>
    </div>
  );
}

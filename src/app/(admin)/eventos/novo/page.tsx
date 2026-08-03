import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventForm } from "@/features/events/components/event-form";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Novo evento" };

export default async function NewEventPage() {
  await requirePermission(PERMISSIONS.EVENT_CREATE);

  return (
    <>
      <PageHeader
        title="Novo evento"
        description="Salve como rascunho a qualquer momento. Publicar exige capacidade, data futura, cidade e descrição curta."
      />
      <EventForm />
    </>
  );
}

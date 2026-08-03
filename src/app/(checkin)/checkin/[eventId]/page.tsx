import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckinStation } from "@/features/checkin/components/checkin-station";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRepositories } from "@/repositories";

export const metadata: Metadata = { title: "Check-in" };

export default async function CheckinStationPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const session = await requirePermission(PERMISSIONS.CHECKIN_EXECUTE);
  const { eventId } = await params;

  const { events } = await getRepositories();
  const event = await events.findById(eventId).catch(() => null);

  if (!event) notFound();

  return (
    <CheckinStation
      eventId={event.id}
      eventName={event.name}
      canOverride={session.permissions.includes(PERMISSIONS.CHECKIN_OVERRIDE)}
    />
  );
}

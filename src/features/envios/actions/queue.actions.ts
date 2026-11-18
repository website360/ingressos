"use server";

import { revalidatePath } from "next/cache";

import { whatsappCapacitySchema, type WhatsappCapacityInput } from "@shared/schemas/whatsapp";

import { ROUTES } from "@/constants/routes";
import type { QueueStats } from "@/features/envios/lib/queue-format";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fail, ok, type Result } from "@/lib/errors";
import { getRepositories } from "@/repositories";
import type { QueueFilters, QueueRow } from "@/repositories/whatsapp-queue.repository";

/**
 * Painel da fila do WhatsApp (Meta).
 *
 * Toda ação passa pelo client do usuário: a checagem aqui é a primeira
 * barreira, a RPC confere de novo no banco. Nenhuma ação dispara mensagem
 * para quem não está na fila — reenviar só recoloca o que já existe e é
 * elegível; não há "disparo livre".
 */

function clean(filters: QueueFilters): QueueFilters {
  const iso = (value?: string | null) =>
    value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    eventId: filters.eventId && uuid.test(filters.eventId) ? filters.eventId : null,
    from: iso(filters.from),
    to: iso(filters.to),
    status: filters.status ?? null,
  };
}

export async function getQueueSnapshot(
  filters: QueueFilters,
): Promise<Result<{ stats: QueueStats; rows: QueueRow[] }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_READ);
    const { whatsappQueue } = await getRepositories();
    const f = clean(filters);
    const [stats, rows] = await Promise.all([whatsappQueue.stats(f), whatsappQueue.list(f)]);
    return ok({ stats, rows });
  } catch (error) {
    return fail(error);
  }
}

export async function pauseQueue(reason: string): Promise<Result<{ paused: true }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { whatsappQueue } = await getRepositories();
    await whatsappQueue.setPaused(true, reason.trim().slice(0, 200) || null);
    revalidatePath(ROUTES.admin.messages);
    return ok({ paused: true });
  } catch (error) {
    return fail(error);
  }
}

export async function resumeQueue(): Promise<Result<{ paused: false }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { whatsappQueue } = await getRepositories();
    await whatsappQueue.setPaused(false, null);
    revalidatePath(ROUTES.admin.messages);
    return ok({ paused: false });
  } catch (error) {
    return fail(error);
  }
}

export async function cancelPending(filters: QueueFilters): Promise<Result<{ cancelled: number }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { whatsappQueue } = await getRepositories();
    const cancelled = await whatsappQueue.cancelPending(clean(filters));
    revalidatePath(ROUTES.admin.messages);
    return ok({ cancelled });
  } catch (error) {
    return fail(error);
  }
}

export async function retryFailed(
  filters: QueueFilters,
  includeUncertain: boolean,
): Promise<Result<{ requeued: number }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { whatsappQueue } = await getRepositories();
    const requeued = await whatsappQueue.retry(clean(filters), includeUncertain === true);
    revalidatePath(ROUTES.admin.messages);
    return ok({ requeued });
  } catch (error) {
    return fail(error);
  }
}

export async function saveWhatsappCapacity(
  input: WhatsappCapacityInput,
): Promise<Result<{ saved: true }>> {
  try {
    await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const data = whatsappCapacitySchema.parse(input);
    const { whatsappQueue } = await getRepositories();
    await whatsappQueue.updateCapacity(
      data.rate_per_second,
      data.daily_unique_limit,
      data.worker_concurrency,
    );
    revalidatePath(ROUTES.admin.messages);
    revalidatePath(ROUTES.admin.settings.root);
    return ok({ saved: true });
  } catch (error) {
    return fail(error);
  }
}

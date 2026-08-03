"use server";

import { getRequestContext } from "@/lib/auth/request-context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fail, ok, type Result } from "@/lib/errors";
import { getRepositories } from "@/repositories";

export interface CheckinContext {
  deviceId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  override?: boolean;
  overrideReason?: string | null;
  source?: string;
  idempotencyKey?: string;
  checkedInAt?: string;
}

export interface CheckinResponse {
  result: "sucesso" | "duplicado" | "invalido" | "cancelado" | "fora_do_raio";
  message?: string;
  ticket_code?: string;
  registration_number?: string;
  event?: { id: string; name: string };
  attendee?: { name: string; cpf_masked: string; photo_url: string | null };
  within_geofence?: boolean | null;
  distance_m?: number | null;
  first_checkin?: { at: string; operator: string | null } | null;
}

/**
 * Check-in online.
 *
 * A validação real — assinatura, status, duplicidade, geofence e permissão —
 * está toda na RPC, numa transação. Aqui só propagamos o contexto do
 * dispositivo, que o banco não tem como conhecer (ADR-013).
 */
export async function performCheckin(
  token: string,
  context: CheckinContext,
): Promise<Result<CheckinResponse>> {
  try {
    await requirePermission(PERMISSIONS.CHECKIN_EXECUTE);

    const request = await getRequestContext();
    const { checkins } = await getRepositories();

    const data = await checkins.execute(token, {
      device_id: context.deviceId,
      ip: request.ip,
      user_agent: request.userAgent,
      latitude: context.latitude ?? null,
      longitude: context.longitude ?? null,
      accuracy_m: context.accuracyM ?? null,
      override: context.override ?? false,
      override_reason: context.overrideReason ?? null,
      source: context.source ?? "scanner",
      idempotency_key: context.idempotencyKey ?? null,
      checked_in_at: context.checkedInAt ?? null,
    });

    return ok(data as unknown as CheckinResponse);
  } catch (error) {
    return fail(error);
  }
}

export interface AttendeeSearchResult {
  registration_id: string;
  number: string;
  status: string;
  full_name: string;
  cpf: string;
  email: string;
  photo_url: string | null;
  ticket_code: string | null;
  ticket_signature: string | null;
  ticket_status: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
}

/** Busca da portaria: CPF, nome, e-mail ou número da inscrição. */
export async function searchAttendees(
  eventId: string,
  term: string,
): Promise<Result<AttendeeSearchResult[]>> {
  try {
    await requirePermission(PERMISSIONS.REGISTRATION_READ);
    const { checkins } = await getRepositories();
    const data = await checkins.search(eventId, term);

    return ok((data ?? []) as unknown as AttendeeSearchResult[]);
  } catch (error) {
    return fail(error);
  }
}

/** Pacote de dados para operar sem internet. */
export async function downloadManifest(eventId: string): Promise<Result<unknown>> {
  try {
    await requirePermission(PERMISSIONS.CHECKIN_EXECUTE);
    const { checkins } = await getRepositories();
    const data = await checkins.manifest(eventId);

    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export interface SyncItem {
  idempotency_key: string;
  token: string;
  checked_in_at: string;
  device_id: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_m?: number | null;
  override?: boolean;
  override_reason?: string | null;
}

export interface SyncOutcome {
  idempotency_key: string;
  result: string;
  attendee?: { name: string } | null;
}

/** Sincroniza a fila offline. Idempotente: reenviar o lote não duplica nada. */
export async function syncOfflineCheckins(items: SyncItem[]): Promise<Result<SyncOutcome[]>> {
  try {
    await requirePermission(PERMISSIONS.CHECKIN_EXECUTE);
    if (items.length === 0) return ok([]);

    const request = await getRequestContext();
    const { checkins } = await getRepositories();

    const data = await checkins.syncBatch(
      items.map((item) => ({ ...item, ip: request.ip, user_agent: request.userAgent })),
    );

    return ok((data ?? []) as unknown as SyncOutcome[]);
  } catch (error) {
    return fail(error);
  }
}

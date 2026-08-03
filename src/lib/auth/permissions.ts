import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Espelho, em TypeScript, do catálogo de `public.permissions`.
 * A fonte da verdade continua sendo o banco — isto existe para tipar a UI e
 * evitar strings soltas nos componentes.
 */
export const PERMISSIONS = {
  EVENT_READ: "event.read",
  EVENT_CREATE: "event.create",
  EVENT_UPDATE: "event.update",
  EVENT_DELETE: "event.delete",
  EVENT_PUBLISH: "event.publish",

  REGISTRATION_READ: "registration.read",
  REGISTRATION_CREATE: "registration.create",
  REGISTRATION_UPDATE: "registration.update",
  REGISTRATION_CANCEL: "registration.cancel",
  REGISTRATION_IMPORT: "registration.import",
  REGISTRATION_EXPORT: "registration.export",
  ATTENDEE_READ_SENSITIVE: "attendee.read_sensitive",

  CHECKIN_EXECUTE: "checkin.execute",
  CHECKIN_READ: "checkin.read",
  CHECKIN_OVERRIDE: "checkin.override",

  REPORT_READ: "report.read",
  REPORT_EXPORT: "report.export",
  DASHBOARD_READ: "dashboard.read",

  SUPPORT_READ: "support.read",
  SUPPORT_WRITE: "support.write",
  SUPPORT_MANAGE: "support.manage",

  USER_READ: "user.read",
  USER_MANAGE: "user.manage",
  PERMISSION_MANAGE: "permission.manage",

  SETTINGS_READ: "settings.read",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_READ: "audit.read",
  API_MANAGE: "api.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  organizador: "Organizador",
  recepcao: "Recepção",
  suporte: "Suporte",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "Acesso total à empresa, incluindo usuários, permissões e configurações.",
  organizador: "Cria e gerencia eventos, participantes e relatórios dos eventos atribuídos.",
  recepcao: "Executa check-in no dia do evento. Não edita eventos nem exporta dados.",
  suporte: "Atende chamados e consulta participantes. Não exclui registros.",
};

/** Verificação pontual. */
export function can(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes(permission);
}

/** Verdadeiro se possuir ao menos uma das permissões. */
export function canAny(permissions: readonly string[], required: readonly Permission[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}

/** Verdadeiro apenas se possuir todas. */
export function canAll(permissions: readonly string[], required: readonly Permission[]): boolean {
  return required.every((permission) => permissions.includes(permission));
}

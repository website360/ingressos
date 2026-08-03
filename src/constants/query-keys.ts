/**
 * Chaves do React Query centralizadas.
 *
 * Toda chave começa pelo `tenantId` — assim, trocar de empresa invalida o cache
 * inteiro por construção, e dado de uma empresa nunca aparece sob outra
 * (docs/05, seção 2).
 */
export const qk = {
  session: ["session"] as const,

  tenants: {
    all: (tenantId: string) => [tenantId, "tenants"] as const,
    detail: (tenantId: string) => [tenantId, "tenants", "detail"] as const,
    settings: (tenantId: string) => [tenantId, "tenants", "settings"] as const,
  },

  users: {
    all: (tenantId: string) => [tenantId, "users"] as const,
    list: (tenantId: string, filters?: unknown) => [tenantId, "users", "list", filters] as const,
    detail: (tenantId: string, userId: string) => [tenantId, "users", userId] as const,
    invitations: (tenantId: string) => [tenantId, "users", "invitations"] as const,
  },

  permissions: {
    catalog: ["permissions", "catalog"] as const,
    byRole: (tenantId: string) => [tenantId, "permissions", "by-role"] as const,
  },

  events: {
    all: (tenantId: string) => [tenantId, "events"] as const,
    list: (tenantId: string, filters?: unknown) => [tenantId, "events", "list", filters] as const,
    detail: (tenantId: string, eventId: string) => [tenantId, "events", eventId] as const,
    stats: (tenantId: string, eventId: string) => [tenantId, "events", eventId, "stats"] as const,
    availability: (eventId: string) => ["public", "events", eventId, "availability"] as const,
  },

  registrations: {
    all: (tenantId: string) => [tenantId, "registrations"] as const,
    list: (tenantId: string, filters?: unknown) =>
      [tenantId, "registrations", "list", filters] as const,
  },

  checkins: {
    all: (tenantId: string) => [tenantId, "checkins"] as const,
    list: (tenantId: string, filters?: unknown) => [tenantId, "checkins", "list", filters] as const,
  },

  dashboard: {
    kpis: (tenantId: string, filters?: unknown) =>
      [tenantId, "dashboard", "kpis", filters] as const,
  },

  audit: {
    list: (tenantId: string, filters?: unknown) => [tenantId, "audit", "list", filters] as const,
  },

  notifications: {
    list: (tenantId: string) => [tenantId, "notifications"] as const,
    unreadCount: (tenantId: string) => [tenantId, "notifications", "unread"] as const,
  },
} as const;

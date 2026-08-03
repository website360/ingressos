/**
 * ARQUIVO GERADO — não editar à mão.
 *   npm run db:types
 *
 * Gerado por introspecção do schema real (scripts/gen-types.mjs).
 * Linhas são `type`, não `interface`: o supabase-js exige que cada tabela
 * satisfaça Record<string, unknown>, e só type aliases ganham index
 * signature implícita.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "cancel"
  | "checkin"
  | "login"
  | "logout"
  | "permission_change"
  | "export"
  | "access_sensitive";
export type CheckinResult = "sucesso" | "duplicado" | "invalido" | "cancelado" | "fora_do_raio";
export type EmailStatus = "fila" | "enviado" | "entregue" | "aberto" | "falhou" | "bounce";
export type EventStatus = "rascunho" | "publicado" | "privado" | "encerrado" | "cancelado";
export type JobStatus = "pendente" | "processando" | "concluido" | "falhou" | "descartado";
export type MembershipStatus = "convidado" | "ativo" | "suspenso";
export type RegistrationStatus =
  "pendente" | "confirmada" | "cancelada" | "lista_espera" | "no_show";
export type SupportPriority = "baixa" | "media" | "alta" | "critica";
export type SupportStatus = "aberto" | "em_andamento" | "aguardando" | "resolvido" | "fechado";
export type TenantStatus = "trial" | "ativo" | "suspenso" | "cancelado";
export type TicketStatus = "valido" | "utilizado" | "cancelado" | "expirado" | "reemitido";
export type UserRole = "admin" | "organizador" | "recepcao" | "suporte";

type AttendeesRow = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  cpf: string;
  email: string;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  country: string;
  company: string | null;
  job_title: string | null;
  photo_url: string | null;
  metadata: Json;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
};

type CancellationsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  registration_id: string;
  ticket_id: string | null;
  reason_code: string | null;
  reason_text: string | null;
  cancelled_by_type: string;
  cancelled_by_user: string | null;
  ip: string | null;
  user_agent: string | null;
  seat_released: boolean;
  created_at: string;
};

type CategoriesRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

type CheckinsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  ticket_id: string | null;
  registration_id: string | null;
  result: CheckinResult;
  checked_in_at: string;
  synced_at: string;
  operator_id: string | null;
  device_id: string | null;
  device_info: string | null;
  user_agent: string | null;
  ip: string | null;
  location: unknown | null;
  accuracy_m: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  within_geofence: boolean | null;
  distance_m: number | null;
  override_confirmed: boolean;
  override_reason: string | null;
  offline_captured: boolean;
  idempotency_key: string | null;
  source: string;
  created_at: string;
};

type ConsentsRow = {
  id: string;
  tenant_id: string;
  registration_id: string;
  document_type: string;
  document_version: number;
  accepted: boolean;
  accepted_at: string;
  ip: string | null;
  user_agent: string | null;
};

type EmailMessagesRow = {
  id: string;
  tenant_id: string;
  template: string;
  to_email: string;
  subject: string;
  payload: Json;
  status: EmailStatus;
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
};

type EventDocumentsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  document_type: string;
  version: number;
  content: string;
  published_at: string;
  created_at: string;
};

type EventFaqsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  question: string;
  answer: string;
  position: number;
  created_at: string;
};

type EventMediaRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  type: string;
  url: string;
  caption: string | null;
  position: number;
  created_at: string;
};

type EventScheduleItemsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  day: string | null;
  starts_at: string | null;
  ends_at: string | null;
  title: string;
  description: string | null;
  speaker: string | null;
  position: number;
  created_at: string;
};

type EventSlugHistoryRow = {
  tenant_id: string;
  old_slug: string;
  event_id: string;
  created_at: string;
};

type EventSpeakersRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  name: string;
  role: string | null;
  company: string | null;
  bio: string | null;
  photo_url: string | null;
  links: Json;
  position: number;
  created_at: string;
};

type EventTagsRow = {
  tenant_id: string;
  event_id: string;
  tag_id: string;
};

type EventsRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  cover_url: string | null;
  banner_url: string | null;
  video_url: string | null;
  category_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  venue_name: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string;
  location: unknown | null;
  allowed_radius_m: number;
  google_maps_url: string | null;
  capacity: number;
  overbooking_pct: number;
  seats_taken: number;
  checked_in_count: number;
  cancelled_count: number;
  registrations_open: boolean;
  registration_deadline: string | null;
  organizer_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: EventStatus;
  published_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  settings: Json;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type MembershipsRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  status: MembershipStatus;
  is_owner: boolean;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type NotificationsRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type OutboxJobsRow = {
  id: string;
  tenant_id: string | null;
  type: string;
  payload: Json;
  status: JobStatus;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: string;
};

type PermissionsRow = {
  code: string;
  module: string;
  description: string;
  created_at: string;
};

type ProfilesRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  locale: string;
  active_tenant_id: string | null;
  is_platform_admin: boolean;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type RegistrationsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  attendee_id: string;
  number: string;
  status: RegistrationStatus;
  source: string;
  referral: string | null;
  custom_fields: Json;
  confirmed_at: string | null;
  cancelled_at: string | null;
  ip: string | null;
  user_agent: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

type RolePermissionsRow = {
  tenant_id: string;
  role: UserRole;
  permission_code: string;
  created_at: string;
};

type SupportMessagesRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
};

type SupportTicketsRow = {
  id: string;
  tenant_id: string;
  number: string;
  subject: string;
  description: string;
  category: string;
  priority: SupportPriority;
  status: SupportStatus;
  requester_id: string | null;
  assignee_id: string | null;
  event_id: string | null;
  sla_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TagsRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  created_at: string;
};

type TenantInvitationsRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: UserRole;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: string | null;
  created_at: string;
};

type TenantSettingsRow = {
  tenant_id: string;
  key: string;
  value: Json;
  updated_at: string;
  updated_by: string | null;
};

type TenantsRow = {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  logo_url: string | null;
  brand_color: string | null;
  plan: string;
  status: TenantStatus;
  timezone: string;
  settings: Json;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
};

type TicketsRow = {
  id: string;
  tenant_id: string;
  event_id: string;
  registration_id: string;
  code: string;
  signature: string;
  status: TicketStatus;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  pdf_path: string | null;
  reissued_from: string | null;
  created_at: string;
};

type UserEventScopesRow = {
  tenant_id: string;
  user_id: string;
  event_id: string;
  created_at: string;
  created_by: string | null;
};

type UserPermissionOverridesRow = {
  tenant_id: string;
  user_id: string;
  permission_code: string;
  granted: boolean;
  reason: string | null;
  created_at: string;
  created_by: string | null;
};

type VAuditLogsRow = {
  id: string | null;
  tenant_id: string | null;
  action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  changes: Json | null;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  request_id: string | null;
  created_at: string | null;
};

type VCheckinAlertsRow = {
  id: string | null;
  tenant_id: string | null;
  event_id: string | null;
  event_name: string | null;
  result: CheckinResult | null;
  checked_in_at: string | null;
  within_geofence: boolean | null;
  distance_m: number | null;
  override_confirmed: boolean | null;
  device_id: string | null;
  operator_name: string | null;
  attendee_name: string | null;
};

type VEventStatsRow = {
  event_id: string | null;
  tenant_id: string | null;
  name: string | null;
  slug: string | null;
  status: EventStatus | null;
  starts_at: string | null;
  ends_at: string | null;
  city: string | null;
  state: string | null;
  cover_url: string | null;
  banner_url: string | null;
  capacity: number | null;
  seats_taken: number | null;
  checked_in_count: number | null;
  cancelled_count: number | null;
  seats_available: number | null;
  occupancy_pct: number | null;
  attendance_pct: number | null;
};

type VRegistrationFullRow = {
  registration_id: string | null;
  tenant_id: string | null;
  event_id: string | null;
  number: string | null;
  status: RegistrationStatus | null;
  source: string | null;
  referral: string | null;
  created_at: string | null;
  cancelled_at: string | null;
  attendee_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  company: string | null;
  job_title: string | null;
  birth_date: string | null;
  event_name: string | null;
  event_starts_at: string | null;
  ticket_code: string | null;
  ticket_status: TicketStatus | null;
  checked_in_at: string | null;
  checked_in: boolean | null;
  checkin_within_geofence: boolean | null;
  checkin_distance_m: number | null;
  checkin_forced: boolean | null;
  checkin_force_reason: string | null;
  checkin_source: string | null;
  checkin_offline: boolean | null;
  checkin_operator: string | null;
  cancel_reason_code: string | null;
  cancel_reason_text: string | null;
  cancel_by_type: string | null;
  cancel_ip: string | null;
  cancel_by_name: string | null;
};

type Insertable<T, Optional extends keyof T> = Omit<T, Optional> & Partial<Pick<T, Optional>>;

export type Database = {
  public: {
    Tables: {
      attendees: {
        Row: AttendeesRow;
        Insert: Insertable<
          AttendeesRow,
          | "id"
          | "last_name"
          | "phone"
          | "birth_date"
          | "gender"
          | "city"
          | "state"
          | "country"
          | "company"
          | "job_title"
          | "photo_url"
          | "metadata"
          | "anonymized_at"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<AttendeesRow>;
        Relationships: [];
      };
      cancellations: {
        Row: CancellationsRow;
        Insert: Insertable<
          CancellationsRow,
          | "id"
          | "ticket_id"
          | "reason_code"
          | "reason_text"
          | "cancelled_by_type"
          | "cancelled_by_user"
          | "ip"
          | "user_agent"
          | "seat_released"
          | "created_at"
        >;
        Update: Partial<CancellationsRow>;
        Relationships: [];
      };
      categories: {
        Row: CategoriesRow;
        Insert: Insertable<
          CategoriesRow,
          "id" | "color" | "icon" | "position" | "created_at" | "updated_at"
        >;
        Update: Partial<CategoriesRow>;
        Relationships: [];
      };
      checkins: {
        Row: CheckinsRow;
        Insert: Insertable<
          CheckinsRow,
          | "id"
          | "ticket_id"
          | "registration_id"
          | "checked_in_at"
          | "synced_at"
          | "operator_id"
          | "device_id"
          | "device_info"
          | "user_agent"
          | "ip"
          | "location"
          | "accuracy_m"
          | "city"
          | "state"
          | "country"
          | "within_geofence"
          | "distance_m"
          | "override_confirmed"
          | "override_reason"
          | "offline_captured"
          | "idempotency_key"
          | "source"
          | "created_at"
        >;
        Update: Partial<CheckinsRow>;
        Relationships: [];
      };
      consents: {
        Row: ConsentsRow;
        Insert: Insertable<
          ConsentsRow,
          "id" | "document_version" | "accepted_at" | "ip" | "user_agent"
        >;
        Update: Partial<ConsentsRow>;
        Relationships: [];
      };
      email_messages: {
        Row: EmailMessagesRow;
        Insert: Insertable<
          EmailMessagesRow,
          | "id"
          | "payload"
          | "status"
          | "provider_message_id"
          | "attempts"
          | "last_error"
          | "sent_at"
          | "opened_at"
          | "entity_type"
          | "entity_id"
          | "created_at"
        >;
        Update: Partial<EmailMessagesRow>;
        Relationships: [];
      };
      event_documents: {
        Row: EventDocumentsRow;
        Insert: Insertable<EventDocumentsRow, "id" | "version" | "published_at" | "created_at">;
        Update: Partial<EventDocumentsRow>;
        Relationships: [];
      };
      event_faqs: {
        Row: EventFaqsRow;
        Insert: Insertable<EventFaqsRow, "id" | "position" | "created_at">;
        Update: Partial<EventFaqsRow>;
        Relationships: [];
      };
      event_media: {
        Row: EventMediaRow;
        Insert: Insertable<EventMediaRow, "id" | "type" | "caption" | "position" | "created_at">;
        Update: Partial<EventMediaRow>;
        Relationships: [];
      };
      event_schedule_items: {
        Row: EventScheduleItemsRow;
        Insert: Insertable<
          EventScheduleItemsRow,
          | "id"
          | "day"
          | "starts_at"
          | "ends_at"
          | "description"
          | "speaker"
          | "position"
          | "created_at"
        >;
        Update: Partial<EventScheduleItemsRow>;
        Relationships: [];
      };
      event_slug_history: {
        Row: EventSlugHistoryRow;
        Insert: Insertable<EventSlugHistoryRow, "created_at">;
        Update: Partial<EventSlugHistoryRow>;
        Relationships: [];
      };
      event_speakers: {
        Row: EventSpeakersRow;
        Insert: Insertable<
          EventSpeakersRow,
          "id" | "role" | "company" | "bio" | "photo_url" | "links" | "position" | "created_at"
        >;
        Update: Partial<EventSpeakersRow>;
        Relationships: [];
      };
      event_tags: {
        Row: EventTagsRow;
        Insert: EventTagsRow;
        Update: Partial<EventTagsRow>;
        Relationships: [];
      };
      events: {
        Row: EventsRow;
        Insert: Insertable<
          EventsRow,
          | "id"
          | "short_description"
          | "description"
          | "cover_url"
          | "banner_url"
          | "video_url"
          | "category_id"
          | "timezone"
          | "venue_name"
          | "address"
          | "address_number"
          | "complement"
          | "district"
          | "city"
          | "state"
          | "zip_code"
          | "country"
          | "location"
          | "allowed_radius_m"
          | "google_maps_url"
          | "overbooking_pct"
          | "seats_taken"
          | "checked_in_count"
          | "cancelled_count"
          | "registrations_open"
          | "registration_deadline"
          | "organizer_name"
          | "contact_email"
          | "contact_phone"
          | "status"
          | "published_at"
          | "archived_at"
          | "deleted_at"
          | "settings"
          | "created_at"
          | "updated_at"
          | "created_by"
          | "updated_by"
        >;
        Update: Partial<EventsRow>;
        Relationships: [];
      };
      memberships: {
        Row: MembershipsRow;
        Insert: Insertable<
          MembershipsRow,
          | "id"
          | "role"
          | "status"
          | "is_owner"
          | "invited_by"
          | "accepted_at"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<MembershipsRow>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationsRow;
        Insert: Insertable<
          NotificationsRow,
          | "id"
          | "user_id"
          | "body"
          | "link"
          | "entity_type"
          | "entity_id"
          | "read_at"
          | "created_at"
        >;
        Update: Partial<NotificationsRow>;
        Relationships: [];
      };
      outbox_jobs: {
        Row: OutboxJobsRow;
        Insert: Insertable<
          OutboxJobsRow,
          | "id"
          | "tenant_id"
          | "payload"
          | "status"
          | "run_at"
          | "attempts"
          | "max_attempts"
          | "locked_at"
          | "locked_by"
          | "last_error"
          | "dedupe_key"
          | "created_at"
        >;
        Update: Partial<OutboxJobsRow>;
        Relationships: [];
      };
      permissions: {
        Row: PermissionsRow;
        Insert: Insertable<PermissionsRow, "created_at">;
        Update: Partial<PermissionsRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfilesRow;
        Insert: Insertable<
          ProfilesRow,
          | "full_name"
          | "phone"
          | "avatar_url"
          | "locale"
          | "active_tenant_id"
          | "is_platform_admin"
          | "mfa_enabled"
          | "last_login_at"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<ProfilesRow>;
        Relationships: [];
      };
      registrations: {
        Row: RegistrationsRow;
        Insert: Insertable<
          RegistrationsRow,
          | "id"
          | "status"
          | "source"
          | "referral"
          | "custom_fields"
          | "confirmed_at"
          | "cancelled_at"
          | "ip"
          | "user_agent"
          | "idempotency_key"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<RegistrationsRow>;
        Relationships: [];
      };
      role_permissions: {
        Row: RolePermissionsRow;
        Insert: Insertable<RolePermissionsRow, "created_at">;
        Update: Partial<RolePermissionsRow>;
        Relationships: [];
      };
      support_messages: {
        Row: SupportMessagesRow;
        Insert: Insertable<SupportMessagesRow, "id" | "author_id" | "is_internal" | "created_at">;
        Update: Partial<SupportMessagesRow>;
        Relationships: [];
      };
      support_tickets: {
        Row: SupportTicketsRow;
        Insert: Insertable<
          SupportTicketsRow,
          | "id"
          | "category"
          | "priority"
          | "status"
          | "requester_id"
          | "assignee_id"
          | "event_id"
          | "sla_due_at"
          | "resolved_at"
          | "closed_at"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<SupportTicketsRow>;
        Relationships: [];
      };
      tags: {
        Row: TagsRow;
        Insert: Insertable<TagsRow, "id" | "created_at">;
        Update: Partial<TagsRow>;
        Relationships: [];
      };
      tenant_invitations: {
        Row: TenantInvitationsRow;
        Insert: Insertable<
          TenantInvitationsRow,
          "id" | "role" | "expires_at" | "accepted_at" | "revoked_at" | "invited_by" | "created_at"
        >;
        Update: Partial<TenantInvitationsRow>;
        Relationships: [];
      };
      tenant_settings: {
        Row: TenantSettingsRow;
        Insert: Insertable<TenantSettingsRow, "updated_at" | "updated_by">;
        Update: Partial<TenantSettingsRow>;
        Relationships: [];
      };
      tenants: {
        Row: TenantsRow;
        Insert: Insertable<
          TenantsRow,
          | "id"
          | "document"
          | "logo_url"
          | "brand_color"
          | "plan"
          | "status"
          | "timezone"
          | "settings"
          | "created_at"
          | "updated_at"
          | "created_by"
          | "updated_by"
          | "deleted_at"
          | "contact_email"
          | "contact_phone"
          | "address"
          | "city"
          | "state"
          | "zip_code"
        >;
        Update: Partial<TenantsRow>;
        Relationships: [];
      };
      tickets: {
        Row: TicketsRow;
        Insert: Insertable<
          TicketsRow,
          | "id"
          | "status"
          | "issued_at"
          | "expires_at"
          | "revoked_at"
          | "revoked_reason"
          | "pdf_path"
          | "reissued_from"
          | "created_at"
        >;
        Update: Partial<TicketsRow>;
        Relationships: [];
      };
      user_event_scopes: {
        Row: UserEventScopesRow;
        Insert: Insertable<UserEventScopesRow, "created_at" | "created_by">;
        Update: Partial<UserEventScopesRow>;
        Relationships: [];
      };
      user_permission_overrides: {
        Row: UserPermissionOverridesRow;
        Insert: Insertable<UserPermissionOverridesRow, "reason" | "created_at" | "created_by">;
        Update: Partial<UserPermissionOverridesRow>;
        Relationships: [];
      };
    };
    Views: {
      v_audit_logs: { Row: VAuditLogsRow; Relationships: [] };
      v_checkin_alerts: { Row: VCheckinAlertsRow; Relationships: [] };
      v_event_stats: { Row: VEventStatsRow; Relationships: [] };
      v_registration_full: { Row: VRegistrationFullRow; Relationships: [] };
    };
    Functions: {
      my_context: { Args: Record<string, never>; Returns: Json };
      switch_tenant: { Args: { p_tenant_id: string }; Returns: Json };
      accept_invitation: { Args: { p_token: string }; Returns: Json };
      log_auth_event: {
        Args: {
          p_event_type: string;
          p_success?: boolean;
          p_email?: string | null;
          p_metadata?: Json;
        };
        Returns: undefined;
      };
      create_registration: {
        Args: { p_event_id: string; p_attendee: Json; p_consents?: Json; p_context?: Json };
        Returns: Json;
      };
      cancel_registration: {
        Args: {
          p_registration_id: string;
          p_reason_code?: string | null;
          p_reason_text?: string | null;
          p_context?: Json;
        };
        Returns: Json;
      };
      checkin: { Args: { p_token: string; p_context?: Json }; Returns: Json };
      get_ticket: { Args: { p_token: string }; Returns: Json };
      dashboard_kpis: { Args: { p_from?: string | null; p_to?: string | null }; Returns: Json };
      search_attendees: { Args: { p_event_id: string; p_term: string }; Returns: Json };
      checkin_batch: { Args: { p_items: Json }; Returns: Json };
      checkin_manifest: { Args: { p_event_id: string }; Returns: Json };
      claim_outbox_jobs: { Args: { p_limit?: number; p_worker?: string }; Returns: Json };
      complete_outbox_job: {
        Args: { p_id: string; p_success: boolean; p_error?: string | null };
        Returns: undefined;
      };
      requeue_stale_outbox_jobs: { Args: { p_older_than?: string }; Returns: number };
    };
    Enums: {
      audit_action: AuditAction;
      checkin_result: CheckinResult;
      email_status: EmailStatus;
      event_status: EventStatus;
      job_status: JobStatus;
      membership_status: MembershipStatus;
      registration_status: RegistrationStatus;
      support_priority: SupportPriority;
      support_status: SupportStatus;
      tenant_status: TenantStatus;
      ticket_status: TicketStatus;
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];

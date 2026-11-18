-- =============================================================================
-- Reversão de 20260801094100_whatsapp_escala_schema
--
-- Rodar SÓ depois de reverter as migrations posteriores do WhatsApp em escala
-- (094400, 094300, 094200 — nesta ordem). Apaga as notificações registradas
-- pelo caminho novo; o histórico antigo (`whatsapp_messages`) fica intacto.
-- =============================================================================

drop trigger if exists tg_whatsapp_connection_templates on public.whatsapp_connections;
drop function if exists private.sync_whatsapp_templates();
drop trigger if exists tg_tenant_whatsapp_templates on public.tenants;
drop function if exists private.seed_whatsapp_templates();
drop function if exists private.ensure_whatsapp_templates(uuid);

drop table if exists public.whatsapp_worker_heartbeats;
drop table if exists public.whatsapp_rate_buckets;
drop table if exists public.whatsapp_optouts;
drop table if exists public.whatsapp_webhook_events;
drop table if exists public.whatsapp_notifications;
drop table if exists public.whatsapp_templates;

drop type if exists public.whatsapp_notification_kind;
drop type if exists public.whatsapp_notification_status;

alter table public.consents drop column if exists subject;

alter table public.whatsapp_connections
  drop column if exists rate_per_second,
  drop column if exists daily_unique_limit,
  drop column if exists worker_concurrency,
  drop column if exists paused,
  drop column if exists paused_reason,
  drop column if exists paused_at,
  drop column if exists paused_by,
  drop column if exists breaker_open_until,
  drop column if exists breaker_manual,
  drop column if exists quality_rating,
  drop column if exists messaging_tier;

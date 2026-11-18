-- Reversão de 20260801094400_whatsapp_escala_webhook. Rodar antes de reverter 094300.
drop function if exists public.whatsapp_reprocess_webhooks(int);
drop function if exists public.whatsapp_ingest_webhook(text, jsonb);
drop function if exists private.whatsapp_apply_webhook(uuid);
drop function if exists private.whatsapp_apply_inbound(uuid, jsonb);
drop function if exists private.whatsapp_apply_status(uuid, jsonb);
drop function if exists private.whatsapp_block_number(uuid, text, text, text);
drop function if exists private.whatsapp_webhook_tenant(text);
drop function if exists private.whatsapp_status_rank(public.whatsapp_notification_status);

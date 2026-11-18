-- Reversão de 20260801094200_whatsapp_escala_funcoes. Rodar depois de reverter 094300.
drop function if exists public.whatsapp_open_breaker(uuid, timestamptz, text, boolean);
drop function if exists public.whatsapp_heartbeat(text, jsonb);
drop function if exists public.whatsapp_unique_recipients_24h(uuid);
drop function if exists public.reconcile_whatsapp(interval);
drop function if exists public.record_whatsapp_result(uuid, text, text, int, text, timestamptz, boolean);
drop function if exists public.mark_whatsapp_request_started(uuid[]);
drop function if exists public.claim_whatsapp_notifications(uuid, int, text);
drop function if exists public.whatsapp_throttle(uuid, double precision, int);
drop function if exists public.whatsapp_take_tokens(uuid, int);
drop function if exists private.to_e164_br(text);

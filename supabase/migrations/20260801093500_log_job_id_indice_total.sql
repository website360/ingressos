-- =============================================================================
-- 20260801093500_log_job_id_indice_total
--
-- O índice único de `job_id` nasceu parcial (`where job_id is not null`), o que
-- parecia econômico e não serve: o Postgres só usa índice parcial para inferir
-- o alvo de um `ON CONFLICT` quando a instrução repete o predicado, e o
-- PostgREST não repete. O upsert do worker falharia com "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- Índice total resolve e não custa nada: em índice único, NULLs são distintos
-- entre si, então as linhas antigas sem `job_id` continuam convivendo.
-- =============================================================================

drop index if exists public.uq_email_messages_job;
drop index if exists public.uq_whatsapp_messages_job;

create unique index uq_email_messages_job    on public.email_messages (job_id);
create unique index uq_whatsapp_messages_job on public.whatsapp_messages (job_id);

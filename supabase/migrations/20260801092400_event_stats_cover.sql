-- =============================================================================
-- 20260801092400_event_stats_cover
--
-- A view de estatísticas não expunha as imagens, então a listagem do painel não
-- tinha como mostrar a capa — o organizador subia a imagem e não via resultado
-- em lugar nenhum.
-- =============================================================================

-- `create or replace view` só aceita colunas NOVAS no fim da lista; inserir no
-- meio exige recriar. Nada depende desta view, então o drop é seguro.
drop view if exists public.v_event_stats;

create view public.v_event_stats with (security_invoker = true) as
select
  e.id                as event_id,
  e.tenant_id,
  e.name,
  e.slug,
  e.status,
  e.starts_at,
  e.ends_at,
  e.city,
  e.state,
  e.cover_url,
  e.banner_url,
  e.capacity,
  e.seats_taken,
  e.seats_waitlist,
  e.checked_in_count,
  e.cancelled_count,
  greatest(e.capacity - e.seats_taken, 0)                         as seats_available,
  round(100.0 * e.seats_taken / nullif(e.capacity, 0), 1)         as occupancy_pct,
  round(100.0 * e.checked_in_count / nullif(e.seats_taken, 0), 1) as attendance_pct
from public.events e
where e.deleted_at is null;

-- =============================================================================
-- 20260801092300_drop_sponsors
--
-- Patrocinadores não fazem parte do produto. A tabela é isolada — nenhuma outra
-- referencia `event_sponsors` —, então some inteira em vez de virar schema
-- morto carregando duas políticas de RLS e confundindo quem ler a modelagem
-- depois.
--
-- Reversão: recriar a partir do bloco `event_sponsors` em
-- `20260801091300_events.sql`, incluindo as políticas de leitura pública e de
-- escrita por `event.update`.
-- =============================================================================

drop table if exists public.event_sponsors;

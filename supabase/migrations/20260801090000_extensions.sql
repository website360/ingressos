-- =============================================================================
-- 20260801090000_extensions
-- Extensões utilizadas pela plataforma (docs/03, seção 2).
-- Reversão: DROP EXTENSION ... (nunca executar em produção com dados dependentes)
-- =============================================================================

create schema if not exists extensions;

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid, digest, hmac
create extension if not exists "citext"    with schema extensions;  -- e-mail/slug case-insensitive
create extension if not exists "pg_trgm"   with schema extensions;  -- busca por nome (check-in)
create extension if not exists "unaccent"  with schema extensions;  -- busca sem acento
create extension if not exists "btree_gist" with schema extensions; -- constraints de exclusão

-- postgis: geofence do check-in (docs/02, seção 9). Cria o schema próprio.
create extension if not exists "postgis";

-- Agendamento e HTTP a partir do banco (worker de outbox, jobs de manutenção).
create extension if not exists "pg_cron";
create extension if not exists "pg_net" with schema extensions;

-- Torna as funções das extensões visíveis sem prefixo para os papéis da API.
alter database postgres set search_path to "$user", public, extensions;

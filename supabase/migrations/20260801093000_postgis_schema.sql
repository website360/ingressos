-- =============================================================================
-- 20260801093000_postgis_schema
-- Move o PostGIS de `public` para `extensions`.
--
-- CAUSA
-- `create extension if not exists "postgis"` (20260801090000) foi executado sem
-- `with schema`, então a extensão nasceu em `public`. Junto com ela veio
-- `public.spatial_ref_sys` — dentro de um schema exposto pelo PostgREST. É o
-- alerta `rls_disabled_in_public` que o Supabase envia por e-mail.
--
-- POR QUE O RISCO ACEITO EM 20260801091000 NÃO SE SUSTENTA
-- Aquele cabeçalho classificou a tabela como "somente leitura, sem dado de
-- tenant, impacto real nenhum". A primeira parte está errada: `anon` e
-- `authenticated` têm DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE e
-- UPDATE. Um POST anônimo em /rest/v1/spatial_ref_sys passa pela checagem de
-- permissão e só para na chave primária (23505). Não há vazamento — o conteúdo
-- é o catálogo EPSG público —, mas há escrita anônima ilimitada: inserção de
-- linhas sem teto (storage/custo) e TRUNCATE do catálogo.
--
-- POR QUE REVOKE NÃO RESOLVE
-- A tabela pertence a `supabase_admin` e as migrations rodam como `postgres`,
-- que não é dono nem superusuário. O REVOKE é aceito com warning e não altera
-- nada — verificado em transação revertida.
--
-- POR QUE ESTA MIGRATION FUNCIONA
-- O cabeçalho de 091000 também supunha que `drop extension` era impossível por
-- falta de posse. Não é: a tentativa falha com 2BP01 (dependência), não com
-- 42501 (permissão) — ou seja, `postgres` passa pela checagem de posse. Com
-- CASCADE e recriação em `extensions`, `spatial_ref_sys` sai do schema exposto
-- e o alerta desaparece na origem.
--
-- ESCOPO DO CASCADE (levantado em pg_depend antes de escrever)
--   · 6 colunas geography(Point,4326): public.events, public.checkins,
--     audit.audit_logs e suas 3 partições;
--   · 2 índices GiST: ix_events_geo, ix_checkins_geo;
--   · nenhuma view — v_registration_full não referencia `location`;
--   · nenhuma função do projeto tem geography na assinatura.
--
-- Reversão: repetir o processo com `with schema public`. Não desejada.
-- =============================================================================

-- Durante a migration o PostGIS troca de schema no meio do caminho: antes do
-- drop as funções estão em `public`, depois em `extensions`. Manter os dois no
-- search_path evita qualificar cada chamada.
set search_path to public, extensions;

-- -----------------------------------------------------------------------------
-- 1. Preserva lat/lon antes do CASCADE derrubar as colunas
--
-- geography -> geometry não consulta spatial_ref_sys; st_x é longitude e st_y é
-- latitude. As tabelas ficam em `private`, que não é exposto pelo PostgREST.
-- -----------------------------------------------------------------------------
drop table if exists private._geo_backup_events;
drop table if exists private._geo_backup_checkins;
drop table if exists private._geo_backup_audit;

create table private._geo_backup_events as
  select id, st_y(location::geometry) as lat, st_x(location::geometry) as lon
    from public.events
   where location is not null;

create table private._geo_backup_checkins as
  select id, st_y(location::geometry) as lat, st_x(location::geometry) as lon
    from public.checkins
   where location is not null;

-- audit_logs é particionada: a PK é (id, created_at).
create table private._geo_backup_audit as
  select id, created_at, st_y(location::geometry) as lat, st_x(location::geometry) as lon
    from audit.audit_logs
   where location is not null;

-- -----------------------------------------------------------------------------
-- 2. Recria a extensão no schema certo
-- -----------------------------------------------------------------------------
drop extension postgis cascade;

create extension postgis with schema extensions;

-- -----------------------------------------------------------------------------
-- 3. Recria as colunas
--
-- O tipo agora é `extensions.geography`. As colunas voltam no fim da tabela;
-- todos os INSERTs do schema usam lista explícita de colunas, então a posição
-- não importa. Em audit_logs, adicionar na tabela-pai propaga às partições.
-- -----------------------------------------------------------------------------
alter table public.events    add column if not exists location extensions.geography(Point, 4326);
alter table public.checkins  add column if not exists location extensions.geography(Point, 4326);
alter table audit.audit_logs add column if not exists location extensions.geography(Point, 4326);

-- -----------------------------------------------------------------------------
-- 4. Restaura os valores
--
-- Dois obstáculos, ambos temporários:
--   · `force row level security` vale inclusive para o dono da tabela, então
--     `postgres` também é filtrado pelas policies;
--   · os triggers reagiriam ao UPDATE — tg_audit_events geraria auditoria falsa,
--     tg_events_updated_at mexeria no updated_at, tg_checkin_counter
--     recontaria o check-in e tg_audit_logs_immutable bloquearia a escrita.
-- As partições entram no laço junto com a tabela-pai.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')   -- exclui audit_logs_pkey e demais índices
       and ((n.nspname = 'public' and c.relname in ('events', 'checkins'))
         or (n.nspname = 'audit'  and c.relname like 'audit_logs%'))
  loop
    execute format('alter table %s disable trigger user', r.rel);
    execute format('alter table %s no force row level security', r.rel);
  end loop;
end;
$$;

update public.events e
   set location = st_setsrid(st_makepoint(b.lon, b.lat), 4326)::extensions.geography
  from private._geo_backup_events b
 where b.id = e.id;

update public.checkins c
   set location = st_setsrid(st_makepoint(b.lon, b.lat), 4326)::extensions.geography
  from private._geo_backup_checkins b
 where b.id = c.id;

update audit.audit_logs a
   set location = st_setsrid(st_makepoint(b.lon, b.lat), 4326)::extensions.geography
  from private._geo_backup_audit b
 where b.id = a.id
   and b.created_at = a.created_at;

do $$
declare
  r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')   -- exclui audit_logs_pkey e demais índices
       and ((n.nspname = 'public' and c.relname in ('events', 'checkins'))
         or (n.nspname = 'audit'  and c.relname like 'audit_logs%'))
  loop
    execute format('alter table %s force row level security', r.rel);
    execute format('alter table %s enable trigger user', r.rel);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Recria os índices GiST derrubados pelo CASCADE
-- -----------------------------------------------------------------------------
create index if not exists ix_events_geo   on public.events   using gist (location);
create index if not exists ix_checkins_geo on public.checkins using gist (location);

-- -----------------------------------------------------------------------------
-- 6. Corrige o search_path de audit.log
--
-- A função monta a coluna `location` com st_setsrid/st_makepoint, mas seu
-- search_path era `audit, public, private` — sem `extensions`. Com o PostGIS
-- fora de `public` as chamadas deixariam de resolver, e como o corpo termina em
-- `exception when others then raise warning`, a falha seria silenciosa: o
-- INSERT inteiro é abortado e o registro de auditoria some sem erro visível.
--
-- public.checkin e public.checkin_manifest já declaram `extensions` — são as
-- outras duas únicas funções do projeto que usam PostGIS.
-- -----------------------------------------------------------------------------
alter function audit.log(audit.audit_action, text, uuid, jsonb, uuid)
  set search_path = audit, public, private, extensions;

-- -----------------------------------------------------------------------------
-- 7. Verificação — falha a migration em vez de deixar o banco meio migrado
-- -----------------------------------------------------------------------------
do $$
declare
  v_schema text;
  v_events integer;
  v_checkins integer;
  v_audit integer;
begin
  select n.nspname into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis';

  if v_schema is distinct from 'extensions' then
    raise exception 'postgis deveria estar em extensions, está em %', coalesce(v_schema, '(ausente)');
  end if;

  if to_regclass('public.spatial_ref_sys') is not null then
    raise exception 'public.spatial_ref_sys ainda existe no schema exposto';
  end if;

  select count(*) into v_events   from private._geo_backup_events b
    join public.events e on e.id = b.id where e.location is null;
  select count(*) into v_checkins from private._geo_backup_checkins b
    join public.checkins c on c.id = b.id where c.location is null;
  select count(*) into v_audit    from private._geo_backup_audit b
    join audit.audit_logs a on a.id = b.id and a.created_at = b.created_at
   where a.location is null;

  if v_events + v_checkins + v_audit > 0 then
    raise exception 'location não restaurada: % events, % checkins, % audit_logs',
      v_events, v_checkins, v_audit;
  end if;

  raise notice 'postgis movido para extensions; spatial_ref_sys fora do schema exposto.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Limpeza
-- -----------------------------------------------------------------------------
drop table private._geo_backup_events;
drop table private._geo_backup_checkins;
drop table private._geo_backup_audit;

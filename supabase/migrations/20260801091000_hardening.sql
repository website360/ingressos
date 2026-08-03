-- =============================================================================
-- 20260801091000_hardening
-- Correções de superfície de exposição detectadas na primeira aplicação em
-- ambiente gerenciado (docs/07).
--
-- 1. Partições de auditoria sem RLS própria
-- 2. spatial_ref_sys (PostGIS) exposta no schema public
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Partições de audit_logs
--
-- Ao consultar a tabela-pai, valem as policies do pai — partição nova não herda
-- `relrowsecurity`. Consulta direta à partição escaparia. Habilitar RLS sem
-- policy nas partições nega o acesso direto e não interfere no acesso pelo pai.
-- -----------------------------------------------------------------------------
do $$
declare
  v_partition text;
begin
  for v_partition in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'audit' and c.relkind = 'r' and c.relispartition
  loop
    execute format('alter table audit.%I enable row level security', v_partition);
    execute format('alter table audit.%I force  row level security', v_partition);
  end loop;
end;
$$;

-- Partições futuras já nascem protegidas.
create or replace function audit.ensure_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = audit, public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
begin
  if to_regclass(format('audit.%I', v_name)) is null then
    execute format(
      'create table audit.%I partition of audit.audit_logs for values from (%L) to (%L)',
      v_name, v_start, v_end
    );
    execute format('alter table audit.%I enable row level security', v_name);
    execute format('alter table audit.%I force  row level security', v_name);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. spatial_ref_sys — RISCO ACEITO E DOCUMENTADO
--
-- O PostGIS cria esta tabela em `public`, e ela aparece nos avisos de segurança
-- do Supabase como "exposta". NÃO é corrigível a partir daqui:
--
--   · a tabela pertence a `supabase_admin`; as migrations rodam como `postgres`,
--     que não é superusuário no Supabase gerenciado — um REVOKE é ignorado
--     silenciosamente (o Postgres apenas emite um warning);
--   · `alter extension postgis set schema` falha: o PostGIS não é relocável;
--   · `drop extension` exige a posse da extensão, que também é do supabase_admin.
--
-- Impacto real: nenhum. É um catálogo público de sistemas de coordenadas
-- (EPSG), somente leitura, sem qualquer dado de tenant. O projeto não usa
-- ST_Transform, e as funções de geofence são SECURITY DEFINER.
--
-- Reavaliar na Sprint 6, quando as colunas geography de eventos e check-ins
-- forem criadas: em base nova, `create extension postgis with schema extensions`
-- resolve na origem.
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'spatial_ref_sys permanece em public — risco aceito, ver cabeçalho.';
end;
$$;

comment on function audit.ensure_partition(date) is
  'Cria a partição mensal de audit_logs já com RLS habilitada e forçada.';

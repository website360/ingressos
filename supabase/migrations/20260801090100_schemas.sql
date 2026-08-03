-- =============================================================================
-- 20260801090100_schemas
-- Schemas, papéis e utilitários transversais.
--   private : funções SECURITY DEFINER e helpers de RLS — NÃO exposto pela API
--   api     : fachada fina de RPCs que o cliente pode chamar
--   audit   : trilha append-only
-- =============================================================================

create schema if not exists private;
create schema if not exists api;
create schema if not exists audit;

-- `private` é interno: nenhum papel da API enxerga.
revoke all on schema private from anon, authenticated;
grant usage on schema private to postgres, service_role;

-- `api` é a única superfície de RPC exposta.
grant usage on schema api to anon, authenticated, service_role;

grant usage on schema audit to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Contexto da requisição (ADR-013)
-- Combina o contexto explícito passado às RPCs (`app.context`) com os headers
-- que o PostgREST expõe. Assim, mesmo uma escrita REST simples registra IP e
-- user agent na auditoria.
-- -----------------------------------------------------------------------------
create or replace function private.jwt_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function private.request_headers()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function private.request_context()
returns jsonb
language sql
stable
as $$
  select
    coalesce(nullif(current_setting('app.context', true), '')::jsonb, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'ip', coalesce(
                 nullif(current_setting('app.context', true), '')::jsonb ->> 'ip',
                 split_part(private.request_headers() ->> 'x-forwarded-for', ',', 1)
               ),
         'user_agent', coalesce(
                 nullif(current_setting('app.context', true), '')::jsonb ->> 'user_agent',
                 private.request_headers() ->> 'user-agent'
               ),
         'request_id', coalesce(
                 nullif(current_setting('app.context', true), '')::jsonb ->> 'request_id',
                 private.request_headers() ->> 'x-request-id'
               )
       ));
$$;

-- Define o contexto para o restante da transação. Chamado no início de cada RPC.
create or replace function private.set_request_context(p_context jsonb)
returns void
language plpgsql
as $$
begin
  perform set_config('app.context', coalesce(p_context, '{}'::jsonb)::text, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers utilitários
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.set_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

comment on schema private is 'Funções internas e helpers de RLS. Não exposto via PostgREST.';
comment on schema api is 'Fachada de RPCs chamáveis pelo cliente.';
comment on schema audit is 'Trilha de auditoria append-only (docs/07, seção 10).';

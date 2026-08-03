-- =============================================================================
-- pgTAP — Isolamento multi-tenant (DoD da Sprint 1)
--
-- Um usuário do tenant A não pode ler, criar, alterar ou remover NADA do
-- tenant B — mesmo com token válido. Este teste é obrigatório no CI: tabela
-- nova sem cobertura aqui não passa no pipeline.
--
-- Execução: supabase test db
-- =============================================================================

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

begin;
select plan(16);

-- Simula uma sessão autenticada montando as claims exatamente como o GoTrue faria.
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
declare
  v_claims jsonb;
begin
  v_claims := private.custom_access_token_hook(
    jsonb_build_object('user_id', p_user_id, 'claims',
      jsonb_build_object('sub', p_user_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb))
  );
  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Estrutura: RLS habilitada e forçada em todas as tabelas
-- -----------------------------------------------------------------------------
select is_empty(
  $$ select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','audit')
       and c.relkind = 'r'
       and not c.relrowsecurity $$,
  'Toda tabela em public/audit tem RLS habilitada'
);

select is_empty(
  $$ select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','audit')
       and c.relkind = 'r'
       and not c.relforcerowsecurity $$,
  'Toda tabela em public/audit tem FORCE ROW LEVEL SECURITY'
);

select is(
  (select count(*)::int from pg_namespace where nspname = 'private'),
  1,
  'Schema private existe'
);

-- -----------------------------------------------------------------------------
-- Claims: o hook monta o contexto corretamente
-- -----------------------------------------------------------------------------
select tests.authenticate_as('aaaaaaaa-0000-0000-0000-000000000001');

select is(
  (select private.current_tenant()),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Tenant ativo vem do JWT'
);

select ok(
  (select private.has_perm('event.create')),
  'Administrador possui event.create'
);

select ok(
  (select not private.has_perm('inexistente.perm')),
  'Permissão inexistente retorna falso'
);

-- -----------------------------------------------------------------------------
-- Leitura: A não enxerga B
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from public.tenants where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Admin do tenant A não enxerga o tenant B'
);

select is(
  (select count(*)::int from public.memberships
    where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Admin do tenant A não enxerga vínculos do tenant B'
);

select is(
  (select count(*)::int from public.tenant_settings
    where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Admin do tenant A não enxerga configurações do tenant B'
);

select is(
  (select count(*)::int from public.role_permissions
    where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Admin do tenant A não enxerga permissões do tenant B'
);

-- -----------------------------------------------------------------------------
-- Escrita: A não escreve em B
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.memberships (tenant_id, user_id, role)
     values ('22222222-2222-2222-2222-222222222222',
             'aaaaaaaa-0000-0000-0000-000000000001', 'admin') $$,
  '42501',
  null,
  'Inserir vínculo no tenant B é bloqueado pela RLS'
);

select is(
  (with updated as (
     update public.tenants set name = 'Invadido'
      where id = '22222222-2222-2222-2222-222222222222' returning 1
   ) select count(*)::int from updated),
  0,
  'UPDATE no tenant B não afeta nenhuma linha'
);

-- -----------------------------------------------------------------------------
-- Autoescalonamento de privilégio
-- -----------------------------------------------------------------------------
select is(
  (with updated as (
     update public.memberships set role = 'admin'
      where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        and tenant_id = '11111111-1111-1111-1111-111111111111' returning 1
   ) select count(*)::int from updated),
  0,
  'Usuário não consegue alterar o próprio vínculo'
);

select throws_ok(
  $$ update public.profiles set is_platform_admin = true
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'IG005',
  null,
  'Usuário não consegue se tornar admin de plataforma'
);

-- -----------------------------------------------------------------------------
-- Auditoria é append-only
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ delete from audit.audit_logs where true $$,
  null,
  null,
  'DELETE na trilha de auditoria é rejeitado'
);

-- -----------------------------------------------------------------------------
-- Usuário multiempresa: enxerga as duas, mas só opera a ativa
-- -----------------------------------------------------------------------------
select tests.authenticate_as('cccccccc-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.memberships where user_id = 'cccccccc-0000-0000-0000-000000000001'),
  2,
  'Usuário multiempresa enxerga os próprios dois vínculos'
);

select * from finish();
rollback;

-- =============================================================================
-- seed.sql — dados de desenvolvimento (idempotente)
--
-- Cria DUAS empresas de propósito: o isolamento multi-tenant só é verificável
-- com um vizinho para tentar enxergar (docs/06, DoD da Sprint 1).
--
-- Senha de todos os usuários: Ingressos@2026
-- =============================================================================

set search_path = public, private, audit, extensions;

-- -----------------------------------------------------------------------------
-- Helper local: cria usuário no Auth já confirmado.
-- -----------------------------------------------------------------------------
create or replace function private.seed_user(p_id uuid, p_email text, p_name text)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, crypt('Ingressos@2026', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name),
    now(), now()
  )
  on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (
    gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email', now(), now()
  )
  on conflict do nothing;

  update public.profiles set full_name = p_name where id = p_id;
  return p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Empresas
-- -----------------------------------------------------------------------------
insert into public.tenants (id, name, slug, document, brand_color, status, plan)
values
  ('11111111-1111-1111-1111-111111111111', 'Agência May Eventos', 'agencia-may', '12345678000190', '#2563eb', 'ativo', 'pro'),
  ('22222222-2222-2222-2222-222222222222', 'Instituto Horizonte',  'horizonte',   '98765432000110', '#7c3aed', 'ativo', 'trial')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Usuários
-- -----------------------------------------------------------------------------
select private.seed_user('aaaaaaaa-0000-0000-0000-000000000001', 'admin@agenciamay.com.br',      'Caio Almeida');
select private.seed_user('aaaaaaaa-0000-0000-0000-000000000002', 'organizador@agenciamay.com.br','Renata Duarte');
select private.seed_user('aaaaaaaa-0000-0000-0000-000000000003', 'recepcao@agenciamay.com.br',   'Paulo Ferreira');
select private.seed_user('aaaaaaaa-0000-0000-0000-000000000004', 'suporte@agenciamay.com.br',    'Bianca Rocha');
-- Usuário da OUTRA empresa — usado nos testes de isolamento.
select private.seed_user('bbbbbbbb-0000-0000-0000-000000000001', 'admin@horizonte.org.br',       'Marcos Vieira');
-- Usuário em DUAS empresas — valida o seletor de empresa (RF-01.2).
select private.seed_user('cccccccc-0000-0000-0000-000000000001', 'multi@agenciamay.com.br',      'Helena Souza');

-- -----------------------------------------------------------------------------
-- Vínculos
-- -----------------------------------------------------------------------------
insert into public.memberships (tenant_id, user_id, role, status, is_owner, accepted_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin',       'ativo', true,  now()),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'organizador', 'ativo', false, now()),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'recepcao',    'ativo', false, now()),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000004', 'suporte',     'ativo', false, now()),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'admin',       'ativo', true,  now()),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 'organizador', 'ativo', false, now()),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-000000000001', 'suporte',     'ativo', false, now())
on conflict (tenant_id, user_id) do nothing;

-- Empresa ativa inicial de cada usuário
update public.profiles set active_tenant_id = '11111111-1111-1111-1111-111111111111'
 where id in (
   'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000004',
   'cccccccc-0000-0000-0000-000000000001'
 );
update public.profiles set active_tenant_id = '22222222-2222-2222-2222-222222222222'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- Configurações padrão
-- -----------------------------------------------------------------------------
insert into public.tenant_settings (tenant_id, key, value) values
  ('11111111-1111-1111-1111-111111111111', 'lgpd.retention_months', '24'),
  ('11111111-1111-1111-1111-111111111111', 'auth.require_mfa_admin', 'false'),
  ('11111111-1111-1111-1111-111111111111', 'checkin.default_radius_m', '300'),
  ('22222222-2222-2222-2222-222222222222', 'lgpd.retention_months', '12')
on conflict (tenant_id, key) do nothing;

drop function private.seed_user(uuid, text, text);

do $$
begin
  raise notice 'Seed concluído. Login: admin@agenciamay.com.br / Ingressos@2026';
end;
$$;

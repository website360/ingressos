-- =============================================================================
-- 20260801091200_single_company
--
-- O sistema deixa de ser multiempresa: passa a operar UMA única empresa.
--
-- Decisão: a coluna `tenant_id` PERMANECE em todas as tabelas.
--   · A RLS inteira é construída sobre ela — reescrever 30 políticas para
--     remover uma coluna que custa 16 bytes seria risco sem retorno.
--   · O papel de Recepção continua precisando de isolamento por permissão e
--     por evento; a infraestrutura é a mesma.
--   · Se um dia houver uma segunda empresa (filial, marca, evento white-label),
--     basta remover a constraint abaixo.
--
-- O que muda de verdade: existe no máximo UMA empresa, o usuário não escolhe
-- empresa, e a interface não mostra nada sobre isso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Garante empresa única
-- -----------------------------------------------------------------------------
do $$
declare
  v_keep uuid;
begin
  select id into v_keep
    from public.tenants
   where deleted_at is null
   order by created_at
   limit 1;

  if v_keep is not null then
    -- Remove qualquer empresa extra criada durante o desenvolvimento.
    delete from public.tenants where id <> v_keep;
    update public.profiles set active_tenant_id = v_keep;
  end if;
end;
$$;

-- Índice único sobre uma constante: aceita no máximo uma linha na tabela.
create unique index uq_single_company on public.tenants ((true));

comment on index public.uq_single_company is
  'Sistema de empresa única. Remover este índice é o único passo para reabilitar multiempresa.';

-- -----------------------------------------------------------------------------
-- 2. Função de conveniência: a empresa
-- -----------------------------------------------------------------------------
create or replace function private.company_id()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select id from public.tenants where deleted_at is null limit 1;
$$;

grant execute on function private.company_id() to anon, authenticated;

-- Todo usuário ativo opera a empresa. `current_tenant()` deixa de depender de
-- escolha do usuário e passa a resolver para a empresa única.
create or replace function private.current_tenant()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    nullif(private.jwt_claims() -> 'app_metadata' ->> 'active_tenant', '')::uuid,
    (select p.active_tenant_id from public.profiles p where p.id = auth.uid()),
    private.company_id()
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. Novo usuário entra automaticamente na empresa
--
-- Sem seleção de empresa, um usuário criado pelo Auth precisa nascer vinculado,
-- senão fica autenticado e sem acesso a nada.
-- -----------------------------------------------------------------------------
create or replace function private.attach_user_to_company()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company uuid := private.company_id();
begin
  if v_company is null then
    return new;
  end if;

  insert into public.memberships (tenant_id, user_id, role, status, accepted_at)
  values (v_company, new.id, 'organizador', 'ativo', now())
  on conflict (tenant_id, user_id) do nothing;

  update public.profiles set active_tenant_id = v_company where id = new.id;
  return new;
end;
$$;

create trigger tg_profile_attach_company
  after insert on public.profiles
  for each row execute function private.attach_user_to_company();

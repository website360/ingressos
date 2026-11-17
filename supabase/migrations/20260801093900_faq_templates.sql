-- =============================================================================
-- Perguntas frequentes padrão da empresa.
--
-- Servem de ponto de partida para cada evento novo: na criação, são COPIADAS
-- para `event_faqs`. A cópia é deliberada — editar ou excluir um padrão depois
-- não pode mudar, sem aviso, a página de eventos que já estão no ar.
-- =============================================================================

create table public.faq_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  question   text not null check (length(btrim(question)) between 5 and 200),
  answer     text not null check (length(btrim(answer)) between 2 and 1000),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ix_faq_templates_tenant on public.faq_templates (tenant_id, position);

create trigger tg_faq_templates_updated_at before update on public.faq_templates
  for each row execute function private.set_updated_at();

alter table public.faq_templates enable row level security;
alter table public.faq_templates force  row level security;

-- Leitura: quem cria evento (o assistente lista os padrões) ou lê configurações.
create policy faq_templates_select on public.faq_templates
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and ((select private.has_perm('event.create')) or (select private.has_perm('settings.read')))
  );

-- Escrita: só quem administra as configurações da empresa.
create policy faq_templates_write on public.faq_templates
  for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('settings.manage'))
  );

grant select, insert, update, delete on public.faq_templates to authenticated;

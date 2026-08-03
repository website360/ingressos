-- =============================================================================
-- 20260801092200_company_contact
--
-- Sistema de empresa única: o organizador de todo evento é sempre a própria
-- empresa. Pedir organizador e contato a cada evento é repetição garantida —
-- e repetição digitada à mão diverge com o tempo.
--
-- O contato passa a ser um dado da EMPRESA, preenchido uma vez em
-- Configurações. As colunas em `events` permanecem: a landing lê delas e um dia
-- pode existir evento com contato próprio. Elas passam a ser preenchidas
-- automaticamente na gravação.
-- =============================================================================

alter table public.tenants
  add column if not exists contact_email citext,
  add column if not exists contact_phone text,
  add column if not exists address       text,
  add column if not exists city          text,
  add column if not exists state         char(2),
  add column if not exists zip_code      text;

comment on column public.tenants.contact_email is
  'Contato exibido nas landings e nos e-mails. Herdado por todo evento novo.';

-- Aproveita o que já existe nos eventos para não começar vazio.
update public.tenants t
   set contact_email = coalesce(t.contact_email, sub.contact_email),
       contact_phone = coalesce(t.contact_phone, sub.contact_phone)
  from (
    select tenant_id,
           (array_agg(contact_email) filter (where contact_email is not null))[1] as contact_email,
           (array_agg(contact_phone) filter (where contact_phone is not null))[1] as contact_phone
      from public.events
     group by tenant_id
  ) sub
 where t.id = sub.tenant_id;

-- -----------------------------------------------------------------------------
-- Novo evento herda organizador e contato da empresa.
--
-- Fica no banco, e não só na aplicação, porque inscrição criada por importação,
-- API ou script também precisa da landing coerente.
-- -----------------------------------------------------------------------------
create or replace function private.inherit_company_contact()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company public.tenants%rowtype;
begin
  select * into v_company from public.tenants where id = new.tenant_id;

  new.organizer_name := coalesce(new.organizer_name, v_company.name);
  new.contact_email  := coalesce(new.contact_email, v_company.contact_email);
  new.contact_phone  := coalesce(new.contact_phone, v_company.contact_phone);

  return new;
end;
$$;

create trigger tg_event_inherit_contact
  before insert on public.events
  for each row execute function private.inherit_company_contact();

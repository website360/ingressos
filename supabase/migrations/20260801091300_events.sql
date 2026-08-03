-- =============================================================================
-- 20260801091300_events
-- Módulo M1 — catálogo de eventos e conteúdo da landing page (docs/03, 5.2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categorias e tags
-- -----------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 2 and 60),
  slug       citext not null,
  color      text default '#2563eb' check (color ~* '^#[0-9a-f]{6}$'),
  icon       text,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_category_slug unique (tenant_id, slug)
);

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  slug       citext not null,
  created_at timestamptz not null default now(),

  constraint uq_tag_slug unique (tenant_id, slug)
);

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,

  name                  text not null check (length(btrim(name)) between 3 and 160),
  slug                  citext not null,
  short_description     text check (length(short_description) <= 280),
  description           text,

  cover_url             text,
  banner_url            text,
  video_url             text,

  category_id           uuid references public.categories (id) on delete set null,

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  timezone              text not null default 'America/Sao_Paulo',

  venue_name            text,
  address               text,
  address_number        text,
  complement            text,
  district              text,
  city                  text,
  state                 char(2),
  zip_code              text,
  country               text not null default 'BR',
  location              geography(Point, 4326),
  allowed_radius_m      int not null default 300 check (allowed_radius_m between 20 and 50000),
  google_maps_url       text,

  capacity              int not null check (capacity > 0),
  overbooking_pct       numeric(5, 2) not null default 0 check (overbooking_pct between 0 and 50),
  seats_taken           int not null default 0,
  seats_waitlist        int not null default 0,
  checked_in_count      int not null default 0,
  cancelled_count       int not null default 0,

  registrations_open    boolean not null default true,
  registration_deadline timestamptz,
  waitlist_enabled      boolean not null default true,
  waitlist_hold_hours   int not null default 24 check (waitlist_hold_hours between 1 and 168),

  organizer_name        text,
  contact_email         citext,
  contact_phone         text,

  status                public.event_status not null default 'rascunho',
  published_at          timestamptz,
  archived_at           timestamptz,
  deleted_at            timestamptz,

  settings              jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,

  constraint uq_event_slug   unique (tenant_id, slug),
  constraint chk_event_dates check (ends_at > starts_at),

  -- A regra de ouro do sistema (RN-01): é o banco que impede overbooking, não
  -- o código de aplicação. Sob concorrência, só a constraint garante.
  constraint chk_capacity check (seats_taken <= floor(capacity * (1 + overbooking_pct / 100.0))),
  constraint chk_counts    check (
    seats_taken >= 0 and checked_in_count >= 0
    and cancelled_count >= 0 and seats_waitlist >= 0
    and checked_in_count <= seats_taken
  )
);

create index ix_events_listing  on public.events (tenant_id, status, starts_at desc) where deleted_at is null;
create index ix_events_category on public.events (tenant_id, category_id);
create index ix_events_geo      on public.events using gist (location);
create index ix_events_search   on public.events
  using gin (to_tsvector('portuguese', coalesce(name, '') || ' ' || coalesce(short_description, '')));

create table public.event_tags (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event_id  uuid not null references public.events (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  primary key (event_id, tag_id)
);

create table public.event_slug_history (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  old_slug   citext not null,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, old_slug)
);

-- -----------------------------------------------------------------------------
-- Tipos de ingresso
-- `price` já existe mesmo tudo sendo gratuito na fase 1 (ADR-011): incluir
-- pagamento depois passa a ser aditivo, não migração destrutiva.
-- -----------------------------------------------------------------------------
create table public.ticket_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null,
  description text,
  capacity    int check (capacity is null or capacity > 0),
  price       numeric(10, 2) not null default 0 check (price >= 0),
  sales_start timestamptz,
  sales_end   timestamptz,
  seats_taken int not null default 0,
  is_active   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_ticket_type_name unique (event_id, name)
);

create index ix_ticket_types_event on public.ticket_types (tenant_id, event_id) where is_active;

-- -----------------------------------------------------------------------------
-- Conteúdo da landing
-- -----------------------------------------------------------------------------
create table public.event_schedule_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  day         date,
  starts_at   time,
  ends_at     time,
  title       text not null,
  description text,
  speaker     text,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.event_speakers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  name       text not null,
  role       text,
  company    text,
  bio        text,
  photo_url  text,
  links      jsonb not null default '{}'::jsonb,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create table public.event_faqs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  question   text not null,
  answer     text not null,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create table public.event_sponsors (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  name       text not null,
  logo_url   text,
  link       text,
  tier       text not null default 'apoio',
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create table public.event_media (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  type       text not null default 'image',
  url        text not null,
  caption    text,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

-- Documentos versionados: o aceite do participante referencia a versão exata
-- que ele leu (RF-05.4). Sem isso, a prova de consentimento não se sustenta.
create table public.event_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  document_type text not null check (document_type in ('regulamento', 'lgpd', 'cancelamento')),
  version       int not null default 1,
  content       text not null,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  constraint uq_event_document unique (event_id, document_type, version)
);

create index ix_event_content_schedule on public.event_schedule_items (event_id, position);
create index ix_event_content_speakers on public.event_speakers (event_id, position);
create index ix_event_content_faqs     on public.event_faqs (event_id, position);
create index ix_event_content_sponsors on public.event_sponsors (event_id, position);
create index ix_event_content_media    on public.event_media (event_id, position);
create index ix_event_documents        on public.event_documents (event_id, document_type, version desc);

-- FK que ficou pendente no M0 (a tabela `events` ainda não existia).
alter table public.user_event_scopes
  add constraint fk_user_event_scopes_event
  foreign key (event_id) references public.events (id) on delete cascade;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger tg_events_updated_at before update on public.events
  for each row execute function private.set_updated_at();
create trigger tg_events_created_by before insert on public.events
  for each row execute function private.set_created_by();
create trigger tg_categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger tg_ticket_types_updated_at before update on public.ticket_types
  for each row execute function private.set_updated_at();

-- Slug antigo vira redirect 301 (RF-03.3): link compartilhado não morre.
create or replace function private.track_event_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    insert into public.event_slug_history (tenant_id, old_slug, event_id)
    values (old.tenant_id, old.slug, old.id)
    on conflict (tenant_id, old_slug) do update set event_id = excluded.event_id;
  end if;
  return new;
end;
$$;

create trigger tg_event_slug_history before update on public.events
  for each row execute function private.track_event_slug();

-- Fechamento automático (RN-07): lotação, prazo ou status.
create or replace function private.sync_event_registrations_open()
returns trigger
language plpgsql
as $$
begin
  new.registrations_open := new.registrations_open
    and new.status = 'publicado'
    and new.seats_taken < floor(new.capacity * (1 + new.overbooking_pct / 100.0))
    and (new.registration_deadline is null or new.registration_deadline > now())
    and new.starts_at > now();
  return new;
end;
$$;

create trigger tg_event_registrations_open before insert or update on public.events
  for each row execute function private.sync_event_registrations_open();

create trigger tg_audit_events
  after insert or update or delete on public.events
  for each row execute function audit.track_changes('event');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories','tags','events','event_tags','event_slug_history','ticket_types',
    'event_schedule_items','event_speakers','event_faqs','event_sponsors',
    'event_media','event_documents'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end;
$$;

-- Leitura: qualquer usuário da empresa com event.read.
-- Escrita: exige a permissão do módulo. Recepção lê e não escreve.
create policy events_select on public.events
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('event.read'))
    and deleted_at is null
  );

create policy events_insert on public.events
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('event.create'))
  );

create policy events_update on public.events
  for update to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (select private.has_perm('event.update'))
  )
  with check (tenant_id = (select private.current_tenant()));

-- Sem policy de DELETE: exclusão é sempre soft delete (RN-10).

-- Área pública: apenas evento publicado, apenas leitura.
create policy events_public_select on public.events
  for select to anon
  using (status = 'publicado' and deleted_at is null);

-- Catálogo e conteúdo seguem a mesma forma; gerado para não repetir 11 blocos.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories','tags','event_tags','ticket_types','event_schedule_items',
    'event_speakers','event_faqs','event_sponsors','event_media','event_documents'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (tenant_id = (select private.current_tenant())
               and (select private.has_perm('event.read')));

      create policy %1$s_write on public.%1$I
        for all to authenticated
        using (tenant_id = (select private.current_tenant())
               and (select private.has_perm('event.update')))
        with check (tenant_id = (select private.current_tenant())
               and (select private.has_perm('event.update')));
    $f$, t);
  end loop;
end;
$$;

-- Conteúdo público das landings publicadas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories','tags','event_tags','ticket_types','event_schedule_items',
    'event_speakers','event_faqs','event_sponsors','event_media','event_documents'
  ]
  loop
    execute format($f$
      create policy %1$s_public on public.%1$I
        for select to anon using (true);
    $f$, t);
  end loop;
end;
$$;

create policy slug_history_select on public.event_slug_history
  for select to anon, authenticated using (true);

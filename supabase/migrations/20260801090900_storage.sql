-- =============================================================================
-- 20260801090900_storage
-- Buckets e políticas do Supabase Storage (docs/01, RF-20).
-- Convenção de caminho: {tenant_id}/{recurso}/{arquivo} — a primeira pasta do
-- path é o tenant, e é isso que a policy verifica.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tenant-logos',       'tenant-logos',       true,   2 * 1024 * 1024,  array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('event-banners',      'event-banners',      true,   8 * 1024 * 1024,  array['image/png','image/jpeg','image/webp','image/avif']),
  ('event-gallery',      'event-gallery',      true,   8 * 1024 * 1024,  array['image/png','image/jpeg','image/webp','image/avif']),
  ('event-videos',       'event-videos',       true,  100 * 1024 * 1024, array['video/mp4','video/webm']),
  ('attendee-photos',    'attendee-photos',    false,  4 * 1024 * 1024,  array['image/png','image/jpeg','image/webp']),
  ('tickets-pdf',        'tickets-pdf',        false,  4 * 1024 * 1024,  array['application/pdf']),
  ('reports',            'reports',            false, 50 * 1024 * 1024,  array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('support-attachments','support-attachments',false, 20 * 1024 * 1024,  null)
on conflict (id) do nothing;

-- Extrai o tenant do caminho do objeto (primeira pasta).
create or replace function private.storage_tenant(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_first::uuid;
end;
$$;

grant execute on function private.storage_tenant(text) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Leitura
--   públicos  : qualquer um lê (landing page)
--   privados  : apenas membros do tenant dono do arquivo
-- -----------------------------------------------------------------------------
create policy storage_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('tenant-logos','event-banners','event-gallery','event-videos'));

create policy storage_tenant_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('attendee-photos','tickets-pdf','reports','support-attachments')
    and private.storage_tenant(name) = (select private.current_tenant())
  );

-- -----------------------------------------------------------------------------
-- Escrita — sempre dentro da pasta do tenant ativo e com permissão do módulo.
-- -----------------------------------------------------------------------------
create policy storage_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    private.storage_tenant(name) = (select private.current_tenant())
    and case bucket_id
      when 'tenant-logos'        then (select private.has_perm('settings.manage'))
      when 'event-banners'       then (select private.has_perm('event.update'))
      when 'event-gallery'       then (select private.has_perm('event.update'))
      when 'event-videos'        then (select private.has_perm('event.update'))
      when 'attendee-photos'     then (select private.has_perm('registration.update'))
      when 'support-attachments' then (select private.has_perm('support.write'))
      else false                              -- tickets-pdf e reports: só o servidor grava
    end
  );

create policy storage_tenant_update on storage.objects
  for update to authenticated
  using (private.storage_tenant(name) = (select private.current_tenant()))
  with check (private.storage_tenant(name) = (select private.current_tenant()));

create policy storage_tenant_delete on storage.objects
  for delete to authenticated
  using (
    private.storage_tenant(name) = (select private.current_tenant())
    and bucket_id not in ('tickets-pdf')      -- ingresso emitido não é apagável
  );

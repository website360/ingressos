-- =============================================================================
-- 20260801093600_segunda_via
-- Segunda via do ingresso, sem login.
--
-- O link do ingresso é a credencial de entrada, e quem perde o e-mail perde a
-- entrada. Até aqui a única saída era a organização reenviar na mão, pela tela
-- de envios. Esta migration abre o caminho de autoatendimento: a pessoa informa
-- o CPF, recebe um código de seis dígitos nos contatos que JÁ deu na inscrição,
-- e com o código chega à lista dos próprios ingressos.
--
-- O código é o que separa "sei um CPF" de "sou a pessoa". Sem ele, qualquer um
-- com um CPF à mão abriria o QR Code de outro — e CPF não é segredo.
--
-- Duas RPCs, as duas abertas ao papel anônimo:
--   public.request_ticket_code(cpf, context) -> máscaras dos contatos
--   public.verify_ticket_code(cpf, code)     -> lista de ingressos ativos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pedidos de código
--
-- Uma linha por PEDIDO, inclusive o que não achou inscrição — é o que permite
-- travar varredura de CPF por IP. O CPF entra como hash: serve de contador sem
-- guardar o número numa segunda tabela (LGPD, docs/07).
--
-- `code_hash` nulo marca o pedido que não gerou código. O hash leva o
-- `attendee_id` como sal; o espaço de seis dígitos é pequeno e um hash puro
-- seria reversível numa tabela de arco-íris de 1 milhão de linhas.
-- -----------------------------------------------------------------------------
create table public.ticket_access_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  cpf_hash    text not null,
  attendee_id uuid references public.attendees (id) on delete cascade,
  code_hash   text,
  expires_at  timestamptz,
  attempts    int not null default 0,
  consumed_at timestamptz,
  request_ip  inet,
  created_at  timestamptz not null default now()
);

comment on table public.ticket_access_codes is
  'Códigos de segunda via do ingresso. Uma linha por pedido; code_hash nulo = pedido sem inscrição ativa.';

create index ix_ticket_codes_cpf on public.ticket_access_codes (cpf_hash, created_at desc);

create index ix_ticket_codes_ip on public.ticket_access_codes (request_ip, created_at desc)
  where request_ip is not null;

create index ix_ticket_codes_aberto on public.ticket_access_codes (attendee_id, created_at desc)
  where attendee_id is not null and consumed_at is null;

alter table public.ticket_access_codes enable row level security;
alter table public.ticket_access_codes force  row level security;

-- Leitura para quem administra configurações: serve para explicar "pedi o
-- código e não chegou". Só hashes — não há código legível a vazar aqui.
create policy ticket_codes_select on public.ticket_access_codes
  for select to authenticated
  using (tenant_id = (select private.current_tenant())
         and (select private.has_perm('settings.read')));

-- -----------------------------------------------------------------------------
-- Máscaras dos contatos
--
-- A tela mostra para ONDE o código foi, não QUAL é o contato. O mascaramento
-- vive no banco de propósito: assim o e-mail e o telefone inteiros não saem da
-- função, e a aplicação não tem como vazar o que nunca recebeu.
-- -----------------------------------------------------------------------------
create or replace function private.mask_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  v_local  text;
  v_domain text;
  v_dot    int;
begin
  if p_email is null or p_email !~ '^[^@]+@[^@]+$' then
    return null;
  end if;

  v_local  := split_part(p_email, '@', 1);
  v_domain := split_part(p_email, '@', 2);
  v_dot    := position('.' in v_domain);

  return left(v_local, 1) || '***@' || left(v_domain, 1) || '****'
         || case when v_dot > 0 then substring(v_domain from v_dot) else '' end;
end;
$$;

create or replace function private.mask_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');

  -- O telefone é guardado sem DDI pelo formulário público e com DDI nas tabelas
  -- de WhatsApp. Só tira o 55 quando o tamanho fecha com DDI + nacional — 55
  -- também é DDD de Santa Maria/RS.
  if left(v_digits, 2) = '55' and length(v_digits) in (12, 13) then
    v_digits := substring(v_digits from 3);
  end if;

  if length(v_digits) < 10 then
    return null;
  end if;

  return '(' || left(v_digits, 2) || ') *****-' || right(v_digits, 4);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pedido do código
--
-- Dois limites, nesta ordem: por IP antes de qualquer consulta por CPF (é o que
-- trava varredura) e por CPF depois (é o que impede encher o e-mail de alguém).
-- Os dois levantam IG007, que a aplicação já traduz para "muitas tentativas".
-- -----------------------------------------------------------------------------
create or replace function public.request_ticket_code(
  p_cpf     text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  c_ttl           constant interval := interval '15 minutes';
  c_max_por_cpf   constant int := 3;
  c_max_por_ip    constant int := 10;

  v_tenant   uuid;
  v_digits   text;
  v_cpf_hash text;
  v_ip       inet;
  v_attendee public.attendees%rowtype;
  v_whatsapp boolean;
  v_phone    text;
  v_bytes    bytea;
  v_code     text;
  v_id       uuid;
  v_count    int;
begin
  v_digits := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');

  if length(v_digits) <> 11 then
    raise exception 'CPF inválido.' using errcode = 'IG003';
  end if;

  v_tenant   := private.company_id();
  v_cpf_hash := encode(extensions.digest(v_digits, 'sha256'), 'hex');

  begin
    v_ip := nullif(p_context->>'ip', '')::inet;
  exception when others then
    v_ip := null;
  end;

  if v_ip is not null then
    select count(*) into v_count
      from public.ticket_access_codes
     where request_ip = v_ip
       and created_at > now() - interval '1 hour';

    if v_count >= c_max_por_ip then
      raise exception 'Muitos pedidos deste dispositivo.' using errcode = 'IG007';
    end if;
  end if;

  select count(*) into v_count
    from public.ticket_access_codes
   where cpf_hash = v_cpf_hash
     and created_at > now() - c_ttl;

  if v_count >= c_max_por_cpf then
    raise exception 'Muitos pedidos para este CPF.' using errcode = 'IG007';
  end if;

  -- Limpeza oportunista: a tabela só serve para contar pedidos recentes.
  delete from public.ticket_access_codes where created_at < now() - interval '30 days';

  select a.* into v_attendee
    from public.attendees a
   where a.tenant_id = v_tenant
     and a.cpf = v_digits;

  -- Sem inscrição confirmada em evento que ainda vai acontecer não há segunda
  -- via a emitir. Grava o pedido mesmo assim: é o que faz o limite por IP valer
  -- também para quem está testando CPFs.
  if v_attendee.id is null or not exists (
    select 1
      from public.registrations r
      join public.events e on e.id = r.event_id
     where r.attendee_id = v_attendee.id
       and r.status = 'confirmada'
       and e.starts_at > now()
  ) then
    insert into public.ticket_access_codes (tenant_id, cpf_hash, request_ip)
    values (v_tenant, v_cpf_hash, v_ip);

    return jsonb_build_object('found', false, 'email_mask', null, 'phone_mask', null);
  end if;

  -- Pedido novo invalida o anterior: dois códigos vivos ao mesmo tempo dobram a
  -- chance de acerto no chute e confundem quem recebeu as duas mensagens.
  update public.ticket_access_codes
     set consumed_at = now()
   where attendee_id = v_attendee.id
     and consumed_at is null;

  v_bytes := extensions.gen_random_bytes(4);
  v_code := lpad(((
      get_byte(v_bytes, 0)::bigint * 16777216 +
      get_byte(v_bytes, 1)::bigint * 65536 +
      get_byte(v_bytes, 2)::bigint * 256 +
      get_byte(v_bytes, 3)::bigint
    ) % 1000000)::text, 6, '0');

  insert into public.ticket_access_codes
    (tenant_id, cpf_hash, attendee_id, code_hash, expires_at, request_ip)
  values
    (v_tenant, v_cpf_hash, v_attendee.id,
     encode(extensions.digest(v_attendee.id::text || ':' || v_code, 'sha256'), 'hex'),
     now() + c_ttl, v_ip)
  returning id into v_id;

  select exists (
    select 1 from public.whatsapp_connections where tenant_id = v_tenant
  ) into v_whatsapp;

  v_phone := nullif(coalesce(v_attendee.phone, ''), '');

  insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key)
  values (
    v_tenant,
    'email.ticket_code',
    jsonb_build_object('to', v_attendee.email, 'name', v_attendee.first_name, 'code', v_code),
    'ticket-code-' || v_id
  );

  if v_whatsapp and v_phone is not null then
    -- `run_at` no futuro escapa de propósito do alocador de ritmo
    -- (private.schedule_whatsapp_job, que só reescreve `run_at <= now()`).
    -- Ritmo existe para não parecer disparo em massa; isto é resposta 1:1 a um
    -- toque de botão, e um código que chega em dez minutos é um código morto.
    -- O volume continua preso aos limites por CPF e por IP acima.
    insert into public.outbox_jobs (tenant_id, type, payload, dedupe_key, run_at)
    values (
      v_tenant,
      'whatsapp.ticket_code',
      jsonb_build_object('phone', v_phone, 'name', v_attendee.first_name, 'code', v_code),
      'wa-ticket-code-' || v_id,
      now() + interval '1 second'
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'email_mask', private.mask_email(v_attendee.email::text),
    'phone_mask', case when v_whatsapp and v_phone is not null
                       then private.mask_phone(v_phone) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Conferência do código
--
-- Devolve `ok: false` em vez de levantar exceção no código errado: exceção
-- aborta a transação, e com ela o incremento de `attempts` — o limite de
-- tentativas viraria enfeite. A resposta é a mesma para código errado,
-- expirado, já usado e inexistente; dizer qual dos quatro ajudaria só quem
-- está chutando.
-- -----------------------------------------------------------------------------
create or replace function public.verify_ticket_code(p_cpf text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  c_max_tentativas constant int := 5;

  v_tenant   uuid;
  v_digits   text;
  v_code     text;
  v_attendee public.attendees%rowtype;
  v_row      public.ticket_access_codes%rowtype;
  v_tickets  jsonb;
begin
  v_digits := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_code   := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');

  if length(v_digits) <> 11 or length(v_code) <> 6 then
    return jsonb_build_object('ok', false);
  end if;

  v_tenant := private.company_id();

  select a.* into v_attendee
    from public.attendees a
   where a.tenant_id = v_tenant
     and a.cpf = v_digits;

  if v_attendee.id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_row
    from public.ticket_access_codes
   where attendee_id = v_attendee.id
     and code_hash is not null
     and consumed_at is null
   order by created_at desc
   limit 1
     for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false);
  end if;

  update public.ticket_access_codes
     set attempts = attempts + 1
   where id = v_row.id;

  if v_row.expires_at <= now() or v_row.attempts >= c_max_tentativas then
    return jsonb_build_object('ok', false);
  end if;

  if v_row.code_hash <> encode(extensions.digest(v_attendee.id::text || ':' || v_code, 'sha256'), 'hex') then
    return jsonb_build_object('ok', false);
  end if;

  update public.ticket_access_codes set consumed_at = now() where id = v_row.id;

  -- `distinct on (r.id)`: reemissão deixa mais de um ingresso na mesma
  -- inscrição, e o que vale é o último emitido.
  select coalesce(jsonb_agg(t order by t->>'event_starts_at'), '[]'::jsonb)
    into v_tickets
    from (
      select distinct on (r.id) jsonb_build_object(
               'token',           tk.code || '.' || tk.signature,
               'ticket_code',     tk.code,
               'number',          r.number,
               'event_name',      e.name,
               'event_slug',      e.slug,
               'event_starts_at', e.starts_at,
               'venue',           e.venue_name,
               'city',            e.city,
               'state',           e.state
             ) as t
        from public.registrations r
        join public.events  e  on e.id = r.event_id
        join public.tickets tk on tk.registration_id = r.id
       where r.attendee_id = v_attendee.id
         and r.status = 'confirmada'
         and tk.status = 'valido'
         and e.starts_at > now()
       order by r.id, tk.issued_at desc
    ) escolhidos;

  return jsonb_build_object('ok', true, 'tickets', v_tickets);
end;
$$;

grant execute on function public.request_ticket_code(text, jsonb) to anon, authenticated;
grant execute on function public.verify_ticket_code(text, text)  to anon, authenticated;

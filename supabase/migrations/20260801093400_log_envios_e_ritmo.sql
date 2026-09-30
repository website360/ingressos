-- =============================================================================
-- 20260801093400_log_envios_e_ritmo
--
-- Três coisas que andam juntas:
--
-- 1. O log passa a registrar TODA tentativa, não só o sucesso. Hoje
--    `email_messages` e `whatsapp_messages` só ganham linha quando o envio dá
--    certo — o que falhou não aparece em lugar nenhum, e é justamente o que
--    alguém precisa ver.
--
-- 2. Reenvio: uma RPC que recoloca jobs escolhidos na fila.
--
-- 3. Ritmo: o WhatsApp deixa de sair em rajada. O espaçamento é gravado no
--    `run_at` de cada job — a fila já tem esse campo, e usá-lo significa que o
--    agendamento sobrevive a reinício, é inspecionável ("a próxima sai às
--    14:32") e não exige processo novo nem `sleep` em lugar nenhum do banco.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuração de ritmo — mora no número, que é de quem é o risco
-- -----------------------------------------------------------------------------
alter table public.whatsapp_connections
  add column send_interval_seconds int not null default 20
    check (send_interval_seconds between 5 and 3600),
  add column daily_send_limit int not null default 300
    check (daily_send_limit between 1 and 100000);

-- Não são segredo: aparecem e são editáveis na tela.
grant select (send_interval_seconds, daily_send_limit),
      insert (send_interval_seconds, daily_send_limit),
      update (send_interval_seconds, daily_send_limit)
  on public.whatsapp_connections to authenticated;

-- -----------------------------------------------------------------------------
-- Ligação entre o job e a linha de log
--
-- Sem isto não há como o log mostrar o que falhou (a linha nasce do job, não do
-- envio) nem como o reenvio saber qual job recolocar na fila.
-- -----------------------------------------------------------------------------
alter table public.email_messages
  add column job_id uuid references public.outbox_jobs (id) on delete set null;

alter table public.whatsapp_messages
  add column job_id uuid references public.outbox_jobs (id) on delete set null;

-- Uma linha de log por job: é o que permite o worker fazer upsert a cada
-- tentativa em vez de empilhar uma linha por retry.
create unique index uq_email_messages_job
  on public.email_messages (job_id) where job_id is not null;
create unique index uq_whatsapp_messages_job
  on public.whatsapp_messages (job_id) where job_id is not null;

create index ix_whatsapp_messages_dia
  on public.whatsapp_messages (tenant_id, sent_at) where status = 'enviado';

-- -----------------------------------------------------------------------------
-- O alocador de slots
--
-- Responde uma pergunta só: "que horas a próxima mensagem de WhatsApp pode
-- sair?". Respeita o intervalo entre mensagens e o teto diário; estourando o
-- teto, empurra para o primeiro horário do dia seguinte.
--
-- O dia é contado no fuso da empresa, não em UTC: teto diário que vira às 21h
-- não é teto diário.
-- -----------------------------------------------------------------------------
create or replace function private.next_whatsapp_slot(p_tenant uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_conn     public.whatsapp_connections%rowtype;
  v_interval interval;
  v_tz       text;
  v_last     timestamptz;
  v_slot     timestamptz;
  v_day      date;
  v_count    int;
  v_guard    int := 0;
begin
  select * into v_conn from public.whatsapp_connections where tenant_id = p_tenant;

  -- Sem integração configurada não há ritmo a respeitar: o job nem deveria
  -- existir, e segurá-lo aqui só esconderia o problema.
  if v_conn.tenant_id is null then
    return now();
  end if;

  v_interval := make_interval(secs => v_conn.send_interval_seconds);
  v_tz := coalesce((select timezone from public.tenants where id = p_tenant), 'America/Sao_Paulo');

  -- O último slot já reservado por um job que ainda vai sair.
  select max(run_at) into v_last
    from public.outbox_jobs
   where tenant_id = p_tenant
     and type like 'whatsapp.%'
     and status in ('pendente', 'processando');

  v_slot := greatest(now(), coalesce(v_last, now() - v_interval) + v_interval);

  -- Teto diário: o que já saiu hoje mais o que está agendado para o mesmo dia.
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 366;  -- fila maior que um ano de teto: para de procurar

    v_day := (v_slot at time zone v_tz)::date;

    select count(*) into v_count
      from public.outbox_jobs
     where tenant_id = p_tenant
       and type like 'whatsapp.%'
       and status in ('pendente', 'processando')
       and (run_at at time zone v_tz)::date = v_day;

    v_count := v_count + (
      select count(*)
        from public.whatsapp_messages
       where tenant_id = p_tenant
         and status = 'enviado'
         and sent_at is not null
         and (sent_at at time zone v_tz)::date = v_day
    );

    exit when v_count < v_conn.daily_send_limit;

    -- Estourou o dia: primeiro horário do dia seguinte, no fuso da empresa.
    v_slot := (((v_day + 1)::timestamp) at time zone v_tz);
  end loop;

  return v_slot;
end;
$$;

-- -----------------------------------------------------------------------------
-- O agendamento vale para TODO job de WhatsApp, venha de onde vier
--
-- Um gatilho em `outbox_jobs` em vez de espalhar a chamada por cada função que
-- enfileira: o gatilho de confirmação, o de cancelamento, o reenvio e qualquer
-- INSERT futuro passam pelo mesmo lugar. Quem quiser marcar horário específico
-- continua podendo — só o `run_at` no presente é reescrito.
-- -----------------------------------------------------------------------------
create or replace function private.schedule_whatsapp_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.type like 'whatsapp.%' and new.tenant_id is not null and new.run_at <= now() then
    new.run_at := private.next_whatsapp_slot(new.tenant_id);
  end if;
  return new;
end;
$$;

create trigger tg_outbox_schedule_whatsapp
  before insert on public.outbox_jobs
  for each row execute function private.schedule_whatsapp_job();

create index ix_outbox_whatsapp_fila
  on public.outbox_jobs (tenant_id, run_at)
  where status in ('pendente', 'processando');

-- -----------------------------------------------------------------------------
-- v_message_log — os dois canais numa lista só
--
-- `security_invoker`: a view herda a RLS das tabelas base, em vez de contorná-la.
-- Os LEFT JOIN em registrations/events seguem o mesmo padrão da
-- `v_registration_full` — quem não enxerga o evento vê a linha com o nome nulo,
-- não deixa de ver a linha.
-- -----------------------------------------------------------------------------
create view public.v_message_log with (security_invoker = true) as
select
  m.id,
  m.job_id,
  m.tenant_id,
  'email'::text                             as channel,
  m.to_email::text                          as recipient,
  m.template,
  m.status,
  m.attempts,
  m.last_error,
  m.sent_at,
  m.created_at,
  j.run_at                                  as scheduled_at,
  j.status::text                            as job_status,
  e.id                                      as event_id,
  e.name                                    as event_name
from public.email_messages m
left join public.outbox_jobs j on j.id = m.job_id
left join public.registrations r on r.id = nullif(m.payload ->> 'registration_id', '')::uuid
left join public.events e on e.id = r.event_id

union all

select
  m.id,
  m.job_id,
  m.tenant_id,
  'whatsapp'::text,
  m.to_phone,
  m.template,
  m.status,
  m.attempts,
  m.last_error,
  m.sent_at,
  m.created_at,
  j.run_at,
  j.status::text,
  e.id,
  e.name
from public.whatsapp_messages m
left join public.outbox_jobs j on j.id = m.job_id
left join public.registrations r on r.id = nullif(m.payload ->> 'registration_id', '')::uuid
left join public.events e on e.id = r.event_id;

grant select on public.v_message_log to authenticated;

-- -----------------------------------------------------------------------------
-- retry_messages — recoloca os jobs escolhidos na fila
--
-- `security definer` porque precisa escrever em `outbox_jobs`, que não tem
-- política de UPDATE para `authenticated` — a permissão é checada aqui, e o
-- filtro por empresa impede alcançar job de outra.
--
-- Job que já está na fila é ignorado em silêncio: reenviar o que ainda vai sair
-- só bagunçaria a ordem dos slots.
-- -----------------------------------------------------------------------------
create or replace function public.retry_messages(p_job_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant uuid;
  v_id     uuid;
  v_job    public.outbox_jobs%rowtype;
  v_count  int := 0;
begin
  v_tenant := private.current_tenant();

  if v_tenant is null then
    raise exception 'Empresa não identificada.' using errcode = 'IG004';
  end if;

  if not private.has_perm('settings.manage') then
    raise exception 'Você não tem permissão para reenviar mensagens.' using errcode = 'IG005';
  end if;

  foreach v_id in array coalesce(p_job_ids, '{}'::uuid[])
  loop
    select * into v_job
      from public.outbox_jobs
     where id = v_id and tenant_id = v_tenant
       for update;

    continue when v_job.id is null;
    continue when v_job.status in ('pendente', 'processando');

    update public.outbox_jobs
       set status     = 'pendente',
           attempts   = 0,
           locked_at  = null,
           locked_by  = null,
           last_error = null,
           run_at     = case
                          when v_job.type like 'whatsapp.%'
                            then private.next_whatsapp_slot(v_tenant)
                          else now()
                        end
     where id = v_id;

    update public.email_messages
       set status = 'fila', last_error = null
     where job_id = v_id;

    update public.whatsapp_messages
       set status = 'fila', last_error = null
     where job_id = v_id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('requeued', v_count);
end;
$$;

grant execute on function public.retry_messages(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- release_outbox_job — devolve à fila sem gastar tentativa
--
-- O worker respeita o intervalo dentro da própria rodada e tem orçamento de
-- tempo para não colidir com o tick seguinte do cron. O que sobrar da rodada
-- volta intacto: gastar uma das cinco tentativas por decisão de ritmo seria
-- punir o job por uma escolha nossa.
-- -----------------------------------------------------------------------------
create or replace function public.release_outbox_job(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.outbox_jobs
     set status    = 'pendente',
         locked_at = null,
         locked_by = null,
         attempts  = greatest(attempts - 1, 0)
   where id = p_id and status = 'processando';
end;
$$;

grant execute on function public.release_outbox_job(uuid) to service_role;

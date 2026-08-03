-- =============================================================================
-- 20260801090200_enums
-- Tipos enumerados do domínio (docs/03, seção 4).
-- Enums criados já na fundação para evitar migrations destrutivas depois:
-- adicionar valor a um enum é aditivo; criar o tipo tardiamente não é.
-- =============================================================================

create type public.event_status        as enum ('rascunho','publicado','privado','encerrado','cancelado');
create type public.registration_status as enum ('pendente','confirmada','cancelada','lista_espera','no_show');
create type public.ticket_status       as enum ('valido','utilizado','cancelado','expirado','reemitido');
create type public.checkin_result      as enum ('sucesso','duplicado','invalido','cancelado','fora_do_raio');
create type public.waitlist_status     as enum ('aguardando','convocado','convertido','expirado','desistiu');
create type public.user_role           as enum ('admin','organizador','recepcao','suporte');
create type public.membership_status   as enum ('convidado','ativo','suspenso');
create type public.tenant_status       as enum ('trial','ativo','suspenso','cancelado');
create type public.support_priority    as enum ('baixa','media','alta','critica');
create type public.support_status      as enum ('aberto','em_andamento','aguardando','resolvido','fechado');
create type public.job_status          as enum ('pendente','processando','concluido','falhou','descartado');
create type public.email_status        as enum ('fila','enviado','entregue','aberto','falhou','bounce');

create type audit.audit_action as enum (
  'create','update','delete','cancel','checkin','login','logout',
  'permission_change','export','access_sensitive'
);

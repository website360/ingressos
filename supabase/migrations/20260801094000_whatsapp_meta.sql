-- =============================================================================
-- 20260801094000_whatsapp_meta
-- API oficial do WhatsApp (Meta Cloud API) como segundo provedor.
--
-- A conexão continua sendo UMA por empresa: o provedor é um atributo dela, não
-- uma tabela nova. Assim o enfileiramento (que só cria job de WhatsApp quando
-- existe a linha), o ritmo de envio e o log seguem valendo sem mudança.
--
-- Na Meta, os campos de sempre ganham outro sentido:
--   base_url  → raiz da Graph API, com a versão (https://graph.facebook.com/v21.0)
--   api_key   → token de acesso permanente (usuário do sistema)
--   phone_number → número exibido, lido da própria Meta
-- e entram os específicos: o id do número, o id da conta (WABA), o segredo do
-- app — que assina o webhook — e o token de verificação do webhook.
--
-- Mesma regra das outras credenciais: `meta_app_secret` é gravável, não legível
-- por `authenticated`. O token de verificação NÃO é segredo de verdade (ele é
-- digitado no painel da Meta e só serve para o aperto de mão inicial), então a
-- tela pode mostrá-lo para copiar.
-- =============================================================================

alter table public.whatsapp_connections
  add column provider text not null default 'evolution'
    check (provider in ('evolution', 'meta')),
  add column meta_phone_number_id text
    check (meta_phone_number_id is null or meta_phone_number_id ~ '^[0-9]{5,30}$'),
  add column meta_waba_id text
    check (meta_waba_id is null or meta_waba_id ~ '^[0-9]{5,30}$'),
  add column meta_app_secret text,
  add column meta_verify_token text,
  add column meta_templates jsonb not null default '{}'::jsonb;

-- O webhook da Meta identifica a empresa pelo id do número; a busca é por ele.
create unique index uq_whatsapp_meta_phone
  on public.whatsapp_connections (meta_phone_number_id)
  where meta_phone_number_id is not null;

grant select (provider, meta_phone_number_id, meta_waba_id, meta_verify_token, meta_templates)
  on public.whatsapp_connections to authenticated;

-- Sem GRANT de escrita para `authenticated` nestas colunas, de propósito.
-- Quem grava é só `saveMetaConnection`, pelo service role, DEPOIS de conferir
-- na Meta que o token da empresa enxerga aquele número. Se o painel pudesse
-- gravar `meta_phone_number_id` direto, uma empresa poderia "reservar" o id do
-- número de outra (o índice é único) e receber os eventos de webhook dela.

-- Índice para o webhook de status achar a mensagem pelo id que a Meta devolveu.
create index if not exists ix_whatsapp_messages_provider_id
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

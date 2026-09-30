-- =============================================================================
-- 20260801093200_whatsapp_webhook_secret
-- Segredo do webhook por conexão, em vez de variável de ambiente.
--
-- A URL do webhook fica gravada no servidor Evolution, que muitas vezes é de
-- terceiro. Um segredo por conexão limita o estrago: vaza o de uma empresa, não
-- o do sistema inteiro, e reconectar o número já gera outro. Também evita pedir
-- um passo de operação (setar env, redeploy) para algo que a tela resolve.
--
-- Mesma regra das outras credenciais: gravável, não legível por `authenticated`.
-- =============================================================================

alter table public.whatsapp_connections
  add column webhook_secret text;

grant insert (webhook_secret), update (webhook_secret)
  on public.whatsapp_connections to authenticated;

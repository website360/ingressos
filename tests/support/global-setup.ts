import pg from "pg";

import { assertLocalDatabaseUrl } from "./db";

/**
 * Iguala o banco LOCAL ao de produção num ponto em que a CLI do Supabase mudou:
 * o projeto de produção concede SELECT/INSERT/UPDATE/DELETE ao `service_role`
 * em toda tabela de `public` (privilégio padrão do projeto antigo); o banco
 * local criado pela CLI atual não concede. Sem isto, as rotas do Next (que
 * usam o service role pelo PostgREST) recebem "permission denied" só no teste.
 */
export default async function setup() {
  const client = new pg.Client({
    connectionString: assertLocalDatabaseUrl(process.env.TEST_DATABASE_URL),
  });
  await client.connect();
  try {
    await client.query(`
      grant select, insert, update, delete on all tables in schema public to service_role;
      grant usage, select on all sequences in schema public to service_role;
      notify pgrst, 'reload schema';
    `);
  } finally {
    await client.end();
  }
}

import { afterAll, describe, expect, it } from "vitest";

import { assertLocalDatabaseUrl, getTestPool } from "../support/db";
import { startMockMeta } from "../support/mock-meta";

describe("harness de integração", () => {
  afterAll(async () => {
    await getTestPool().end();
  });

  it("recusa banco que não é local", () => {
    expect(() =>
      assertLocalDatabaseUrl("postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:5432/postgres"),
    ).toThrow("TEST_DATABASE_URL precisa apontar para localhost");
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(
      "TEST_DATABASE_URL precisa apontar para localhost",
    );
  });

  it("aceita o banco local e consulta", async () => {
    const { rows } = await getTestPool().query("select 1 as one");
    expect(rows[0].one).toBe(1);
  });

  it("Meta simulada responde com wamid e registra a requisição", async () => {
    const meta = await startMockMeta();
    try {
      const response = await fetch(`${meta.url}/v23.0/123/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
        body: JSON.stringify({ to: "+5511987654321" }),
      });
      const body = (await response.json()) as { messages: { id: string }[] };
      expect(response.status).toBe(200);
      expect(body.messages[0].id).toMatch(/^wamid\./);
      expect(meta.requests).toHaveLength(1);
      expect(meta.requests[0].body).toEqual({ to: "+5511987654321" });
    } finally {
      await meta.close();
    }
  });
});

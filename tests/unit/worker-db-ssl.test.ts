import { describe, expect, it } from "vitest";

import { sslConfig } from "../../worker/whatsapp/db";

const silent = () => undefined;
const REMOTE = "postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:5432/postgres";

describe("TLS do worker com o banco", () => {
  it("banco local: sem TLS", () => {
    expect(sslConfig("postgresql://postgres:postgres@127.0.0.1:54322/postgres", {}, silent)).toBe(false);
    expect(sslConfig("postgresql://postgres:postgres@localhost:5432/postgres", {}, silent)).toBe(false);
  });

  it("host que só CONTÉM localhost não conta como local", () => {
    expect(() =>
      sslConfig("postgresql://u:p@localhost.evil.example:5432/db", { NODE_ENV: "production" }, silent),
    ).toThrow(/DATABASE_SSL_CA/);
  });

  it("produção sem CA e sem liberação explícita: recusa subir", () => {
    expect(() => sslConfig(REMOTE, { NODE_ENV: "production" }, silent)).toThrow(/DATABASE_SSL_CA/);
  });

  it("liberação explícita: cifra sem verificar, com aviso", () => {
    const warnings: string[] = [];
    const ssl = sslConfig(REMOTE, { NODE_ENV: "production", DATABASE_SSL_INSECURE: "1" }, (_l, msg) =>
      warnings.push(msg),
    );
    expect(ssl).toEqual({ rejectUnauthorized: false });
    expect(warnings).toHaveLength(1);
  });
});

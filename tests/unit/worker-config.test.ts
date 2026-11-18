import { describe, expect, it } from "vitest";

import { resolveMetaBaseUrl } from "../../worker/whatsapp/config";

describe("META_BASE_URL do worker", () => {
  it("vazio: segue META_GRAPH_VERSION (undefined = padrão)", () => {
    expect(resolveMetaBaseUrl(undefined)).toBeUndefined();
    expect(resolveMetaBaseUrl("")).toBeUndefined();
  });

  it("aceita simulador em loopback", () => {
    expect(resolveMetaBaseUrl("http://127.0.0.1:4010/v23.0")).toBe("http://127.0.0.1:4010/v23.0");
    expect(resolveMetaBaseUrl("http://localhost:4010/v23.0")).toBe("http://localhost:4010/v23.0");
  });

  it("aceita a Graph API oficial só por HTTPS", () => {
    expect(resolveMetaBaseUrl("https://graph.facebook.com/v24.0")).toBe("https://graph.facebook.com/v24.0");
    expect(() => resolveMetaBaseUrl("http://graph.facebook.com/v24.0")).toThrow(/META_BASE_URL/);
  });

  it("recusa qualquer outro destino (o token iria junto)", () => {
    expect(() => resolveMetaBaseUrl("https://evil.example/v23.0")).toThrow(/META_BASE_URL/);
    expect(() => resolveMetaBaseUrl("http://localhost.evil.example/v23.0")).toThrow(/META_BASE_URL/);
    expect(() => resolveMetaBaseUrl("nada")).toThrow(/META_BASE_URL/);
  });
});

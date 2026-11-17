import { describe, expect, it } from "vitest";

import { locateCities } from "@/lib/geo/city-locator";

const point = (name: string) => (r: ReturnType<typeof locateCities>) =>
  r.points.find((p) => p.name === name);

describe("localização das cidades digitadas", () => {
  it("acha a cidade sem acento e em caixa diferente", () => {
    const r = locateCities([{ city: "sao paulo", state: "SP", count: 3 }]);
    expect(point("São Paulo")(r)).toMatchObject({ uf: "SP", count: 3 });
    expect(r.unmatched).toBe(0);
  });

  it("usa o estado para desempatar cidades com o mesmo nome", () => {
    const r = locateCities([{ city: "Bom Jesus", state: "PI", count: 1 }]);
    expect(r.points[0]).toMatchObject({ name: "Bom Jesus", uf: "PI" });
  });

  it("aceita a UF grudada no nome e apelidos comuns", () => {
    const r = locateCities([
      { city: "Campinas - SP", state: "SP", count: 2 },
      { city: "BH", state: "MG", count: 4 },
      { city: "Floripa", state: "SC", count: 1 },
    ]);
    expect(point("Campinas")(r)?.count).toBe(2);
    expect(point("Belo Horizonte")(r)?.count).toBe(4);
    expect(point("Florianópolis")(r)?.count).toBe(1);
  });

  it("soma grafias diferentes da mesma cidade num ponto só", () => {
    const r = locateCities([
      { city: "Recife", state: "PE", count: 2 },
      { city: "recife ", state: "PE", count: 3 },
    ]);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.count).toBe(5);
  });

  it("sem estado, só aceita nome que existe em um estado apenas", () => {
    const r = locateCities([
      { city: "Florianópolis", state: null, count: 1 },
      { city: "Bom Jesus", state: null, count: 2 },
    ]);
    expect(point("Florianópolis")(r)).toBeDefined();
    expect(r.unmatched).toBe(2);
  });

  it("conta o que não reconhece em vez de descartar calado", () => {
    const r = locateCities([
      { city: "Cidade Inventada", state: "SP", count: 7 },
      { city: "", state: "SP", count: 1 },
    ]);
    expect(r.points).toHaveLength(0);
    expect(r.unmatched).toBe(8);
  });

  it("ordena do maior para o menor", () => {
    const r = locateCities([
      { city: "Recife", state: "PE", count: 1 },
      { city: "Salvador", state: "BA", count: 9 },
    ]);
    expect(r.points.map((p) => p.name)).toEqual(["Salvador", "Recife"]);
  });
});

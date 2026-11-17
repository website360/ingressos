import municipios from "@shared/data/municipios.json";

import { deaccent } from "@/lib/utils";

/**
 * Coloca no mapa as cidades que os participantes digitaram.
 *
 * A base é a lista de municípios do IBGE com coordenadas
 * (shared/data/municipios.json — [nome, UF, latitude, longitude], gerada do
 * conjunto público kelvins/municipios-brasileiros). O nome digitado é comparado
 * sem acento, sem caixa e sem pontuação; a UF desempata homônimos.
 */
type Municipio = [name: string, uf: string, lat: number, lng: number];

export interface CityCount {
  city: string | null;
  state: string | null;
  count: number;
}

export interface CityPoint {
  name: string;
  uf: string;
  lat: number;
  lng: number;
  count: number;
}

const normalize = (value: string) =>
  deaccent(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Apelidos que aparecem de verdade em formulário — sempre presos à UF. */
const ALIASES: Record<string, string> = {
  "bh|MG": "belo horizonte",
  "sp|SP": "sao paulo",
  "sampa|SP": "sao paulo",
  "rj|RJ": "rio de janeiro",
  "rio|RJ": "rio de janeiro",
  "bsb|DF": "brasilia",
  "poa|RS": "porto alegre",
  "floripa|SC": "florianopolis",
  "cg|MS": "campo grande",
  "jp|PB": "joao pessoa",
};

let index: { byNameUf: Map<string, Municipio>; byName: Map<string, Municipio[]> } | null = null;

function getIndex() {
  if (index) return index;
  const byNameUf = new Map<string, Municipio>();
  const byName = new Map<string, Municipio[]>();
  for (const m of municipios as Municipio[]) {
    const key = normalize(m[0]);
    byNameUf.set(`${key}|${m[1]}`, m);
    byName.set(key, [...(byName.get(key) ?? []), m]);
  }
  index = { byNameUf, byName };
  return index;
}

function find(city: string | null, state: string | null): Municipio | null {
  if (!city) return null;
  const uf = state?.trim().toUpperCase() || null;
  let name = normalize(city);
  if (!name) return null;

  const { byNameUf, byName } = getIndex();

  if (uf) {
    // "Campinas - SP", "Campinas/SP", "Campinas SP"
    const suffix = ` ${uf.toLowerCase()}`;
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim();
    name = ALIASES[`${name}|${uf}`] ?? name;
    return byNameUf.get(`${name}|${uf}`) ?? null;
  }

  // Sem UF, só vale nome que não se repete em outro estado.
  const candidates = byName.get(name) ?? [];
  return candidates.length === 1 ? candidates[0]! : null;
}

export function locateCities(rows: CityCount[]): { points: CityPoint[]; unmatched: number } {
  const points = new Map<string, CityPoint>();
  let unmatched = 0;

  for (const row of rows) {
    const found = find(row.city, row.state);
    if (!found) {
      unmatched += row.count;
      continue;
    }
    const [name, uf, lat, lng] = found;
    const key = `${name}|${uf}`;
    const current = points.get(key);
    if (current) current.count += row.count;
    else points.set(key, { name, uf, lat, lng, count: row.count });
  }

  return {
    points: [...points.values()].sort((a, b) => b.count - a.count),
    unmatched,
  };
}

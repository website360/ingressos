"use client";

import * as React from "react";

import "leaflet/dist/leaflet.css";
import type { LatLngBoundsExpression } from "leaflet";
import { useTheme } from "next-themes";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";

import type { CityPoint } from "@/lib/geo/city-locator";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Brasil inteiro — enquadramento quando não há pontos. */
const BRAZIL: LatLngBoundsExpression = [
  [-33.75, -73.99],
  [5.27, -34.79],
];

/** Raio proporcional à raiz: área do círculo ~ quantidade de inscritos. */
function radius(count: number, max: number) {
  const MIN = 5;
  const MAX = 26;
  return MIN + (MAX - MIN) * Math.sqrt(count / Math.max(max, 1));
}

/**
 * O mapa nasce dentro de um carregamento dinâmico, antes de o cartão ter o
 * tamanho final — o enquadramento inicial sai errado. Recalcula o tamanho e
 * reenquadra quando o contêiner muda.
 */
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  React.useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, bounds]);
  return null;
}

export function RegistrationsMapClient({ points }: { points: CityPoint[] }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const max = points[0]?.count ?? 1;

  // Enquadra os pontos com folga; um ponto só não pode virar zoom de rua.
  const bounds = React.useMemo<LatLngBoundsExpression>(
    () =>
      points.length > 1
        ? (points.map((p) => [p.lat, p.lng]) as [number, number][])
        : points.length === 1
          ? [
              [points[0]!.lat - 3, points[0]!.lng - 3],
              [points[0]!.lat + 3, points[0]!.lng + 3],
            ]
          : BRAZIL,
    [points],
  );

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [28, 28], maxZoom: 7 }}
      scrollWheelZoom={false}
      // Tema escuro: o OpenStreetMap não tem versão escura; o filtro inverte as
      // cores só dos blocos do mapa (os círculos ficam fora dele).
      className={cn(
        "h-full w-full rounded-lg",
        dark &&
          "[&_.leaflet-tile-pane]:[filter:invert(1)_hue-rotate(180deg)_brightness(0.9)_contrast(0.9)]",
      )}
      style={{ background: "hsl(var(--muted))" }}
    >
      <FitBounds bounds={bounds} />
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={12}
      />
      {/* Maiores por baixo: o círculo pequeno nunca fica escondido. */}
      {points.map((p) => (
        <CircleMarker
          key={`${p.name}|${p.uf}`}
          center={[p.lat, p.lng]}
          radius={radius(p.count, max)}
          pathOptions={{
            color: "hsl(221 83% 53%)",
            weight: 1.5,
            fillColor: "hsl(221 83% 53%)",
            fillOpacity: 0.35,
          }}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            <strong>
              {p.name}/{p.uf}
            </strong>
            <br />
            {formatNumber(p.count)} {p.count === 1 ? "inscrição" : "inscrições"}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

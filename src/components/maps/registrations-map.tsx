"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { CityPoint } from "@/lib/geo/city-locator";

/**
 * O Leaflet mexe em `window` ao ser importado — só pode carregar no navegador.
 */
const RegistrationsMapClient = dynamic(
  () => import("./registrations-map-client").then((m) => m.RegistrationsMapClient),
  { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-lg" /> },
);

export function RegistrationsMap({ points }: { points: CityPoint[] }) {
  return <RegistrationsMapClient points={points} />;
}

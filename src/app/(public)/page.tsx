import type { Metadata } from "next";

import { EventBrowser } from "@/components/public/event-browser";
import { publicRepository } from "@/repositories/public.repository";

export const metadata: Metadata = {
  title: "Eventos",
  description: "Próximos eventos com inscrições abertas e o histórico de edições anteriores.",
};

export const revalidate = 300;

export default async function HomePage() {
  const [upcoming, past] = await Promise.all([
    publicRepository.listPublishedEvents(24),
    publicRepository.listPastEvents(12),
  ]);

  // A página busca; a barra filtra. O destaque é o primeiro item do que sobrou
  // do filtro — e ele continua na grade abaixo, em primeiro lugar.
  return <EventBrowser upcoming={upcoming} past={past} />;
}

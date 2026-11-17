import { redirect } from "next/navigation";

import { ROUTES } from "@/constants/routes";

/**
 * A criação virou um assistente em modal na lista de eventos. Esta rota fica
 * só para não quebrar links e favoritos antigos.
 */
export default function NewEventPage() {
  redirect(`${ROUTES.admin.events}?novo=1`);
}

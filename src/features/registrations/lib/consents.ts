import type { RegistrationInput } from "@shared/schemas/registration";
import { WHATSAPP_CONSENT_VERSION } from "@shared/whatsapp/consent";

export interface ConsentEntry {
  type: "lgpd" | "regulamento" | "whatsapp";
  version: number;
  accepted: boolean;
  subject?: string;
}

/**
 * Consentimentos enviados à `create_registration`.
 *
 * O de WhatsApp só entra quando a caixa foi OFERECIDA: sem WhatsApp ligado,
 * gravar "recusou" seria registrar uma escolha que a pessoa não fez. Quem
 * decide se foi oferecida é o SERVIDOR (`whatsappOffered`), não o que veio do
 * navegador — um envio forjado com `accept_whatsapp: true` e o canal
 * desligado é descartado. Oferecida, grava marcada ou não (a recusa também é
 * registro) e leva o telefone a que o aceite se refere.
 */
export function registrationConsents(
  data: RegistrationInput,
  opts: { whatsappOffered?: boolean } = {},
): ConsentEntry[] {
  const consents: ConsentEntry[] = [
    { type: "lgpd", version: 1, accepted: data.accept_lgpd },
    { type: "regulamento", version: 1, accepted: data.accept_rules },
  ];
  const offered = opts.whatsappOffered ?? data.accept_whatsapp !== undefined;
  if (offered) {
    consents.push({
      type: "whatsapp",
      version: WHATSAPP_CONSENT_VERSION,
      accepted: data.accept_whatsapp === true,
      subject: data.phone,
    });
  }
  return consents;
}

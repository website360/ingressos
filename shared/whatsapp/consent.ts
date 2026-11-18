/**
 * Aceite para receber a confirmação pelo WhatsApp (opt-in explícito).
 *
 * O texto é versionado: o consentimento gravado aponta para a versão que a
 * pessoa leu. Mudou uma palavra, sobe a versão — é a prova de "a pessoa
 * concordou com ISTO" que a Meta e a LGPD pedem.
 */
export const WHATSAPP_CONSENT_VERSION = 1;

export const WHATSAPP_CONSENT_TEXT =
  "Quero receber a confirmação e o ingresso pelo WhatsApp neste número.";

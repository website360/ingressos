import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { TicketView } from "@/repositories/public.repository";

/**
 * Ingresso em PDF.
 *
 * Sem fonte externa: o PDF é gerado no servidor e baixar Nunito Sans a cada
 * requisição adicionaria latência e um ponto de falha de rede. Helvetica é
 * embutida no formato e imprime igual em qualquer leitor. As cores seguem o
 * Design System.
 */
const COLORS = {
  primary: "#2563eb",
  foreground: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  surface: "#f8fafc",
  destructive: "#dc2626",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: COLORS.foreground },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: COLORS.primary },
  brandSub: { fontSize: 8, color: COLORS.muted, marginTop: 2 },

  banner: { width: "100%", height: 110, objectFit: "cover", borderRadius: 6, marginBottom: 18 },

  eventName: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  eventMeta: { fontSize: 10, color: COLORS.muted, marginBottom: 18 },

  body: { flexDirection: "row", gap: 20 },
  info: { flex: 1, gap: 12 },
  qrBox: {
    width: 170,
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  qr: { width: 140, height: 140 },
  code: { marginTop: 8, fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 1.5 },

  label: { fontSize: 7, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  value: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  valueSmall: { fontSize: 10, marginTop: 2 },

  cancelled: {
    marginTop: 12,
    padding: 8,
    borderRadius: 6,
    backgroundColor: "#fef2f2",
    color: COLORS.destructive,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },

  rules: {
    marginTop: 22,
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  rulesTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  rule: { fontSize: 8, color: COLORS.muted, marginBottom: 3 },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    fontSize: 7,
    color: COLORS.muted,
    textAlign: "center",
  },
});

interface Props {
  ticket: TicketView;
  qrDataUrl: string;
  companyName: string;
  logoUrl?: string | null;
}

function formatDateTimePt(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function TicketDocument({ ticket, qrDataUrl, companyName, logoUrl }: Props) {
  const cancelled =
    ticket.ticket.status === "cancelado" || ticket.registration.status === "cancelada";

  const location = [
    ticket.event.venue_name,
    ticket.event.address,
    ticket.event.city,
    ticket.event.state,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Document
      title={`Ingresso ${ticket.ticket.code}`}
      author={companyName}
      subject={ticket.event.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{companyName}</Text>
            <Text style={styles.brandSub}>Ingresso eletrônico</Text>
          </View>
          {logoUrl ? <Image src={logoUrl} style={{ height: 28 }} /> : null}
        </View>

        {ticket.event.banner_url ? (
          <Image src={ticket.event.banner_url} style={styles.banner} />
        ) : null}

        <Text style={styles.eventName}>{ticket.event.name}</Text>
        <Text style={styles.eventMeta}>
          {formatDateTimePt(ticket.event.starts_at, ticket.event.timezone)}
        </Text>

        <View style={styles.body}>
          <View style={styles.info}>
            <View>
              <Text style={styles.label}>Participante</Text>
              <Text style={styles.value}>{ticket.attendee.name}</Text>
            </View>

            <View>
              <Text style={styles.label}>Número da inscrição</Text>
              <Text style={styles.value}>{ticket.registration.number}</Text>
            </View>

            <View>
              <Text style={styles.label}>Local</Text>
              <Text style={styles.valueSmall}>{location || "A confirmar"}</Text>
            </View>

            <View>
              <Text style={styles.label}>Horário</Text>
              <Text style={styles.valueSmall}>
                {formatDateTimePt(ticket.event.starts_at, ticket.event.timezone)}
                {"\n"}até {formatDateTimePt(ticket.event.ends_at, ticket.event.timezone)}
              </Text>
            </View>

            {cancelled ? (
              <Text style={styles.cancelled}>INGRESSO CANCELADO — NÃO PERMITE ENTRADA</Text>
            ) : null}
          </View>

          <View style={styles.qrBox}>
            <Image src={qrDataUrl} style={styles.qr} />
            <Text style={styles.code}>{ticket.ticket.code}</Text>
          </View>
        </View>

        <View style={styles.rules}>
          <Text style={styles.rulesTitle}>Regras de acesso</Text>
          <Text style={styles.rule}>
            1. Apresente este QR Code na entrada. Não é necessário imprimir — a tela do celular é
            suficiente.
          </Text>
          <Text style={styles.rule}>
            2. O ingresso é pessoal e intransferível, e permite uma única entrada.
          </Text>
          <Text style={styles.rule}>
            3. Pode ser solicitado documento oficial com foto para conferência.
          </Text>
          <Text style={styles.rule}>
            4. Em caso de desistência, cancele pela página do ingresso para liberar sua vaga a outra
            pessoa.
          </Text>
        </View>

        <Text style={styles.footer}>
          Documento gerado eletronicamente por {companyName} · Ingresso {ticket.ticket.code} ·
          Inscrição {ticket.registration.number}
        </Text>
      </Page>
    </Document>
  );
}

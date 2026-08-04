import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { DadosRelatorio } from "@/features/reports/report-data";

/**
 * Relatório consolidado em PDF.
 *
 * Sem fonte externa, pelo mesmo motivo do ingresso: o documento é gerado no
 * servidor e baixar uma fonte a cada requisição adicionaria latência e um ponto
 * de falha de rede. Helvetica é embutida no formato e imprime igual em qualquer
 * leitor. As cores seguem o Design System.
 */
const COLORS = {
  primary: "#2563eb",
  foreground: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  surface: "#f8fafc",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: COLORS.foreground },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: COLORS.muted, marginTop: 3 },
  emitido: { fontSize: 8, color: COLORS.muted },

  cards: { flexDirection: "row", gap: 8, marginBottom: 20 },
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 8,
  },
  cardLabel: { fontSize: 7, color: COLORS.muted, textTransform: "uppercase" },
  cardValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 3 },

  section: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6 },

  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  head: { backgroundColor: COLORS.surface },
  cell: { paddingVertical: 5, paddingHorizontal: 6 },
  cellHead: { fontFamily: "Helvetica-Bold", fontSize: 8, color: COLORS.muted },
  right: { textAlign: "right" },

  vazio: { padding: 10, fontSize: 8, color: COLORS.muted, textAlign: "center" },

  rodape: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: COLORS.muted,
  },
});

const pct = (valor: number | null) =>
  valor != null ? `${valor.toFixed(1).replace(".", ",")}%` : "—";
const num = (valor: number) => valor.toLocaleString("pt-BR");

interface Props {
  dados: DadosRelatorio;
  empresa: string;
  emitidoEm: string;
}

export function ReportDocument({ dados, empresa, emitidoEm }: Props) {
  const { resumo, eventos, estados } = dados;

  return (
    <Document title="Relatório de eventos" author={empresa}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Relatório de eventos</Text>
            <Text style={styles.subtitle}>
              {empresa} · {dados.periodo}
            </Text>
          </View>
          <Text style={styles.emitido}>Emitido em {emitidoEm}</Text>
        </View>

        <View style={styles.cards}>
          {[
            ["Inscritos", num(resumo.inscritos)],
            ["Presentes", num(resumo.presentes)],
            ["Ausentes", num(resumo.ausentes)],
            ["Cancelados", num(resumo.cancelados)],
            ["Comparecimento", pct(resumo.comparecimento)],
          ].map(([rotulo, valor]) => (
            <View key={rotulo} style={styles.card}>
              <Text style={styles.cardLabel}>{rotulo}</Text>
              <Text style={styles.cardValue}>{valor}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Desempenho por evento</Text>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.cell, styles.cellHead, { flex: 3 }]}>Evento</Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1 }]}>Inscritos</Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1 }]}>Presentes</Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1 }]}>Ocupação</Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1.2 }]}>
            Comparecimento
          </Text>
        </View>
        {eventos.length === 0 ? (
          <Text style={styles.vazio}>Nenhum evento no período selecionado.</Text>
        ) : (
          eventos.map((evento) => (
            <View key={evento.id} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { flex: 3 }]}>{evento.nome}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>{num(evento.inscritos)}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>{num(evento.presentes)}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>{pct(evento.ocupacao)}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1.2 }]}>
                {pct(evento.comparecimento)}
              </Text>
            </View>
          ))
        )}

        <Text style={[styles.section, { marginTop: 20 }]}>Participantes por estado</Text>
        <Text style={[styles.subtitle, { marginBottom: 6 }]}>
          Recorte apenas por período — filtro por situação ou nome não se aplica a esta tabela.
        </Text>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.cell, styles.cellHead, { flex: 2 }]}>Estado</Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1 }]}>
            Participantes
          </Text>
          <Text style={[styles.cell, styles.cellHead, styles.right, { flex: 1 }]}>
            Participação
          </Text>
        </View>
        {estados.length === 0 ? (
          <Text style={styles.vazio}>Sem dados de localização.</Text>
        ) : (
          estados.map((linha) => (
            <View key={linha.estado} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { flex: 2 }]}>{linha.estado}</Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>
                {num(linha.participantes)}
              </Text>
              <Text style={[styles.cell, styles.right, { flex: 1 }]}>
                {pct(linha.participacao)}
              </Text>
            </View>
          ))
        )}

        {/* `fixed` repete o rodapé em todas as páginas, e a numeração é
            resolvida pelo renderizador — sem isso, um relatório de 40 eventos
            sai com páginas soltas e sem identificação. */}
        <View style={styles.rodape} fixed>
          <Text>
            {empresa} · {dados.periodo}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

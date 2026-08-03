"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";

/**
 * Gráficos do dashboard.
 *
 * Todos são de SÉRIE ÚNICA: cada um responde a uma pergunta só (evolução,
 * magnitude). Consequências, seguindo a diretriz de visualização:
 *   · um único hue — o primário do Design System — em vez de paleta categórica;
 *   · sem legenda: o título já nomeia a série;
 *   · sem eixo secundário: medidas de escalas diferentes viram gráficos diferentes;
 *   · grade e eixos recessivos, marcas finas (linha 2px), tooltip sempre presente.
 *
 * As cores vêm de `hsl(var(--token))`, então o tema escuro é acompanhado sem
 * duplicar configuração.
 */

const AXIS = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueLabel,
}: {
  active?: boolean;
  payload?: { value: number; payload: Record<string, unknown> }[];
  label?: string;
  labelFormatter?: (value: string) => string;
  valueLabel: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">
        {labelFormatter && label ? labelFormatter(label) : label}
      </p>
      <p className="tabular text-muted-foreground">
        {formatNumber(payload[0]!.value)} {valueLabel}
      </p>
    </div>
  );
}

/** Evolução das inscrições — mudança ao longo do tempo pede área/linha. */
export function RegistrationsByDayChart({ data }: { data: { day: string; total: number }[] }) {
  const formatDay = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };

  if (data.length === 0) {
    return <EmptyChart message="Sem inscrições no período." />;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="fillRegistrations" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="day" tickFormatter={formatDay} {...AXIS} />
        <YAxis allowDecimals={false} width={44} {...AXIS} />
        <Tooltip
          content={<ChartTooltip valueLabel="inscrições" labelFormatter={formatDay} />}
          cursor={{ stroke: "hsl(var(--border))" }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#fillRegistrations)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Comparação de magnitude entre poucos itens nomeados: barra horizontal. */
export function TopEventsChart({ data }: { data: { name: string; seats_taken: number }[] }) {
  if (data.length === 0) return <EmptyChart message="Nenhum evento com inscrições." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * 44, 140)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tickFormatter={(value: string) => (value.length > 22 ? `${value.slice(0, 21)}…` : value)}
          {...AXIS}
        />
        <Tooltip
          content={<ChartTooltip valueLabel="inscritos" />}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        {/* Cantos arredondados apenas na ponta do dado, ancorados na linha de base. */}
        <Bar dataKey="seats_taken" radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((entry) => (
            <Cell key={entry.name} fill="hsl(var(--primary))" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ByStateChart({ data }: { data: { state: string; total: number }[] }) {
  if (data.length === 0) return <EmptyChart message="Sem dados de localização." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * 32, 140)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="state" width={40} {...AXIS} />
        <Tooltip
          content={<ChartTooltip valueLabel="participantes" />}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={14} fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

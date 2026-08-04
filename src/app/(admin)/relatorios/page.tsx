import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, MapPin, TrendingUp, UserCheck, UserX, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROUTES } from "@/constants/routes";
import { ReportFilters } from "@/features/reports/components/report-filters";
import { montarRelatorio } from "@/features/reports/report-data";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Relatórios" };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: Props) {
  await requirePermission(PERMISSIONS.REPORT_READ);

  const params = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([chave, valor]) =>
      typeof valor === "string" ? [[chave, valor] as [string, string]] : [],
    ),
  );

  // A mesma função que alimenta o PDF e o Excel: os três recortes saem sempre
  // da mesma consulta, e o arquivo baixado bate com o que está na tela.
  const dados = await montarRelatorio(params);

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`Números consolidados · ${dados.periodo}. Use a lista de participantes para recortes específicos.`}
      />

      {/* useSearchParams exige um boundary de Suspense no App Router. */}
      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full" />}>
        <ReportFilters />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Inscritos" value={dados.resumo.inscritos} icon={Users} />
        <StatCard
          label="Presentes"
          value={dados.resumo.presentes}
          icon={UserCheck}
          tone="success"
        />
        <StatCard label="Ausentes" value={dados.resumo.ausentes} icon={UserX} tone="warning" />
        <StatCard
          label="Cancelados"
          value={dados.resumo.cancelados}
          icon={UserX}
          tone="destructive"
        />
        <StatCard
          label="Taxa de comparecimento"
          value={
            dados.resumo.comparecimento != null ? formatPercent(dados.resumo.comparecimento) : "—"
          }
          icon={TrendingUp}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4" /> Desempenho por evento
            </CardTitle>
            <CardDescription>Ocupação e comparecimento de cada evento.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Evento</TableHead>
                  <TableHead className="text-right">Inscritos</TableHead>
                  <TableHead className="text-right">Presentes</TableHead>
                  <TableHead className="text-right">Ocupação</TableHead>
                  <TableHead className="text-right">Comparecimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.eventos.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhum evento para estes filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  dados.eventos.map((evento) => (
                    <TableRow key={evento.id}>
                      <TableCell className="max-w-56">
                        <Link
                          href={ROUTES.admin.event(evento.id)}
                          className="truncate text-sm font-medium hover:text-primary hover:underline"
                        >
                          {evento.nome}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(evento.inscritos)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(evento.presentes)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {evento.ocupacao != null ? formatPercent(evento.ocupacao) : "—"}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {evento.comparecimento != null ? formatPercent(evento.comparecimento) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4" /> Participantes por estado
            </CardTitle>
            <CardDescription>
              Base para decidir onde realizar o próximo evento. Responde apenas ao período — filtro
              por situação ou nome não se aplica aqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Participantes</TableHead>
                  <TableHead className="text-right">Participação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.estados.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Sem dados de localização.
                    </TableCell>
                  </TableRow>
                ) : (
                  dados.estados.map((linha) => (
                    <TableRow key={linha.estado}>
                      <TableCell className="text-sm font-medium">{linha.estado}</TableCell>
                      <TableCell className="tabular text-right text-sm">
                        {formatNumber(linha.participantes)}
                      </TableCell>
                      <TableCell className="tabular text-right text-sm text-muted-foreground">
                        {formatPercent(linha.participacao)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

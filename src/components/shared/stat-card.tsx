import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string | null;
  icon: LucideIcon;
  /** Variação percentual em relação ao período anterior. */
  trend?: number | null;
  hint?: string;
  loading?: boolean;
  tone?: "default" | "success" | "warning" | "destructive";
  className?: string;
}

const TONE_CLASSES = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
} as const;

/** KPI do dashboard. Números em fonte mono tabular (Design System, seção 7). */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  hint,
  loading,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("hover:shadow-md", className)}>
      <CardContent className="flex items-start gap-4 p-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            TONE_CLASSES[tone],
          )}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>

          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="tabular text-2xl font-semibold leading-tight">
              {typeof value === "number" ? formatNumber(value) : (value ?? "—")}
            </p>
          )}

          {(trend !== undefined && trend !== null) || hint ? (
            <div className="flex items-center gap-1.5 text-xs">
              {trend !== undefined && trend !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    trend >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {trend >= 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {Math.abs(trend).toFixed(1)}%
                </span>
              )}
              {hint && <span className="truncate text-muted-foreground">{hint}</span>}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

import { Badge } from "@/components/ui/badge";
import { statusMeta, type StatusMeta } from "@/config/status-maps";

interface StatusBadgeProps {
  map: Record<string, StatusMeta>;
  value: string | null | undefined;
  className?: string;
}

/** Único componente que traduz status em cor e rótulo na interface inteira. */
export function StatusBadge({ map, value, className }: StatusBadgeProps) {
  const meta = statusMeta(map, value);
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

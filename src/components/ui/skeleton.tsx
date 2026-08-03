import { cn } from "@/lib/utils";

/** Skeleton com o shimmer do Design System (seção 5). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shimmer rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };

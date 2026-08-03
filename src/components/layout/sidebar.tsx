"use client";

import * as React from "react";

import { ChevronLeft, Ticket } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAVIGATION } from "@/config/navigation";
import { ROUTES } from "@/constants/routes";
import { useSession } from "@/providers/session-provider";
import { cn } from "@/lib/utils";

const COLLAPSE_STORAGE_KEY = "ingressos:sidebar-collapsed";

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { canAny } = useSession();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

  function toggle() {
    setCollapsed((value) => {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(!value));
      return !value;
    });
  }

  // Grupos sem nenhum item permitido simplesmente não existem para o usuário.
  const groups = React.useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => canAny(item.permissions)),
      })).filter((group) => group.items.length > 0),
    [canAny],
  );

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[4.5rem]" : "w-64",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <Link href={ROUTES.admin.dashboard} className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Ticket className="size-4" />
          </span>
          {!collapsed && <span className="truncate font-semibold tracking-tight">Ingressos</span>}
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                const link = (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      "hover:bg-sidebar-accent hover:text-accent-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-sidebar-accent text-accent-foreground"
                        : "text-muted-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );

                if (!collapsed) return link;

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors",
            "hover:bg-sidebar-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          {!collapsed && <span>Recolher</span>}
        </button>
      </div>
    </aside>
  );
}

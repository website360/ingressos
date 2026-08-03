"use client";

import { Menu, Search } from "lucide-react";

import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/providers/session-provider";

export function Topbar() {
  const { activeTenant } = useSession();

  return (
    // .glass do Design System (seção 5) — header flutuante com blur.
    <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 sm:px-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <Sidebar className="w-full border-r-0" />
        </SheetContent>
      </Sheet>

      {activeTenant && (
        <>
          <span className="flex items-center gap-2 text-sm font-medium">
            {activeTenant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeTenant.logo_url} alt="" className="size-6 rounded" />
            ) : (
              <span
                className="flex size-6 items-center justify-center rounded text-[0.6rem] font-semibold text-white"
                style={{ backgroundColor: activeTenant.brand_color ?? "#2563eb" }}
                aria-hidden
              >
                {activeTenant.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="max-w-48 truncate">{activeTenant.name}</span>
          </span>
          <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
        </>
      )}

      <button
        type="button"
        onClick={() =>
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
          )
        }
        className="hidden h-8 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-primary/30 sm:flex sm:max-w-xs"
      >
        <Search className="size-4" />
        <span>Buscar...</span>
        <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[0.65rem]">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

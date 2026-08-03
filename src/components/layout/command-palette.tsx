"use client";

import * as React from "react";

import { Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAVIGATION } from "@/config/navigation";
import { useSession } from "@/providers/session-provider";

/** Paleta de comandos (Ctrl/⌘ + K) — navegação rápida respeitando permissões. */
export function CommandPalette() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { canAny } = useSession();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = React.useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => canAny(item.permissions)),
      })).filter((group) => group.items.length > 0),
    [canAny],
  );

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar páginas e ações..." />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.href}
                value={`${group.label} ${item.label}`}
                onSelect={() => run(() => router.push(item.href))}
              >
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />

        <CommandGroup heading="Preferências">
          <CommandItem value="tema claro" onSelect={() => run(() => setTheme("light"))}>
            <Sun /> Tema claro
          </CommandItem>
          <CommandItem value="tema escuro" onSelect={() => run(() => setTheme("dark"))}>
            <Moon /> Tema escuro
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

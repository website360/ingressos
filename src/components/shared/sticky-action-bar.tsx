"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Barra de ações presa ao pé da tela, para formulários longos: salvar sem
 * rolar até o fim.
 *
 * Fica no fim do formulário com `position: sticky` — rolando até lá, ela
 * simplesmente assenta no lugar dos botões. Antes do primeiro scroll fica
 * escondida (quem acabou de abrir a tela ainda não editou nada); se a página
 * nem tem rolagem, aparece direto, porque aí ela já está no lugar natural.
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const scroller = ref.current?.closest("main");
    if (!scroller) {
      setVisible(true);
      return;
    }

    const update = () =>
      setVisible(scroller.scrollTop > 0 || scroller.scrollHeight <= scroller.clientHeight);

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        // -mx/-mb compensam o padding do <main> para a barra ir de borda a borda.
        "sticky bottom-0 z-20 -mx-4 -mb-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:-mb-6 sm:px-6",
        "transition-[opacity,transform] duration-200",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {children}
      </div>
    </div>
  );
}

# Guia de Design — Corretora SaaS (para replicar o visual idêntico)

> Cole este documento inteiro no outro sistema (Cloud/IA). Ele contém **stack, fontes, cores, tokens, sombras, animações e padrões de componentes** para reproduzir o visual exatamente igual.

---

## 1. Stack de UI (bibliotecas)

| Categoria            | Biblioteca                                                                                                                          | Versão |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Framework            | **Next.js** (App Router)                                                                                                            | 15.1.3 |
| React                | react / react-dom                                                                                                                   | 19.0   |
| CSS                  | **Tailwind CSS**                                                                                                                    | 3.4.17 |
| Animação Tailwind    | tailwindcss-animate                                                                                                                 | 1.0.7  |
| Componentes headless | **Radix UI** (avatar, checkbox, dialog, dropdown-menu, label, popover, scroll-area, select, separator, slot, switch, tabs, tooltip) | —      |
| Variantes de classe  | **class-variance-authority** (cva)                                                                                                  | 0.7.1  |
| Merge de classes     | clsx + tailwind-merge (helper `cn`)                                                                                                 | —      |
| Ícones               | **lucide-react**                                                                                                                    | 0.469  |
| Animações            | framer-motion                                                                                                                       | 11.15  |
| Temas (dark/light)   | next-themes                                                                                                                         | 0.4.4  |
| Toasts               | **sonner**                                                                                                                          | 1.7.1  |
| Command palette      | cmdk                                                                                                                                | 1.0.4  |
| Tabelas              | @tanstack/react-table                                                                                                               | 8.20   |
| Gráficos             | **recharts**                                                                                                                        | 2.15   |
| Formulários          | react-hook-form + zod + @hookform/resolvers                                                                                         | —      |
| Datas                | date-fns                                                                                                                            | 4.1    |

**Abordagem:** padrão **shadcn/ui** (componentes copiados para `src/components/ui`, estilizados com Tailwind + cva + tokens CSS em HSL). Não é uma dependência instalada; são componentes locais.

---

## 2. Fontes

Carregadas via `next/font/google`, expostas como CSS variables:

- **Sans (corpo/títulos):** `Nunito_Sans` → `--font-sans`
- **Mono (código/números):** `JetBrains_Mono` → `--font-mono`

```ts
// next/font/google
const sans = Nunito_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
```

Tailwind:

```ts
fontFamily: {
  sans: ["var(--font-sans)", "system-ui", "sans-serif"],
  mono: ["var(--font-mono)", "monospace"],
}
```

**Base font-size = 17px** (`html { font-size: 17px }`) — toda a UI é rem, então fica um pouco maior/confortável.
Body usa: `font-feature-settings: "rlig" 1, "calt" 1, "ss01" 1;` e `text-rendering: optimizeLegibility;`

---

## 3. Cores (tokens HSL) — a identidade

Cor primária: **azul #2563eb** (premium enterprise). Todas as cores são canais HSL crus para permitir modificadores de opacidade do Tailwind (`bg-primary/10`).

### Light (`:root`)

```css
--background: 0 0% 100%;
--foreground: 222 47% 11%;
--card: 0 0% 100%;
--card-foreground: 222 47% 11%;
--popover: 0 0% 100%;
--popover-foreground: 222 47% 11%;
--primary: 221 83% 53%; /* #2563eb */
--primary-foreground: 0 0% 100%;
--secondary: 220 14% 96%;
--secondary-foreground: 222 47% 11%;
--muted: 220 14% 96%;
--muted-foreground: 220 9% 46%;
--accent: 221 83% 97%;
--accent-foreground: 221 83% 40%;
--destructive: 0 72% 51%;
--destructive-foreground: 0 0% 100%;
--success: 142 71% 45%;
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%;
--warning-foreground: 0 0% 100%;
--border: 220 13% 91%;
--input: 220 13% 91%;
--ring: 221 83% 53%;
--radius: 0.65rem;
/* Sidebar */
--sidebar: 0 0% 100%;
--sidebar-foreground: 222 47% 11%;
--sidebar-accent: 221 83% 96%;
--sidebar-border: 220 13% 91%;
```

### Dark (`.dark`) — azul escuro #1e3a8a informa as superfícies

```css
--background: 224 47% 6%;
--foreground: 210 40% 98%;
--card: 222 44% 9%;
--card-foreground: 210 40% 98%;
--popover: 222 44% 9%;
--popover-foreground: 210 40% 98%;
--primary: 217 91% 60%;
--primary-foreground: 222 47% 11%;
--secondary: 217 33% 17%;
--secondary-foreground: 210 40% 98%;
--muted: 217 33% 15%;
--muted-foreground: 215 20% 65%;
--accent: 222 47% 16%;
--accent-foreground: 213 94% 78%;
--destructive: 0 63% 50%;
--destructive-foreground: 210 40% 98%;
--success: 142 64% 42%;
--success-foreground: 210 40% 98%;
--warning: 38 92% 50%;
--warning-foreground: 222 47% 11%;
--border: 217 33% 18%;
--input: 217 33% 20%;
--ring: 217 91% 60%;
--sidebar: 224 45% 7%;
--sidebar-foreground: 210 40% 98%;
--sidebar-accent: 222 47% 14%;
--sidebar-border: 217 33% 15%;
```

Theme color (PWA/browser): light `#ffffff`, dark `#070d1c`.

### Mapeamento Tailwind (todas usam `hsl(var(--token))`)

`border, input, ring, background, foreground, primary{.foreground}, secondary{.foreground}, destructive{.foreground}, success{.foreground}, warning{.foreground}, muted{.foreground}, accent{.foreground}, popover{.foreground}, card{.foreground}, sidebar{.foreground,.accent,.border}`

---

## 4. Raio, sombras e container

```ts
borderRadius: {
  xl: "calc(var(--radius) + 4px)",  // ~14.4px
  lg: "var(--radius)",              // 10.4px (0.65rem @17px base)
  md: "calc(var(--radius) - 2px)",
  sm: "calc(var(--radius) - 4px)",
}
boxShadow: {
  xs:  "0 1px 2px 0 rgb(0 0 0 / 0.04)",
  sm:  "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
  md:  "0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.05)",
  lg:  "0 12px 32px -8px rgb(0 0 0 / 0.12), 0 4px 12px -4px rgb(0 0 0 / 0.08)",
  glow:"0 0 0 1px hsl(var(--primary) / 0.1), 0 8px 24px -8px hsl(var(--primary) / 0.35)",
}
container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } }
darkMode: ["class"]
```

---

## 5. Animações (keyframes + utilitários)

```ts
keyframes: {
  "accordion-down": { from:{height:"0"}, to:{height:"var(--radix-accordion-content-height)"} },
  "accordion-up":   { from:{height:"var(--radix-accordion-content-height)"}, to:{height:"0"} },
  shimmer:          { "100%": { transform: "translateX(100%)" } },
  "fade-in":        { from:{opacity:"0",transform:"translateY(4px)"}, to:{opacity:"1",transform:"translateY(0)"} },
}
animation: {
  "accordion-down": "accordion-down 0.2s ease-out",
  "accordion-up":   "accordion-up 0.2s ease-out",
  shimmer:          "shimmer 1.6s infinite",
  "fade-in":        "fade-in 0.3s ease-out",
}
```

### Utilitários CSS custom (em `@layer utilities`)

```css
.bg-grid {
  /* grid de linhas sutis 40x40 usando --border/0.4 */
}
.bg-radial-primary {
  background-image: radial-gradient(
    60% 60% at 50% 0%,
    hsl(var(--primary) / 0.12) 0%,
    transparent 100%
  );
}
.text-gradient {
  @apply bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent;
}
.glass {
  @apply bg-background/70 backdrop-blur-xl backdrop-saturate-150;
} /* headers/barras flutuantes */
.shimmer::after {
  /* gradiente 90deg com hsl(--foreground/0.04), animação shimmer */
}
```

### Scrollbar custom

Largura 10px, track transparente, thumb `bg-border` arredondado com borda de 2px transparente (background-clip: content-box); hover `bg-muted-foreground/40`.

---

## 6. Padrões de componentes (assinatura visual)

Helper universal: `cn(...)` = `twMerge(clsx(inputs))`.

### Button (cva)

Base:

```
inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium
transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none
disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]
```

Variantes: `default` (bg-primary + shadow-sm, hover:bg-primary/90 hover:shadow-md) · `destructive` · `outline` (border-input bg-background shadow-xs, hover:bg-accent hover:border-primary/30) · `secondary` · `ghost` (hover:bg-accent) · `link` (text-primary underline).
Tamanhos: `default h-9 px-4` · `sm h-8 px-3 text-xs` · `lg h-11 px-6 text-base` · `icon size-9` · `icon-sm size-8`.
Prop `loading` → mostra `<Loader2 className="animate-spin"/>`. `asChild` via Radix Slot.

### Card

```
rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow
```

Header `p-6 space-y-1.5` · Title `font-semibold leading-none tracking-tight` · Description `text-sm text-muted-foreground` · Content `p-6 pt-0` · Footer `flex items-center p-6 pt-0`.

### Badge (cva)

```
inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium [&_svg]:size-3
```

Variantes: `default` bg-primary/10 text-primary · `secondary` · `outline` · `success` bg-success/10 text-success border-success/20 · `warning` bg-warning/10 ... · `destructive` bg-destructive/10 ...

### Input

```
flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors
placeholder:text-muted-foreground/70
focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20
```

Suporta `startIcon` (ícone absoluto à esquerda, campo com `pl-9`).

### Tons de status/etapas (chips e barras laterais de kanban)

```
bg-accent text-accent-foreground border-primary/20      (ativo/destaque)
bg-success/10 text-success border-success/20            (ok/ganho)
bg-warning/10 text-warning border-warning/20            (atenção)
bg-destructive/10 text-destructive border-destructive/20 (erro/perda)
bg-muted text-muted-foreground border-border            (neutro)
/* barras laterais: border-l-primary | border-l-success | border-l-warning | border-l-destructive | border-l-muted-foreground/40 */
```

---

## 7. Resumo da "vibe" visual

- **Enterprise SaaS limpo**, azul #2563eb como cor de marca, muito branco/neutro, cantos arredondados (~10px), sombras suaves e difusas (nunca duras).
- Tipografia **Nunito Sans** arredondada e amigável + **JetBrains Mono** para números/código; base 17px.
- Micro-interações: botões afundam (`active:scale-0.98`), foco com ring azul translúcido (`ring-primary/20`), shimmer em skeletons, fade-in de 0.3s.
- Dark mode profundo azul-marinho (`224 47% 6%`).
- Superfícies especiais: `.glass` (blur) em headers, `.bg-grid` e `.bg-radial-primary` em telas de auth/marketing.

---

### Arquivos-fonte no projeto original

- `tailwind.config.ts` — tokens, sombras, animações
- `src/app/globals.css` — variáveis HSL light/dark + utilitários
- `src/app/layout.tsx` — fontes
- `src/components/ui/*` — componentes (padrão shadcn)
- `src/config/domain.tsx` — mapas de tons de status

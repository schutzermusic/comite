# TASK-005 · `HudPanel` v2 — API retrocompatível

**Fase:** F1 — Material System v2
**PR:** PR-05
**Dependências:** TASK-004
**Owner-profile:** Frontend Engineer
**Estimativa:** 4–5h

---

## Contexto

`HudPanel` é o componente mais usado do projeto. Esta tarefa refatora-o in-place para usar as novas classes `.ig-glass` de 5 elevações, sem quebrar nenhuma chamada existente. Props legadas (`accentColor`, `hoverGlow`, `breathe`) são mantidas como aceitas (sem efeito) para retrocompatibilidade. Novas props enriquecem a API.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Reescrever** | `src/components/hud/HudPanel.tsx` |

---

## Nova interface de props

```ts
export type HudElevation = 1 | 2 | 3 | 4 | 5;
export type HudMaterialState = 'default' | 'success' | 'warning' | 'critical';

export interface HudPanelProps {
  // ── Existentes (manter comportamento) ──
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  deepLink?: { href: string; label: string };
  badge?: number;
  headerActions?: React.ReactNode;
  delay?: number;
  noPadding?: boolean;

  // ── Legadas (aceitar, ignorar silenciosamente) ──
  accentColor?: string;   // @deprecated
  hoverGlow?: boolean;    // @deprecated — controlado por interactive
  breathe?: boolean;      // @deprecated — sem efeito

  // ── Novas ──
  elevation?: HudElevation;       // default: 2
  state?: HudMaterialState;       // default: 'default'
  interactive?: boolean;          // default: true
  sweep?: boolean;                // default: false
  halo?: boolean;                 // default: false
  watermark?: string;
  serial?: string;
  iconTint?: string;              // ex: '#F5A524'
  metallic?: boolean;             // título com gradiente metálico
  parallax?: boolean;             // habilita useParallaxGlass (TASK-018)
}
```

## Implementação completa

```tsx
"use client";
import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type HudElevation = 1 | 2 | 3 | 4 | 5;
export type HudMaterialState = "default" | "success" | "warning" | "critical";

export interface HudPanelProps {
  children: React.ReactNode;
  className?: string;
  elevation?: HudElevation;
  state?: HudMaterialState;
  interactive?: boolean;
  sweep?: boolean;
  halo?: boolean;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  iconTint?: string;
  deepLink?: { href: string; label: string };
  badge?: number;
  headerActions?: React.ReactNode;
  noPadding?: boolean;
  watermark?: string;
  serial?: string;
  delay?: number;
  metallic?: boolean;
  parallax?: boolean;
  // @deprecated — aceitar sem efeito
  accentColor?: string;
  hoverGlow?: boolean;
  breathe?: boolean;
}

export function HudPanel({
  children,
  className,
  elevation = 2,
  state = "default",
  interactive = true,
  sweep = false,
  halo = false,
  title,
  subtitle,
  icon,
  iconTint,
  deepLink,
  badge,
  headerActions,
  noPadding = false,
  watermark,
  serial,
  delay = 0,
  metallic = false,
}: HudPanelProps) {
  const hasHeader = Boolean(title || icon);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(halo && "ig-glass-halo", className)}
    >
      <div
        className="ig-glass"
        data-elev={elevation}
        data-state={state !== "default" ? state : undefined}
        data-interactive={interactive || undefined}
        data-sweep={sweep || undefined}
      >
        {/* material layers */}
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        {sweep && <span data-ig-sweep="" />}

        {/* content layer */}
        <div data-ig-content="">
          {hasHeader && (
            <header className="flex items-start justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                {icon && (
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.14)]"
                    style={
                      iconTint
                        ? {
                            backgroundColor: `color-mix(in oklab, ${iconTint} 14%, transparent)`,
                            color: iconTint,
                          }
                        : {
                            backgroundColor: "var(--ig-accent-weak)",
                            color: "var(--ig-accent)",
                          }
                    }
                  >
                    {icon}
                  </span>
                )}
                <div className="min-w-0">
                  {title && (
                    <h3
                      className={cn(
                        "text-ig-h3 truncate",
                        metallic
                          ? "ig-text-metal"
                          : "text-ig-fg-strong"
                      )}
                    >
                      {title}
                      {badge !== undefined && badge > 0 && (
                        <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-ig-accent text-white text-[10px] font-semibold">
                          {badge}
                        </span>
                      )}
                    </h3>
                  )}
                  {subtitle && (
                    <p className="text-ig-caption text-ig-fg-muted truncate mt-0.5">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {headerActions}
                {deepLink && (
                  <a
                    href={deepLink.href}
                    className="text-ig-label text-ig-fg-muted hover:text-ig-accent transition-colors"
                  >
                    {deepLink.label} →
                  </a>
                )}
              </div>
            </header>
          )}

          {hasHeader && (
            <div className="mx-5 h-px bg-gradient-to-r from-transparent via-ig-border to-transparent" />
          )}

          <div
            className={cn(
              !noPadding && "px-5 py-4",
              hasHeader && !noPadding && "pt-4"
            )}
          >
            {children}
          </div>

          {(watermark || serial) && (
            <footer className="flex items-center justify-between px-5 pb-2 pt-3 border-t border-ig-border-subtle">
              {serial && (
                <span className="font-mono text-[10px] tracking-[0.2em] text-ig-fg-subtle">
                  {serial}
                </span>
              )}
              {watermark && (
                <span className="ml-auto text-[9px] tracking-[0.32em] uppercase text-ig-fg-subtle">
                  {watermark}
                </span>
              )}
            </footer>
          )}
        </div>
      </div>
    </motion.div>
  );
}
```

---

## Acceptance criteria

- [ ] Todas as chamadas existentes de `<HudPanel>` renderizam sem erro (testar `/financeiro`, `/projetos`, `/riscos`).
- [ ] `<HudPanel elevation={3}>` mostra vidro mais opaco/blured que `elevation={2}`.
- [ ] `<HudPanel state="critical">` mostra borda vermelha.
- [ ] `<HudPanel sweep>` faz specular varrer no hover.
- [ ] `<HudPanel serial="DEL-2026-0147" watermark="GOV · V2.6">` renderiza rodapé font-mono.
- [ ] Props `accentColor`, `hoverGlow`, `breathe` são aceitas sem TypeScript error.
- [ ] `npm run typecheck` e `npm run build` passam.

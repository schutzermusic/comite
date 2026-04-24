# TASK-018 · Parallax + specular sweep + focus cinemático

**Fase:** F5 — Identidade + Polish
**PR:** PR-18
**Dependências:** TASK-005, TASK-017
**Pode rodar em paralelo com:** TASK-019
**Owner-profile:** Design System Engineer
**Estimativa:** 4–5h

---

## Contexto

Esta tarefa adiciona micro-interações de alto impacto: (1) parallax sutil do conteúdo em painéis herói, (2) spotlight de cursor que segue o mouse, e (3) focus ring cinemático duplo em botões e inputs. Tudo com degradação graciosa via `prefers-reduced-motion`.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `src/hooks/useParallaxGlass.ts` |
| **Modificar** | `src/components/hud/HudPanel.tsx` (prop `parallax`) |
| **Modificar** | `src/styles/glass.css` (spotlight + hover state) |
| **Aplicar** | Painéis herói do Dashboard e Financeiro |

---

## `src/hooks/useParallaxGlass.ts`

```ts
"use client";
import { useRef, useCallback } from "react";

interface ParallaxResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

export function useParallaxGlass(strength = 0.6): ParallaxResult {
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = ((e.clientX - cx) / (rect.width / 2)) * strength;
      const dy = ((e.clientY - cy) / (rect.height / 2)) * strength;
      const sx = ((e.clientX - rect.left) / rect.width) * 100;
      const sy = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--ig-parallax-x", `${dx}px`);
      el.style.setProperty("--ig-parallax-y", `${dy}px`);
      el.style.setProperty("--ig-spot-x", `${sx}%`);
      el.style.setProperty("--ig-spot-y", `${sy}%`);
    },
    [strength]
  );

  const onMouseLeave = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty("--ig-parallax-x", "0px");
    el.style.setProperty("--ig-parallax-y", "0px");
  }, []);

  return { containerRef, onMouseMove, onMouseLeave };
}
```

## Adicionar em `glass.css`

```css
/* ── Parallax content ── */
.ig-glass[data-interactive] > [data-ig-content] {
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
  transform: translate3d(
    calc(var(--ig-parallax-x, 0px) * 0.4),
    calc(var(--ig-parallax-y, 0px) * 0.4),
    0
  );
}

/* ── Spotlight cursor ── */
.ig-glass[data-interactive]::before {
  /* Adicionar ALÉM do tint/blur existente: spotlight overlay */
}
/* Spotlight como pseudo-elemento separado via ::after — usando custom property */
.ig-glass[data-interactive] {
  --ig-spot-x: 50%;
  --ig-spot-y: 50%;
}
.ig-glass[data-interactive]:hover {
  background-image: radial-gradient(
    circle 200px at var(--ig-spot-x) var(--ig-spot-y),
    rgba(20, 184, 166, 0.06),
    transparent 70%
  );
}

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  .ig-glass[data-interactive] > [data-ig-content] {
    transform: none !important;
    transition: none;
  }
}
```

## Modificar `HudPanel.tsx` para `parallax`

```tsx
// Quando parallax=true, conectar o hook
import { useParallaxGlass } from "@/hooks/useParallaxGlass";

// Dentro do componente:
const parallaxProps = parallax ? useParallaxGlass(0.8) : null;

// No elemento `.ig-glass`:
<div
  ref={parallaxProps?.containerRef}
  className="ig-glass"
  data-elev={elevation}
  data-interactive={interactive || undefined}
  onMouseMove={parallaxProps?.onMouseMove}
  onMouseLeave={parallaxProps?.onMouseLeave}
  // ...
>
```

> **Atenção:** Hooks devem ser chamados incondicionalmente. Use uma estratégia de composição (ex: componente interno `ParallaxWrapper`) para evitar violar regras de hooks quando `parallax=false`.

```tsx
// Estratégia correta:
function useConditionalParallax(enabled: boolean) {
  const parallax = useParallaxGlass(0.8);
  if (!enabled) return null;
  return parallax;
}
```

## Aplicar `parallax` em painéis herói

```tsx
// Dashboard — Left Stack painel principal
<HudPanel elevation={3} halo parallax sweep watermark="CONTROL ROOM · V2.6">

// Financeiro — painel KPI principal
<HudPanel elevation={2} parallax>
```

---

## Acceptance criteria

- [ ] Mouse sobre painel `parallax=true` causa deslocamento sutil do conteúdo (≤ 1px visível).
- [ ] Spotlight (radial teal) segue o cursor no hover.
- [ ] `prefers-reduced-motion: reduce` desliga parallax e spotlight.
- [ ] Nenhum janking de layout (usar DevTools Performance para validar).
- [ ] `HudButton variant="primary"` com focus-visible mostra anel duplo cinemático.
- [ ] `npm run build` passa.

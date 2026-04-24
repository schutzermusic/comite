# TASK-004 · Classes `.ig-glass` de 5 elevações

**Fase:** F1 — Material System v2
**PR:** PR-04
**Dependências:** TASK-001
**Pode rodar em paralelo com:** TASK-002, TASK-003
**Owner-profile:** Design System Engineer
**Estimativa:** 6–8h

---

## Contexto

O sistema de vidro atual (`cr-glass-panel`) tem uma única "receita" para todos os contextos. Esta tarefa cria `src/styles/glass.css` com um sistema completo de 5 elevações materiais, cada uma com blur, edge lighting, inner highlights, shadow e halo próprios. As classes são puramente CSS — sem JS — com degradação graciosa mobile e `prefers-reduced-motion`.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `src/styles/glass.css` |
| **Modificar** | `src/app/globals.css` (importar após `tokens.css`) |
| **Criar (temporário)** | `src/app/(main)/_preview/page.tsx` (para validação visual) |

---

## Instruções

### Passo 1 — Criar `src/styles/glass.css`

```css
/* ═════════════════════════════════════════════════════════
   INSIGHT — GLASS MATERIAL SYSTEM v2
   Sistema de 5 elevações para painéis glassmorfistas.
   ═════════════════════════════════════════════════════════ */

/* ── Base ── */
.ig-glass {
  position: relative;
  border-radius: var(--ig-radius-lg);
  overflow: hidden;
  isolation: isolate;
  contain: layout style paint;
}

/* ── Camada 0: tint + blur (::before) ── */
.ig-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: 0;
  pointer-events: none;
  background: var(--ig-glass-current, var(--ig-glass-e2));
  backdrop-filter: var(--ig-blur-current, var(--ig-blur-e2));
  -webkit-backdrop-filter: var(--ig-blur-current, var(--ig-blur-e2));
}

/* ── Camada 1: edge lighting (::after via mask) ── */
.ig-glass::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: 0;
  pointer-events: none;
  background: var(--ig-edge-current, var(--ig-edge-e2));
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 1px;
}

/* ── Camada 2: conteúdo ── */
.ig-glass > [data-ig-content] {
  position: relative;
  z-index: 3;
}

/* ── Camada: specular estático ── */
.ig-glass > [data-ig-specular] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  border-radius: inherit;
  background: var(--ig-specular-static);
  background-size: 100% 40%;
  background-repeat: no-repeat;
  background-position: top center;
  opacity: 0.5;
}

/* ── Camada: noise ── */
.ig-glass > [data-ig-noise] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  border-radius: inherit;
  background-image: var(--ig-noise-url);
  background-size: 64px 64px;
  opacity: var(--ig-noise-opacity-current, var(--ig-noise-opacity-e2));
  mix-blend-mode: overlay;
}

/* ── Sweep (specular animado, só com data-sweep) ── */
.ig-glass[data-sweep] > [data-ig-sweep] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  border-radius: inherit;
  background: var(--ig-specular-sweep);
  background-size: 200% 100%;
  background-position: -100% 0;
  opacity: 0;
  transition: opacity 200ms ease;
}
.ig-glass[data-sweep]:hover > [data-ig-sweep] {
  opacity: 1;
  animation: ig-sweep 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes ig-sweep {
  from { background-position: -100% 0; }
  to   { background-position:  200% 0; }
}

/* ── Halo atmosférico (wrapper externo) ── */
.ig-glass-halo {
  position: relative;
}
.ig-glass-halo::before {
  content: '';
  position: absolute;
  inset: -20px -30px;
  pointer-events: none;
  z-index: -1;
  background: var(--ig-halo-current, var(--ig-halo-e2));
  filter: blur(20px);
}

/* ── Elevações ── */
.ig-glass[data-elev="1"] {
  --ig-glass-current:          var(--ig-glass-e1);
  --ig-blur-current:           var(--ig-blur-e1);
  --ig-edge-current:           var(--ig-edge-e1);
  --ig-noise-opacity-current:  var(--ig-noise-opacity-e1);
  --ig-halo-current:           var(--ig-halo-e2);
  box-shadow: var(--ig-inner-e1), var(--ig-shadow-e1);
}
.ig-glass[data-elev="2"],
.ig-glass:not([data-elev]) {
  --ig-glass-current:          var(--ig-glass-e2);
  --ig-blur-current:           var(--ig-blur-e2);
  --ig-edge-current:           var(--ig-edge-e2);
  --ig-noise-opacity-current:  var(--ig-noise-opacity-e2);
  --ig-halo-current:           var(--ig-halo-e2);
  box-shadow: var(--ig-inner-e2), var(--ig-shadow-e2);
}
.ig-glass[data-elev="3"] {
  --ig-glass-current:          var(--ig-glass-e3);
  --ig-blur-current:           var(--ig-blur-e3);
  --ig-edge-current:           var(--ig-edge-e3);
  --ig-noise-opacity-current:  var(--ig-noise-opacity-e3);
  --ig-halo-current:           var(--ig-halo-e3);
  box-shadow: var(--ig-inner-e3), var(--ig-shadow-e3);
}
.ig-glass[data-elev="4"] {
  --ig-glass-current:          var(--ig-glass-e4);
  --ig-blur-current:           var(--ig-blur-e4);
  --ig-edge-current:           var(--ig-edge-e4);
  --ig-noise-opacity-current:  var(--ig-noise-opacity-e4);
  --ig-halo-current:           var(--ig-halo-e4);
  box-shadow: var(--ig-inner-e4), var(--ig-shadow-e4);
}
.ig-glass[data-elev="5"] {
  --ig-glass-current:          var(--ig-glass-e5);
  --ig-blur-current:           var(--ig-blur-e5);
  --ig-edge-current:           var(--ig-edge-e5);
  --ig-noise-opacity-current:  var(--ig-noise-opacity-e4);
  --ig-halo-current:           var(--ig-halo-e5);
  box-shadow: var(--ig-inner-e5), var(--ig-shadow-e5);
}

/* ── States ── */
.ig-glass[data-state="success"]::after {
  background: linear-gradient(130deg, rgba(16,185,129,0.40), rgba(16,185,129,0.18) 40%, transparent);
}
.ig-glass[data-state="warning"]::after {
  background: linear-gradient(130deg, rgba(245,165,36,0.40), rgba(245,165,36,0.18) 40%, transparent);
}
.ig-glass[data-state="critical"]::after {
  background: linear-gradient(130deg, rgba(239,75,85,0.50), rgba(239,75,85,0.22) 40%, transparent);
}

/* ── Interactive hover ── */
.ig-glass[data-interactive] {
  cursor: default;
  transition: transform 200ms cubic-bezier(0.22,1,0.36,1),
              box-shadow 200ms ease;
}
.ig-glass[data-interactive]:hover {
  transform: translateY(-1px) scale(1.002);
  box-shadow:
    var(--ig-inner-e3),
    var(--ig-shadow-e3),
    0 0 0 1px rgba(20,184,166,0.15);
}
.ig-glass[data-interactive]:active {
  transform: translateY(0) scale(0.999);
}

/* ── Focus cinemático ── */
.ig-glass[data-focused],
.ig-glass:focus-within {
  box-shadow:
    var(--ig-focus-ring-outer),
    var(--ig-focus-ring-inner),
    var(--ig-shadow-e3);
}

/* ── Backdrop (para modais/drawers) ── */
.ig-backdrop {
  background: radial-gradient(ellipse at center, rgba(3,8,12,0.72), rgba(3,8,12,0.88) 75%);
  backdrop-filter: blur(14px) saturate(130%);
  -webkit-backdrop-filter: blur(14px) saturate(130%);
}
html.light .ig-backdrop {
  background: radial-gradient(ellipse at center, rgba(15,23,42,0.22), rgba(15,23,42,0.42) 75%);
  backdrop-filter: blur(8px) saturate(120%);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
}

/* ── Degradação mobile ── */
@media (max-resolution: 1.5dppx) and (pointer: coarse) {
  .ig-glass[data-elev="1"]::before {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--ig-bg-panel);
  }
}

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  .ig-glass[data-interactive] { transition: none; }
  .ig-glass[data-sweep] > [data-ig-sweep] { animation: none !important; }
}
```

### Passo 2 — Importar em `globals.css`

Adicionar após a linha de import de `tokens.css`:
```css
@import "../styles/glass.css";
```

### Passo 3 — Criar página de preview (temporária)

Criar `src/app/(main)/_preview/page.tsx`:
```tsx
export default function Preview() {
  return (
    <div className="p-10 grid grid-cols-2 lg:grid-cols-5 gap-6 min-h-screen">
      {([1, 2, 3, 4, 5] as const).map((e) => (
        <div key={e} className="ig-glass" data-elev={e} data-interactive="">
          <span data-ig-noise="" />
          <span data-ig-specular="" />
          <div data-ig-content="" className="p-5">
            <p className="text-ig-label ig-label-upper text-ig-fg-muted mb-1">ELEV {e}</p>
            <p className="text-ig-h3 text-ig-fg-strong">Glass Panel</p>
            <p className="text-ig-body-sm text-ig-fg-muted mt-1">
              Profundidade e blur elevação {e}.
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Acceptance criteria

- [ ] 5 elevações em `/dev/preview` mostram diferença visual clara de profundidade em dark mode.
- [ ] Mesma diferença perceptível em light mode (fosco → papel → elevado).
- [ ] Hover em `data-interactive` faz `translateY(-1px)` + glow teal sutil.
- [ ] `data-state="critical"` pinta borda em vermelho.
- [ ] FPS ≥ 55 com 10 painéis em tela.
- [ ] `prefers-reduced-motion: reduce` desliga transições.
- [ ] `npm run build` passa.

> **Cleanup:** A rota `_preview` deve ser removida antes do merge para `main`, ou movida para `/dev` protegida por feature flag.

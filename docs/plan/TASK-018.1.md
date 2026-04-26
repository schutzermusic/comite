# TASK-018.1 · Complete parallax support for Dashboard HUD panels

**Fase:** F5 — Identidade + Polish (correção)
**PR:** PR-18.1
**Origem:** Sub-task corretiva derivada de TASK-018
**Owner-profile:** Design System Engineer
**Estimativa:** 1–2h

---

## Origem da correção

A TASK-018 foi mergeada antes da TASK-017.1. Naquele momento, em `main`, os
painéis herói do Dashboard ainda usavam o componente local
`src/components/dashboard/hud/HudPanel.tsx` (que vivia em paralelo ao
`@/components/hud/HudPanel`). Como esse componente local não expunha a prop
`parallax`, o efeito implementado em TASK-018 não pôde ser aplicado nos painéis
do Dashboard — só ficou disponível no Financeiro.

Com a TASK-017.1 já mergeada (PR #7), o Dashboard segue usando o
`HudPanel` local (decisão arquitetural), porém agora com suporte para
`serial`/`watermark` consolidado. Esta sub-task completa a entrega da
TASK-018 adicionando suporte equivalente de `parallax` ao HudPanel local
do Dashboard e aplicando o efeito nos painéis herói.

---

## Motivo

- TASK-018 dependia da TASK-017.1 para tocar os painéis do Dashboard.
- TASK-017.1 entrou em `main` depois de TASK-018.
- Sem esta sub-task, o Dashboard nunca recebe parallax — quebrando o
  acceptance criteria “aplicar nos painéis herói do Dashboard e Financeiro”.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/components/dashboard/hud/HudPanel.tsx` (prop `parallax`) |
| **Modificar** | `src/components/dashboard/LeftHudStack.tsx` (aplicar em painéis herói) |
| **Modificar** | `src/components/dashboard/RightHudStack.tsx` (aplicar em painéis herói) |
| **Criar** | `docs/plan/TASK-018.1.md` |

Sem alterações em hook (`src/hooks/useParallaxGlass.ts`), CSS global
(`src/styles/glass.css`) ou no HudPanel oficial (`src/components/hud/HudPanel.tsx`).

---

## Implementação

1. **`dashboard/hud/HudPanel.tsx`**
   - Nova prop opcional `parallax?: boolean` (default `false`).
   - Reusa o hook `useParallaxGlass` (já criado em TASK-018).
   - `parallaxEnabled = parallax && !shouldReduceMotion` —
     `useReducedMotion()` do framer-motion garante respeito automático ao
     `prefers-reduced-motion`.
   - Quando habilitado:
     - `ref` + `onMouseMove` + `onMouseLeave` ligados ao container raiz.
     - `data-parallax` no container (consistente com a API do HudPanel oficial).
     - `<span data-ig-spotlight>` injetado dentro do `GlassPanel` com
       gradiente teal radial seguindo `--ig-spot-x` / `--ig-spot-y`,
       opacidade transicionada via `group-hover` (motion.div já carrega
       `group`).
     - Conteúdo envolto em `<div data-ig-content>` com `transform:
       translate3d(calc(var(--ig-parallax-x) * 0.4), calc(var(--ig-parallax-y)
       * 0.4), 0)`, transição 200ms / cubic-bezier(0.22, 1, 0.36, 1) e
       `will-change: transform`.
   - Quando desabilitado (default ou reduced-motion): sem ref, sem handlers,
     sem spotlight, sem transform → comportamento visual idêntico ao
     anterior.

2. **`LeftHudStack.tsx` / `RightHudStack.tsx`**
   - `parallax` aplicado somente nos três painéis de maior hierarquia visual:
     - `LeftHudStack` — Panel A (`executiveQueue`) e Panel C (`financeSnapshot`).
     - `RightHudStack` — Panel F (`eventStream`).
   - Painéis pequenos/operacionais (B, D, E) ficam sem parallax para
     evitar excesso de movimento.
   - Nenhum novo `serial`/`watermark` adicionado.

---

## Acceptance criteria

- [x] `dashboard/hud/HudPanel` aceita prop `parallax?: boolean`.
- [x] Painéis herói do Dashboard (Executive Queue, Finance Snapshot,
      Event Stream) usam parallax sutil.
- [x] Painéis pequenos/operacionais (Portfolio Overview, Decision SLA,
      Risk Exposure) não recebem parallax.
- [x] `prefers-reduced-motion: reduce` desliga o efeito (via
      `useReducedMotion()` do framer-motion).
- [x] Nenhum novo `serial`/`watermark` adicionado.
- [x] Nenhuma classe proibida nova adicionada.
- [x] Layout estrutural do Dashboard inalterado.
- [x] `npm run typecheck` sem regressão (59 → 59).
- [x] `npm run build` passa.

---

## Arquivos alterados

- `src/components/dashboard/hud/HudPanel.tsx`
- `src/components/dashboard/LeftHudStack.tsx`
- `src/components/dashboard/RightHudStack.tsx`
- `docs/plan/TASK-018.1.md` (criado)

# TASK-006 · Refactor light-mode-native nos componentes HUD

**Fase:** F1 — Material System v2
**PR:** PR-06
**Dependências:** TASK-004, TASK-005
**Owner-profile:** Frontend Engineer (pode ser dividida entre 2 pessoas)
**Estimativa:** 8–12h (alto volume de substituições mecânicas)

---

## Contexto

Todos os componentes HUD usam `text-white/*`, `bg-white/*`, `border-white/*` hardcoded, o que faz o light mode parecer um produto diferente (texto branco sobre fundo branco). Esta tarefa substitui todos esses valores por tokens `ig-*` semânticos, além de corrigir o botão primário (gaming → premium) e migrar Drawer/Modal/Toast para `.ig-glass`.

---

## Escopo de arquivos

Todos em `src/components/hud/`:
- `HudHeader.tsx`
- `HudKpi.tsx`
- `HudKpiStrip.tsx` (se existir)
- `HudStatusPill.tsx`
- `HudChip.tsx` (se existir)
- `HudBadge.tsx` (se existir)
- `HudTable.tsx`
- `HudButton.tsx`
- `HudInput.tsx`
- `HudSelect.tsx`
- `HudFilterBar.tsx`
- `HudTabs.tsx`
- `HudDrawer.tsx`
- `HudModal.tsx`
- `HudToast.tsx`
- `HudProgressBar.tsx` (se existir)
- `HudEmptyState.tsx`

---

## Tabela de substituição (aplicar mecanicamente)

| Antes | Depois |
|---|---|
| `text-white` | `text-ig-fg-strong` |
| `text-white/90` | `text-ig-fg-strong` |
| `text-white/80`, `text-white/70` | `text-ig-fg` |
| `text-white/60`, `text-white/50` | `text-ig-fg-muted` |
| `text-white/40`, `text-white/35` | `text-ig-fg-subtle` |
| `text-white/30` e abaixo | `text-ig-fg-disabled` |
| `bg-white/[0.08]` | `bg-ig-panel-hover` |
| `bg-white/[0.05]`, `bg-white/[0.04]` | `bg-ig-panel` |
| `bg-white/[0.03]`, `bg-white/[0.02]` | `bg-ig-raised` |
| `border-white/[0.12]`, `border-white/[0.10]` | `border-ig-border-strong` |
| `border-white/[0.08]`, `border-white/[0.06]` | `border-ig-border` |
| `border-white/[0.05]`, `border-white/[0.04]` | `border-ig-border-subtle` |
| `text-cyan-300`, `text-cyan-400` | `text-ig-accent` |
| `text-emerald-300`, `text-emerald-400` | `text-ig-accent` |
| `bg-cyan-500/10`, `bg-emerald-500/10` | `bg-ig-accent-weak` |
| `border-cyan-500/20`, `border-emerald-500/20` | `border-ig-border-focus` |
| `text-red-400`, `text-red-500` | `text-ig-danger` |
| `bg-red-500/10` | `bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]` |
| `text-amber-400`, `text-yellow-400` | `text-ig-warning` |
| `bg-amber-500/10` | `bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)]` |
| `text-green-400`, `text-emerald-500` | `text-ig-success` |
| `bg-green-500/10` | `bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)]` |

---

## Sub-tarefa 006a · HudButton primário

Substituir `VARIANT_STYLES.primary` (ou equivalente) por:

```ts
primary: [
  'bg-[linear-gradient(180deg,#17C3B2_0%,#0F9C8F_100%)]',
  'text-white font-semibold',
  'border-0',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.20),0_4px_12px_rgba(15,156,143,0.28),0_1px_2px_rgba(0,0,0,0.35)]',
  'hover:brightness-105 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.22),0_6px_18px_rgba(15,156,143,0.38),0_1px_2px_rgba(0,0,0,0.35)]',
  'active:translate-y-px active:scale-[0.995]',
  'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
  'transition-all duration-150',
].join(' '),
```

Adicionar em `tokens.css` (light mode override):
```css
html.light .hud-btn-primary,
html.light button[data-variant="primary"] {
  background: linear-gradient(180deg, #0F766E 0%, #115E59 100%);
}
```

---

## Sub-tarefa 006b · HudDrawer

Envolver o painel principal do drawer em `.ig-glass` elevation 3:
```tsx
<div className="ig-glass" data-elev="3">
  <span data-ig-noise="" />
  <span data-ig-specular="" />
  <div data-ig-content="">
    {/* conteúdo do drawer */}
  </div>
</div>
```

Backdrop do drawer: trocar `bg-black/50` por `className="ig-backdrop"`.

---

## Sub-tarefa 006c · HudModal

Envolver o painel do modal em `.ig-glass` elevation 4:
```tsx
<div className="ig-glass" data-elev="4">
  <span data-ig-noise="" />
  <span data-ig-specular="" />
  <div data-ig-content="">
    {/* conteúdo do modal */}
  </div>
</div>
```

Backdrop: `className="ig-backdrop"`.

---

## Sub-tarefa 006d · HudToast

Envolver cada toast em `.ig-glass` elevation 4, com `data-state` mapeado da variante:
```tsx
const stateMap = {
  success: 'success',
  error: 'critical',
  warning: 'warning',
  info: 'default',
} as const;

<div
  className="ig-glass"
  data-elev="4"
  data-state={stateMap[variant] ?? 'default'}
>
  <span data-ig-noise="" />
  <div data-ig-content="" className="px-4 py-3">
    {/* conteúdo */}
  </div>
</div>
```

---

## Verificação final

Após as substituições, rodar:
```bash
# Deve retornar 0 matches
grep -rE "text-white|bg-white/\[|border-white/\[|text-black|text-cyan-[3-5]|text-emerald-[3-5]|from-cyan.*to-emerald" src/components/hud/
```

---

## Acceptance criteria

- [ ] `grep` acima retorna 0 em `src/components/hud/`.
- [ ] Screenshots dark + light de `/financeiro`, `/projetos`, `/riscos` mostram contraste correto.
- [ ] Botão primário: sem glow em estado normal, com focus ring cinemático.
- [ ] `grep -c "isLight" src/components/hud/*.tsx` = 0 total.
- [ ] Drawer/Modal/Toast usam `.ig-glass` com backdrop.
- [ ] `npm run typecheck` e `npm run build` passam sem warnings novos.

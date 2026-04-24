# INSIGHT Design System — Guia de Tipografia

## Escala de tamanhos

| Contexto | Classes Tailwind |
|---|---|
| Título da página (HudHeader.title) | `text-ig-h1 ig-text-metal` |
| Título do painel (HudPanel.title) | `text-ig-h3` |
| Subtítulo / descrição | `text-ig-body-sm text-ig-fg-muted` |
| Texto corrido | `text-ig-body` |
| KPI strip valor | `text-ig-kpi-md ig-tabular ig-text-metal-accent` |
| KPI hero Dashboard | `text-ig-kpi-xl ig-tabular ig-text-metal-accent` |
| Label de formulário | `text-ig-label ig-label-upper text-ig-fg-muted` |

## Proibido
- `uppercase tracking-[0.1em]` em títulos de página/painel.
- Tamanhos abaixo de 11px (`text-[10px]`, `text-[9px]`).
- Cores hardcoded em texto (usar sempre `text-ig-fg-*`).
- `font-bold` em texto corrido.

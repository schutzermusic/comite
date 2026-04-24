# TASK-019 · Typography shine (metallic text)

**Fase:** F5 — Identidade + Polish
**PR:** PR-19
**Dependências:** TASK-002
**Pode rodar em paralelo com:** TASK-016, TASK-017, TASK-018
**Owner-profile:** Frontend Engineer
**Estimativa:** 2–3h

---

## Contexto

O efeito metálico em headings e KPIs dá a sensação de material premium. Os tokens `.ig-text-metal` e `.ig-text-metal-accent` foram criados em TASK-002 — esta tarefa os aplica nos locais corretos.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/components/hud/HudHeader.tsx` |
| **Modificar** | `src/components/hud/HudKpi.tsx` |
| **Modificar** | `src/components/hud/HudPanel.tsx` (prop `metallic`) |
| **Aplicar** | KPIs herói do Dashboard, Financeiro, Riscos |

---

## Regras de aplicação

### `HudHeader.tsx`

O `title` do header de página deve usar:
```tsx
<h1 className="text-ig-h1 ig-text-metal font-semibold">
  {title}
</h1>
```

> Somente em `HudHeader` (header de página). `HudPanel.title` usa `text-ig-h3` sem metálico por padrão, a menos que `metallic=true`.

### `HudKpi.tsx`

O valor principal do KPI deve usar:
```tsx
<span className="text-ig-kpi-md ig-tabular ig-text-metal-accent">
  {value}
</span>
```

KPIs herói (quando `size="xl"` ou similar):
```tsx
<span className="text-ig-kpi-xl ig-tabular ig-text-metal-accent">
  {value}
</span>
```

### Dashboard — KPIs herói

Identificar os 2–3 KPIs principais do Left/Right Stack do Dashboard e garantir:
- `text-ig-kpi-xl ig-tabular ig-text-metal-accent`

### Financeiro — KPI overview

Painel de receita/despesa principal:
- `text-ig-kpi-lg ig-tabular ig-text-metal-accent`

### Riscos — Score corporativo

```tsx
<span className="text-ig-kpi-md ig-tabular ig-text-metal-accent">
  {score.toFixed(1)}
</span>
```

---

## Regra geral

| Contexto | Classes |
|---|---|
| H1 de página (HudHeader) | `text-ig-h1 ig-text-metal` |
| H3 de painel com `metallic=true` | `text-ig-h3 ig-text-metal` |
| KPI strip | `text-ig-kpi-md ig-tabular ig-text-metal-accent` |
| KPI hero Dashboard | `text-ig-kpi-xl ig-tabular ig-text-metal-accent` |
| KPI hero Financeiro | `text-ig-kpi-lg ig-tabular ig-text-metal-accent` |
| Texto corrido, labels | Sem metálico (usar `text-ig-fg-*`) |

---

## Acceptance criteria

- [ ] `HudHeader.title` em dark mode: gradiente metálico perceptível.
- [ ] `HudHeader.title` em light mode: texto sólido `var(--ig-fg-strong)` (sem gradiente).
- [ ] `HudKpi` valores principais: gradiente accent (teal→branco).
- [ ] Números KPI mantêm legibilidade em dark e light (mínimo contraste AA).
- [ ] `ig-tabular` garante alinhamento numérico em colunas.
- [ ] `npm run build` passa.

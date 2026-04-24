# TASK-002 · Escala tipográfica executiva

**Fase:** F0 — Foundation
**PR:** PR-02
**Dependências:** TASK-001
**Pode rodar em paralelo com:** TASK-003
**Owner-profile:** Design System Engineer
**Estimativa:** 2–3h

---

## Contexto

O projeto mistura tamanhos de fonte arbitrários (`text-xs`, `text-sm`, `text-[11px]`, `tracking-[0.1em] uppercase`) sem escala semântica consistente. Esta tarefa define a escala `ig-*` com tokens de tipografia para cada contexto de UI executivo, além das classes utilitárias `.ig-text-metal` e `.ig-text-metal-accent` para efeito metálico nos headings e KPIs.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `tailwind.config.ts` |
| **Modificar** | `src/styles/tokens.css` (append ao final) |
| **Criar** | `docs/DESIGN_SYSTEM.md` (tabela de uso) |

---

## Instruções

### Passo 1 — Adicionar em `tailwind.config.ts` → `theme.extend.fontSize`

```ts
'ig-display': ['32px', { lineHeight: '1.1',  fontWeight: '700', letterSpacing: '-0.025em' }],
'ig-h1':      ['22px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.01em' }],
'ig-h2':      ['18px', { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.005em' }],
'ig-h3':      ['15px', { lineHeight: '1.35', fontWeight: '600' }],
'ig-body':    ['14px', { lineHeight: '1.55', fontWeight: '400' }],
'ig-body-sm': ['13px', { lineHeight: '1.5',  fontWeight: '400' }],
'ig-caption': ['12px', { lineHeight: '1.45', fontWeight: '400' }],
'ig-label':   ['11px', { lineHeight: '1.4',  fontWeight: '500', letterSpacing: '0.08em' }],
'ig-kpi-xl':  ['44px', { lineHeight: '1.05', fontWeight: '700', letterSpacing: '-0.025em' }],
'ig-kpi-lg':  ['32px', { lineHeight: '1.1',  fontWeight: '700', letterSpacing: '-0.02em' }],
'ig-kpi-md':  ['22px', { lineHeight: '1.2',  fontWeight: '600', letterSpacing: '-0.01em' }],
```

### Passo 2 — Adicionar no final de `src/styles/tokens.css`

```css
/* ── Metallic text ── */
html.dark .ig-text-metal {
  color: transparent;
  background: linear-gradient(180deg, #FFFFFF 0%, #C7D2D9 100%);
  -webkit-background-clip: text;
  background-clip: text;
  text-shadow: 0 0 24px rgba(255,255,255,0.04);
}
html.dark .ig-text-metal-accent {
  color: transparent;
  background: linear-gradient(180deg, #FFFFFF 0%, #93DCD4 90%);
  -webkit-background-clip: text;
  background-clip: text;
  text-shadow: 0 0 40px rgba(20,184,166,0.12);
}
html.light .ig-text-metal,
html.light .ig-text-metal-accent {
  color: var(--ig-fg-strong);
}

/* ── Utilitários tipográficos ── */
.ig-tabular {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum", "cv11";
}
.ig-label-upper {
  text-transform: uppercase;
}
```

### Passo 3 — Criar `docs/DESIGN_SYSTEM.md`

```markdown
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
```

---

## Acceptance criteria

- [ ] Classes `text-ig-h1`, `text-ig-kpi-xl`, `text-ig-label` etc. existem em runtime.
- [ ] `<p className="text-ig-kpi-xl ig-text-metal-accent ig-tabular">1.234</p>` renderiza gradiente metálico em dark, sólido em light.
- [ ] `docs/DESIGN_SYSTEM.md` criado com a tabela.
- [ ] `npm run build` passa.

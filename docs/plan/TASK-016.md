# TASK-016 · Icon jewels com `iconTint` por módulo

**Fase:** F5 — Identidade + Polish
**PR:** PR-16
**Dependências:** TASK-005
**Pode rodar em paralelo com:** TASK-017, TASK-018, TASK-019
**Owner-profile:** Design System Engineer
**Estimativa:** 3–4h

---

## Contexto

Cada módulo do produto deve ter uma cor de identidade sutil, expressa na "jóia" (icon jewel) do `HudHeader`. Isso cria diferenciação visual por módulo sem fragmentar a identidade geral (que permanece em teal). O container do ícone usa a classe `.ig-icon-jewel`.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/components/hud/HudHeader.tsx` (aceitar `iconTint`) |
| **Modificar** | `src/styles/glass.css` (adicionar `.ig-icon-jewel`) |
| **Aplicar** | Todas as rotas principais |

---

## Classe `.ig-icon-jewel` em `glass.css`

```css
/* ── Icon jewel ── */
.ig-icon-jewel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--ig-radius-md);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.18),
    inset 0 -1px 0 rgba(0,0,0,0.22),
    inset 0 0 0 1px rgba(255,255,255,0.06),
    0 4px 12px rgba(0,0,0,0.28),
    0 1px 2px rgba(0,0,0,0.40);
}
.ig-icon-jewel::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(170deg, rgba(255,255,255,0.18) 0%, transparent 50%);
  pointer-events: none;
  z-index: 1;
}
```

## `HudHeader.tsx` — aceitar `iconTint`

Verificar se `HudHeader` já tem prop `iconTint?: string`. Se não, adicionar e aplicar:

```tsx
// Na renderização do ícone, substituir o container atual por:
{icon && (
  <span
    className="ig-icon-jewel"
    style={{
      backgroundColor: iconTint
        ? `color-mix(in oklab, ${iconTint} 16%, var(--ig-bg-raised))`
        : 'var(--ig-accent-weak)',
      color: iconTint ?? 'var(--ig-accent)',
    }}
  >
    {icon}
  </span>
)}
```

## Mapa de `iconTint` por rota

Aplicar em todas as chamadas `<HudHeader>` de cada rota:

| Rota | icon (import lucide) | iconTint |
|---|---|---|
| `/dashboard` | `LayoutDashboard` | `var(--ig-accent)` |
| `/financeiro*` | `TrendingUp` | `#14B8A6` |
| `/projetos` | `FolderKanban` | `#10B981` |
| `/reunioes` | `CalendarDays` | `#3B82F6` |
| `/pautas` | `Gavel` | `#A855F7` |
| `/riscos` | `ShieldAlert` | `#F5A524` |
| `/contratos` | `FileSignature` | `#A855F7` |
| `/workforce-cost` | `Users` | `#10B981` |
| `/organograma` | `Network` | `#3B82F6` |
| `/configuracoes*` | `Settings` | `#64748B` |
| `/workflows` | `GitBranch` | `#A855F7` |
| `/relatorios` | `BarChart3` | `#3B82F6` |
| `/historico` | `History` | `#64748B` |
| `/atas` | `FileText` | `#14B8A6` |
| `/comites` | `Users2` | `#F5A524` |
| `/membros` | `UserCheck` | `#10B981` |
| `/roles` | `Lock` | `#EF4B55` |

---

## Acceptance criteria

- [ ] `.ig-icon-jewel` existe em `glass.css`.
- [ ] Cada `HudHeader` de módulo principal tem `icon` + `iconTint` corretos.
- [ ] Icon jewel tem highlight sutil no topo (`::before` gradiente).
- [ ] Em light mode, jewel usa cor mais escura da paleta (`color-mix` com `--ig-bg-raised`).
- [ ] `npm run build` passa.

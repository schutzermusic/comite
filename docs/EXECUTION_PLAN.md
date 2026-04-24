# INSIGHT Governança — Plano de Execução UI/UX Premium v2

> **Status:** READY FOR EXECUTION
> **Origem:** Auditoria UI/UX (abr/2026) + Sistema de Material Premium v2
> **Objetivo:** Transformar o produto em um SaaS executivo premium futurista com **um único design system**, **material glassmorfista em 5 elevações**, **tipografia executiva** e **identidade de marca unificada**, sem achatamento visual.
> **Princípio guiado:** sofisticar por estratificação, não por subtração.
> **Tempo estimado:** 6–8 semanas · 2 frontend + 1 designer dedicados.

---

## 0. Contexto compartilhado (leia antes de qualquer tarefa)

### 0.1 Stack
- Next.js 15.5 (App Router) · React 18 · TypeScript 5
- Tailwind 3.4 · Framer Motion · Radix UI · shadcn (em migração) · lucide-react
- ECharts + Nivo + Recharts · Cesium/deck.gl/three (somente Dashboard)
- next-intl (i18n) · react-hook-form + zod · Supabase (backend)

### 0.2 Diretórios-chave
```
src/
├─ app/(main)/          # rotas autenticadas
│  ├─ dashboard/        # Control Room (3D)
│  ├─ financeiro/       # overview + 7 subrotas
│  ├─ projetos/ contratos/ riscos/ reunioes/ pautas/
│  ├─ workforce-cost/ organograma/
│  └─ configuracoes/ workflows/ relatorios/ historico/ atas/ comites/ membros/ roles/
├─ components/
│  ├─ hud/              # DESIGN SYSTEM OFICIAL (manter e evoluir)
│  ├─ ui/               # shadcn (em depreciação)
│  ├─ dashboard/        # Control Room components
│  └─ [módulo]/         # componentes por módulo
├─ contexts/ThemeContext.tsx
├─ app/globals.css      # ≈6000 linhas — será dividido
└─ styles/tokens.css    # NOVO arquivo a criar
tailwind.config.ts
```

### 0.3 Estado atual (diagnóstico-resumo)
- **3 design systems convivem:** HUD Glass (oficial), Orion/HUDCard (legado), shadcn cru.
- **7 namespaces de cor** em `tailwind.config.ts`: `sentinel`, `orion`, `intel`, `insight`, `neon`, `executive`, `glass`.
- **Light mode é retrofit** — componentes HUD usam `text-white/*`, `bg-white/*` hardcoded.
- **Botão primário** atual: gradiente cyan→emerald com texto preto = estética gaming.
- **Sidebar**: 20+ ternários `isLight ? … : …`; itens em 10–11px uppercase.
- **Header global vazio**: só SidebarTrigger + ThemeToggle.
- **3 sistemas de toast** em uso simultâneo.
- **Configurações/Workflows/Relatórios/Histórico/Atas/Comitês**: ainda em design legado.
- **Reuniões**: strings hardcoded visíveis no UI.

### 0.4 Princípios de execução
1. **Nenhum componente HUD** pode conter `text-white`, `bg-white/[...]`, `border-white/[...]`, `text-black`, `text-cyan-*`, `text-emerald-*`, cor hex crua ou gradiente `cyan→emerald`.
2. **Uma cor primária só:** teal `#14B8A6` (dark) / `#0F766E` (light). Cyan, emerald, lime etc. saem como primárias.
3. **Prefixo único de tokens:** `--ig-*` (INSIGHT Governança).
4. **5 elevações** (`data-elev="1..5"`) — cada componente declara sua elevação.
5. **Light mode não é papel.** É vidro fosco pearl com edge teal escuro.
6. **Performance first:** nunca animar `backdrop-filter`; `contain: layout style paint` em painéis; respeitar `prefers-reduced-motion`.

### 0.5 Convenções de código
- TypeScript strict. Sem `any` em código novo (use `unknown` + narrowing).
- Imports em caminhos: `@/components/hud`, `@/lib/*`, `@/contexts/*`.
- Nenhum `console.log`.
- `export function NomeComponente(...)` (sem `default`) exceto páginas Next (`export default`).
- Commits: `feat(ds):`, `refactor(module):`, `fix(a11y):`, `chore(tokens):`.
- Cada PR fecha uma `TASK-XXX` e linka o ID no título.

### 0.6 Definition of Done (global)
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.
- [ ] `npm run build` passa sem warnings novos.
- [ ] Screenshots (dark + light) das telas afetadas anexados no PR.
- [ ] Nenhum hit novo de `text-white|bg-white/\[|border-white/\[|text-black|text-cyan-|text-emerald-|from-cyan.*to-emerald` em `src/app` e `src/components/hud` (exceto em componentes marcados `@deprecated`).
- [ ] `prefers-reduced-motion` respeitado em qualquer animação nova.
- [ ] A11y: contraste WCAG AA verificado (dark e light) nas mudanças feitas.

---

## 1. Mapa de fases e PRs

| Fase | Obj | PRs | Duração |
|---|---|---|---|
| **F0** · Foundation | Tokens + Tipografia + Atmosférico | PR-01, PR-02, PR-03 | 1 semana |
| **F1** · Material System v2 | 5 elevações + componentes-chave | PR-04, PR-05, PR-06 | 2 semanas |
| **F2** · Shell | Sidebar + Header global + Toaster | PR-07, PR-08, PR-09 | 1 semana |
| **F3** · Módulos vitrine | Configurações + Reuniões + Riscos | PR-10, PR-11, PR-12 | 2 semanas |
| **F4** · Migração legado | Workflows, Relatórios, Histórico, Atas, Comitês, Membros, Roles | PR-13, PR-14, PR-15 | 1 semana |
| **F5** · Identidade + Polish | Icon jewels, serial numbers, watermark, typography shine, perf | PR-16, PR-17, PR-18 | 1 semana |

**Ordem obrigatória:** F0 → F1 antes de qualquer outra coisa. Dentro de cada fase, PRs podem rodar em paralelo se marcados como independentes.

---

## 2. Lista completa de tarefas

| ID | Fase | PR | Depende de | Título |
|---|---|---|---|---|
| [TASK-001](./plan/TASK-001.md) | F0 | PR-01 | — | Criar sistema de tokens `--ig-*` |
| [TASK-002](./plan/TASK-002.md) | F0 | PR-02 | TASK-001 | Escala tipográfica executiva |
| [TASK-003](./plan/TASK-003.md) | F0 | PR-03 | TASK-001 | Background atmosférico + noise texture |
| [TASK-004](./plan/TASK-004.md) | F1 | PR-04 | TASK-001 | Classes `.ig-glass` de 5 elevações |
| [TASK-005](./plan/TASK-005.md) | F1 | PR-05 | TASK-004 | `HudPanel` v2 (API retrocompatível) |
| [TASK-006](./plan/TASK-006.md) | F1 | PR-06 | TASK-004, TASK-005 | Refactor light-mode-native nos componentes HUD |
| [TASK-007](./plan/TASK-007.md) | F2 | PR-07 | TASK-006 | Sidebar v2 (zero ternários, hierarquia) |
| [TASK-008](./plan/TASK-008.md) | F2 | PR-08 | TASK-006 | Header global premium |
| [TASK-009](./plan/TASK-009.md) | F2 | PR-09 | TASK-005 | `HudToaster` unificado |
| [TASK-010](./plan/TASK-010.md) | F3 | PR-10 | TASK-006, TASK-007, TASK-009 | Reconstruir módulo /configuracoes |
| [TASK-011](./plan/TASK-011.md) | F3 | PR-11 | TASK-006 | Reuniões — dados reais + timeline hoje |
| [TASK-012](./plan/TASK-012.md) | F3 | PR-12 | TASK-006 | Riscos — matriz + lista fundidas + score corporativo |
| [TASK-013](./plan/TASK-013.md) | F4 | PR-13 | TASK-006 | Migrar admin tranche 1 (workflows/relatorios/historico/atas) |
| [TASK-014](./plan/TASK-014.md) | F4 | PR-14 | TASK-006 | Migrar admin tranche 2 (comites/membros/roles) |
| [TASK-015](./plan/TASK-015.md) | F4 | PR-15 | TASK-012 | Migrar `risk-list` e `contract-list` para HudTable |
| [TASK-016](./plan/TASK-016.md) | F5 | PR-16 | TASK-005 | Icon jewels com `iconTint` por módulo |
| [TASK-017](./plan/TASK-017.md) | F5 | PR-17 | TASK-005 | Watermark + serial numbers |
| [TASK-018](./plan/TASK-018.md) | F5 | PR-18 | TASK-017 | Parallax + specular sweep + focus cinemático |
| [TASK-019](./plan/TASK-019.md) | F5 | PR-19 | TASK-002 | Typography shine (metallic text) |
| [TASK-020](./plan/TASK-020.md) | F5 | PR-20 | TASK-018 | Performance guardrails |
| [TASK-021](./plan/TASK-021.md) | F5 | PR-21 | TASK-013, TASK-014 | Depreciação final (purge legado) |

---

## 3. Matriz de dependências (Gantt textual)

```
W1     W2     W3     W4     W5     W6     W7     W8
 │      │      │      │      │      │      │      │
[001]──[002]────────────────────────────────────────
       [003]────────────────────────────────────────
 │     [004]──[005]──────────────────────────────────
              [006]───────────────────────────────────
                     [007]────────────────────────────
                     [008]────────────────────────────
                     [009]────────────────────────────
                            [010]────────────────────
                            [011]────────────────────
                            [012]────────────────────
                                   [013]─────────────
                                   [014]─────────────
                                   [015]─────────────
                                          [016]───────
                                          [017]───────
                                          [018]───────
                                          [019]───────
                                                 [020]
                                                 [021]
```

---

## 4. Prompt template para sub-agentes (Cursor Background Agent)

Ao despachar cada task para um agente no Cursor, use:

```
TASK: {TASK-XXX}
PROJECT: INSIGHT Governança Corporativa
PLAN FILE: docs/plan/TASK-XXX.md

Context: Leia inteiramente docs/EXECUTION_PLAN.md seções 0 e 0.4 + o arquivo docs/plan/TASK-XXX.md completo.

Before starting:
1. Run `npm run typecheck` and `npm run build` to confirm baseline is green.
2. Read ALL files listed in "Escopo de arquivos" for this TASK.
3. Confirm dependencies TASK-XXX already merged to main.

Do the work described in the TASK. Then:
- Open a PR titled "PR-XX: {title} [TASK-XXX]"
- Include screenshots dark + light of affected screens.
- Ensure ALL items in "Acceptance criteria" are checked.
- Run global DoD (docs/EXECUTION_PLAN.md section 0.6) checks.

HARD CONSTRAINTS (never break):
- Never use: text-white, bg-white/[...], border-white/[...], text-black, text-cyan-*, text-emerald-*, gradients cyan→emerald.
- Always handle prefers-reduced-motion in new animations.
- Never modify files outside the TASK "Escopo" section.
- Never introduce new dependencies unless the TASK explicitly allows it.

If blocked: leave a comment in the PR and tag @lead.
```

---

## 5. Métricas de sucesso ao final da F5

| Métrica | Baseline | Alvo |
|---|---|---|
| Namespaces de cor em `tailwind.config.ts` | 7 | 2 (`ig` + shadcn vars) |
| Ternários `isLight ?` em `src/components/hud` | 14+ | 0 |
| Ternários `isLight ?` em `src/components/layout` | 20+ | 0 |
| Hits `text-white / bg-white/[ / border-white/[` em HUD | 200+ | 0 |
| Sistemas de toast simultâneos | 3 | 1 |
| Páginas com `OrionGreenBackground` ou `HUDCard` | 5 | 0 |
| Tabelas usando `@/components/ui/table` em rotas | 2+ | 0 |
| Lighthouse Performance (Dashboard) | ? | ≥ 75 |
| Tamanho texto mínimo em sidebar | 10–11 px | 13 px |
| Módulos com serial number + watermark | 0 | ≥ 5 |
| Elevações materiais distintas | 1 (cr-glass-panel) | 5 |
| Light mode: contraste AA verificado | parcial | total nas rotas migradas |

---

## 6. Ordem de release recomendada

- **MVP interno (fim F1):** demo com Dashboard + Financeiro + Projetos no novo material.
- **Beta interno (fim F2):** shell novo, navegação completa.
- **Beta externo (fim F3):** 3 clientes piloto com Configurações + Reuniões + Riscos refeitos.
- **GA (fim F5):** produto inteiro migrado, performance validada, identidade consolidada.

---

## 7. Riscos + mitigações

| Risco | Mitigação |
|---|---|
| Regressão visual em rotas não auditadas durante purge (TASK-021) | PR-21 separado, com screenshot comparativo de cada rota principal. |
| `backdrop-filter` performa mal em Safari iPad | TASK-020 testa explicitamente; degradação via media query já prevista. |
| Mudança de `text-white` para `text-ig-fg-strong` quebrar contraste local | PR com `axe-core/react` nos componentes afetados. |
| Depreciação de `useToast` shadcn quebrar páginas não cobertas por grep | TASK-009 inclui grep global seguido de busca visual em cada rota listada no admin. |
| Framer Motion ficar pesado com 5 elevações × animações | Preferir CSS-only (`.ig-glass` usa apenas `transition` + `animation`). |
| `cmdk` conflitar com Radix Dialog | Usar `HudModal` wrapper (já isolado), nunca Radix Dialog raw. |

---

_Gerado em abr/2026 · versão 1.0_

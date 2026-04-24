# TASK-021 · Depreciação final (purge legado)

**Fase:** F5 — Identidade + Polish
**PR:** PR-21
**Dependências:** TASK-013, TASK-014, TASK-015
**Owner-profile:** Frontend Engineer / Tech Lead
**Estimativa:** 4–6h

---

## Contexto

Com todas as migrações concluídas, esta tarefa elimina os vestígios do design system legado: namespaces de cor duplicados em `tailwind.config.ts`, regras CSS obsoletas em `globals.css`, e arquivos de componentes depreciados. Resulta em uma base de código mais limpa e um `tailwind.config.ts` reduzido.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Deletar** | `src/components/ui/hud-card.tsx` |
| **Deletar** | `src/components/system/OrionGreenBackground*` |
| **Deletar (se não usado)** | `src/components/ui/card.tsx` |
| **Deletar (se não usado)** | `src/components/ui/table.tsx` |
| **Modificar** | `tailwind.config.ts` (remover namespaces legados) |
| **Modificar** | `src/app/globals.css` (remover regras legadas) |

---

## Passo 1 — Verificar dependências antes de deletar

```bash
# Verificar se card ainda é usado em algum lugar
grep -r "from \"@/components/ui/card\"" src/

# Verificar se table ainda é usado
grep -r "from \"@/components/ui/table\"" src/

# Verificar OrionGreenBackground
grep -r "OrionGreenBackground" src/

# Verificar HUDCard / hud-card
grep -r "HUDCard\|hud-card" src/
```

Deletar apenas os arquivos cujo grep retorna 0 matches.

---

## Passo 2 — Remover de `tailwind.config.ts`

Dentro de `theme.extend.colors`, remover inteiramente os namespaces:
- `sentinel`
- `orion`
- `intel`
- `insight` (exceto se usado em algo não-visual)
- `neon`
- `executive`
- `glass`

Dentro de `theme.extend.fontSize`, remover:
- `sentinel-*`
- `kpi-*` (substituído por `ig-kpi-*`)
- `label`, `caption`, `micro` (substituído por `ig-label`, `ig-caption`)

Dentro de `theme.extend.boxShadow`, remover:
- `sentinel-*`, `orion-*`, `neon-*`, `light-*`

Dentro de `theme.extend.backgroundImage`, remover:
- `sentinel-*`, `orion-*`, `glass-*`

> **Regra de segurança:** Antes de remover cada item, rodar `grep -r "sentinel-\|orion-\|neon-\|executive-" src/` e confirmar 0 hits.

---

## Passo 3 — Limpar `globals.css`

Identificar e remover:
- Todas as regras `.cr-glass-panel*` (substituídas por `.ig-glass`).
- Regras com `html.light .cr-glass-panel *`.
- Custom properties `--sentinel-*`, `--orion-*`, `--intel-*` duplicadas (manter apenas `--ig-*`).
- Blocos `.orion-page`, `.sentinel-*`, `.hud-old-*` se existirem.
- Overrides de Nivo tooltips que usam cores legadas.

Método seguro: buscar cada classe e variável antes de remover.

---

## Passo 4 — Verificação final

```bash
# Nenhum desses deve ter hits em src/app/ e src/components/hud/
grep -rE "sentinel|orion|intel|insight-|neon-|executive-|HUDCard|OrionGreenBackground|cr-glass-panel" src/app/ src/components/hud/

# globals.css deve ter reduzido em ≥ 30%
wc -l src/app/globals.css

# tailwind.config.ts deve ter reduzido em ≥ 40%
wc -l tailwind.config.ts
```

---

## Acceptance criteria

- [ ] `grep` acima retorna 0 em `src/app/` e `src/components/hud/`.
- [ ] `tailwind.config.ts` reduzido em ≥ 40% de linhas vs. baseline.
- [ ] `globals.css` reduzido em ≥ 30% de linhas vs. baseline.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.
- [ ] `npm run build` passa sem warnings.
- [ ] Screenshot comparativo (antes/depois) de cada rota principal — confirmar sem regressão visual.
- [ ] Teste em Safari e Chrome dark + light.

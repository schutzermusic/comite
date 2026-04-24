# TASK-012 · Riscos — matriz + lista fundidas + score corporativo

**Fase:** F3 — Módulos vitrine
**PR:** PR-12
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-010, TASK-011
**Owner-profile:** Full-stack Engineer
**Estimativa:** 6–8h

---

## Contexto

`/riscos` usa `@/components/ui/table` para a lista e a matriz não tem interação com a lista. Esta tarefa: (1) migra a lista para `HudTable`, (2) adiciona seleção cruzada matriz↔lista, (3) cria função `computeCorporateRiskScore`, (4) exibe o score no `HudHeader`.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `src/lib/risk-score.ts` |
| **Reescrever** | `src/components/risks/risk-list.tsx` |
| **Modificar** | `src/components/risks/risk-matrix.tsx` |
| **Reescrever** | `src/app/(main)/riscos/page.tsx` |

---

## `src/lib/risk-score.ts`

```ts
import type { Risk } from "@/lib/types";

const SEVERITY_WEIGHTS: Record<Risk['severity'], number> = {
  critical: 5,
  high:     3,
  medium:   1.5,
  low:      0.5,
};

/**
 * Retorna score corporativo de 0–10.
 * Pondera riscos abertos por severidade, normalizado pela contagem.
 */
export function computeCorporateRiskScore(risks: Risk[]): number {
  const open = risks.filter((r) => r.status !== 'resolved' && r.status !== 'closed');
  if (open.length === 0) return 0;

  const raw = open.reduce((sum, r) => sum + (SEVERITY_WEIGHTS[r.severity] ?? 0), 0);
  const normalized = Math.min(10, raw / Math.max(1, open.length / 2));
  return Math.round(normalized * 10) / 10;
}

export function scoreVariant(score: number): 'success' | 'warning' | 'critical' {
  if (score >= 7) return 'critical';
  if (score >= 4) return 'warning';
  return 'success';
}
```

---

## `risk-matrix.tsx` — props adicionais

Adicionar às props existentes:
```ts
interface RiskMatrixProps {
  // ... props existentes
  onCellClick?: (prob: number, impact: number) => void;
  highlightedCell?: { prob: number; impact: number } | null;
}
```

Ao clicar em uma célula, chamar `onCellClick(prob, impact)`.
Célula com `highlightedCell` correspondente recebe `data-selected="true"` e borda `border-ig-accent`.

---

## `risk-list.tsx` — usar HudTable

```tsx
// src/components/risks/risk-list.tsx
"use client";
import { HudTable, type HudTableColumn } from "@/components/hud/HudTable";
import { HudStatusPill } from "@/components/hud/HudStatusPill";
import type { Risk } from "@/lib/types";

const SEVERITY_LABELS: Record<Risk['severity'], string> = {
  critical: 'Crítico',
  high:     'Alto',
  medium:   'Médio',
  low:      'Baixo',
};

const SEVERITY_VARIANTS: Record<Risk['severity'], 'critical'|'warning'|'default'|'success'> = {
  critical: 'critical',
  high:     'warning',
  medium:   'default',
  low:      'success',
};

interface Props {
  risks: Risk[];
  onRowClick?: (risk: Risk) => void;
  highlightedIds?: string[];
}

export function RiskList({ risks, onRowClick, highlightedIds }: Props) {
  const columns: HudTableColumn<Risk>[] = [
    {
      key: 'titulo',
      header: 'Risco',
      render: (r) => (
        <span className="text-ig-body-sm text-ig-fg-strong font-medium">{r.titulo}</span>
      ),
    },
    {
      key: 'severity',
      header: 'Severidade',
      width: 120,
      render: (r) => (
        <HudStatusPill variant={SEVERITY_VARIANTS[r.severity]}>
          {SEVERITY_LABELS[r.severity]}
        </HudStatusPill>
      ),
    },
    {
      key: 'probabilidade',
      header: 'Prob.',
      width: 80,
      render: (r) => (
        <span className="text-ig-body-sm text-ig-fg-muted ig-tabular">{r.probabilidade}/5</span>
      ),
    },
    {
      key: 'impacto',
      header: 'Impacto',
      width: 80,
      render: (r) => (
        <span className="text-ig-body-sm text-ig-fg-muted ig-tabular">{r.impacto}/5</span>
      ),
    },
    {
      key: 'responsavel',
      header: 'Responsável',
      render: (r) => (
        <span className="text-ig-body-sm text-ig-fg-muted">{r.responsavel ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (r) => (
        <span className="text-ig-caption text-ig-fg-muted capitalize">{r.status}</span>
      ),
    },
  ];

  return (
    <HudTable
      columns={columns}
      data={risks}
      onRowClick={onRowClick}
      rowClassName={(r) =>
        highlightedIds?.includes(r.id) ? "bg-ig-accent-weak" : ""
      }
      emptyMessage="Nenhum risco encontrado."
    />
  );
}
```

---

## `/riscos/page.tsx`

```tsx
"use client";
import { useState, useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudFilterBar } from "@/components/hud/HudFilterBar";
import { HudKpiStrip } from "@/components/hud/HudKpiStrip";
import { RiskMatrix } from "@/components/risks/risk-matrix";
import { RiskList } from "@/components/risks/risk-list";
import { computeCorporateRiskScore, scoreVariant } from "@/lib/risk-score";
import { mockRisks } from "@/lib/mock-data";

export default function RiscosPage() {
  const [selectedCell, setSelectedCell] = useState<{ prob: number; impact: number } | null>(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  const filtered = useMemo(() => {
    return mockRisks.filter((r) => {
      const matchSearch = !search || r.titulo.toLowerCase().includes(search.toLowerCase());
      const matchSeverity = severityFilter === "all" || r.severity === severityFilter;
      return matchSearch && matchSeverity;
    });
  }, [search, severityFilter]);

  const cellFiltered = useMemo(() => {
    if (!selectedCell) return filtered;
    return filtered.filter(
      (r) => r.probabilidade === selectedCell.prob && r.impacto === selectedCell.impact
    );
  }, [filtered, selectedCell]);

  const score = computeCorporateRiskScore(mockRisks);
  const variant = scoreVariant(score);

  return (
    <HudPageLayout>
      <HudHeader
        title="Riscos"
        subtitle="Matriz corporativa de exposição a riscos"
        icon={<ShieldAlert size={18} />}
        iconTint="#F5A524"
        statusChips={[
          {
            label: `Score ${score.toFixed(1)}`,
            variant,
          },
        ]}
      />

      <HudKpiStrip
        items={[
          { label: "Total de riscos", value: mockRisks.length },
          { label: "Críticos", value: mockRisks.filter(r => r.severity === 'critical').length, variant: 'critical' },
          { label: "Altos", value: mockRisks.filter(r => r.severity === 'high').length, variant: 'warning' },
          { label: "Score corporativo", value: score.toFixed(1), variant },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <HudPanel elevation={2} title="Matriz 5×5">
          <RiskMatrix
            risks={filtered}
            onCellClick={setSelectedCell}
            highlightedCell={selectedCell}
          />
          {selectedCell && (
            <button
              onClick={() => setSelectedCell(null)}
              className="mt-3 text-ig-caption text-ig-fg-muted hover:text-ig-accent transition-colors"
            >
              Limpar filtro de célula
            </button>
          )}
        </HudPanel>

        <HudPanel elevation={2} title="Lista de Riscos">
          <HudFilterBar
            search={search}
            onSearchChange={setSearch}
            filters={[
              {
                id: "severity",
                label: "Severidade",
                value: severityFilter,
                onChange: setSeverityFilter,
                options: [
                  { value: "all", label: "Todas" },
                  { value: "critical", label: "Crítico" },
                  { value: "high", label: "Alto" },
                  { value: "medium", label: "Médio" },
                  { value: "low", label: "Baixo" },
                ],
              },
            ]}
          />
          <RiskList
            risks={cellFiltered}
            highlightedIds={selectedCell ? cellFiltered.map(r => r.id) : []}
          />
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
```

---

## Acceptance criteria

- [ ] Click em célula da matriz filtra a lista (mostra apenas riscos daquela célula prob×impacto).
- [ ] Célula selecionada recebe destaque visual (`data-selected`).
- [ ] "Limpar filtro" desfaz a seleção.
- [ ] `RiskList` não importa mais `@/components/ui/table`.
- [ ] Chip de score visível no `HudHeader` com cor semântica correta.
- [ ] Desktop: matriz + lista lado a lado.
- [ ] `npm run build` passa.

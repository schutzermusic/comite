"use client";

import { useMemo, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle, ShieldAlert, TrendingUp } from "lucide-react";
import { HudFilterBar, HudHeader, HudKpiStrip, HudPageLayout, HudPanel } from "@/components/hud";
import type { FilterGroup, KpiItem } from "@/components/hud";
import { RiskList } from "@/components/risks/risk-list";
import { RiskMatrix } from "@/components/risks/risk-matrix";
import { computeCorporateRiskScore, scoreVariant } from "@/lib/risk-score";
import type { Risk } from "@/lib/types";

const mockRisks: Risk[] = [
  {
    id: "1",
    title: "Risco de Atraso em Projeto Crítico",
    description: "Projeto de infraestrutura com potencial de atraso devido a falta de recursos.",
    category: "Operational",
    probability: 4,
    impact: 5,
    level: 20,
    severity: "critical",
    origin: "project",
    referenceId: "proj-123",
    responsibleName: "PMO Corporativo",
    status: "open",
    createdAt: new Date("2024-01-10"),
    updatedAt: new Date("2024-01-10"),
  },
  {
    id: "2",
    title: "Exposição Cambial em Contrato Internacional",
    description: "Variação cambial pode impactar negativamente o valor do contrato.",
    category: "Financial",
    probability: 3,
    impact: 4,
    level: 12,
    severity: "high",
    origin: "contract",
    referenceId: "contract-456",
    responsibleName: "Tesouraria",
    status: "mitigating",
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-25"),
  },
  {
    id: "3",
    title: "Não Conformidade com LGPD",
    description: "Processos de tratamento de dados pessoais não atendem requisitos da LGPD.",
    category: "Legal",
    probability: 2,
    impact: 5,
    level: 10,
    severity: "medium",
    origin: "manual",
    responsibleName: "Jurídico",
    status: "open",
    createdAt: new Date("2024-01-20"),
    updatedAt: new Date("2024-01-20"),
  },
  {
    id: "4",
    title: "Cláusula Contratual Desfavorável",
    description: "Contrato com fornecedor contém penalidades elevadas.",
    category: "Contractual",
    probability: 4,
    impact: 4,
    level: 16,
    severity: "critical",
    origin: "contract",
    referenceId: "contract-789",
    responsibleName: "Suprimentos",
    status: "open",
    createdAt: new Date("2024-01-22"),
    updatedAt: new Date("2024-01-22"),
  },
  {
    id: "5",
    title: "Falta de Auditoria Interna",
    description: "Ausência de controles de auditoria pode gerar problemas de compliance.",
    category: "Compliance",
    probability: 3,
    impact: 3,
    level: 9,
    severity: "medium",
    origin: "manual",
    responsibleName: "Auditoria",
    status: "resolved",
    createdAt: new Date("2024-01-05"),
    updatedAt: new Date("2024-01-28"),
  },
];

export default function RiscosPage() {
  const [selectedCell, setSelectedCell] = useState<{ prob: number; impact: number } | null>(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return mockRisks.filter((risk) => {
      const matchSearch =
        !normalizedSearch ||
        risk.title.toLowerCase().includes(normalizedSearch) ||
        risk.description.toLowerCase().includes(normalizedSearch);
      const matchSeverity = severityFilter === "all" || risk.severity === severityFilter;
      return matchSearch && matchSeverity;
    });
  }, [search, severityFilter]);

  const cellFiltered = useMemo(() => {
    if (!selectedCell) return filtered;
    return filtered.filter(
      (risk) => risk.probability === selectedCell.prob && risk.impact === selectedCell.impact,
    );
  }, [filtered, selectedCell]);

  const score = computeCorporateRiskScore(mockRisks);
  const variant = scoreVariant(score);
  const kpiVariant = variant === "critical" ? "danger" : variant;

  const filterGroups: FilterGroup[] = [
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
  ];

  const kpis: KpiItem[] = [
    {
      id: "total",
      label: "Total de riscos",
      value: mockRisks.length,
      variant: "info",
      icon: <ShieldAlert className="h-5 w-5" />,
    },
    {
      id: "critical",
      label: "Críticos",
      value: mockRisks.filter((risk) => risk.severity === "critical").length,
      variant: "danger",
      icon: <AlertCircle className="h-5 w-5" />,
    },
    {
      id: "high",
      label: "Altos",
      value: mockRisks.filter((risk) => risk.severity === "high").length,
      variant: "warning",
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      id: "score",
      label: "Score corporativo",
      value: score.toFixed(1),
      variant: kpiVariant,
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      id: "resolved",
      label: "Resolvidos",
      value: mockRisks.filter((risk) => risk.status === "resolved").length,
      variant: "success",
      icon: <CheckCircle className="h-5 w-5" />,
    },
  ];

  const clearCellFilter = () => setSelectedCell(null);

  return (
    <HudPageLayout>
      <HudHeader
        title="Riscos"
        subtitle="Matriz corporativa de exposição a riscos"
        icon={<ShieldAlert className="h-5 w-5" />}
        iconTint="#F5A524"
        breadcrumbs={[{ label: "Riscos" }]}
        statusChips={[{ label: `Score ${score.toFixed(1)}`, variant }]}
      />

      <HudKpiStrip kpis={kpis} columns={6} className="mb-6" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
        <HudPanel elevation={2} title="Matriz 5x5" subtitle="Clique em uma célula para filtrar a lista">
          <RiskMatrix
            risks={filtered}
            onCellClick={(prob, impact) => setSelectedCell({ prob, impact })}
            highlightedCell={selectedCell}
          />
          {selectedCell && (
            <button
              type="button"
              onClick={clearCellFilter}
              className="mt-4 text-ig-caption text-ig-fg-muted transition-colors hover:text-ig-accent"
            >
              Limpar filtro de célula
            </button>
          )}
        </HudPanel>

        <HudPanel elevation={2} title="Lista de Riscos" subtitle={`${cellFiltered.length} risco(s) no recorte atual`}>
          <div className="space-y-4">
            <HudFilterBar
              compact
              searchPlaceholder="Buscar riscos..."
              searchValue={search}
              onSearchChange={setSearch}
              filterGroups={filterGroups}
              activeFiltersCount={severityFilter === "all" ? 0 : 1}
              onClearFilters={() => setSeverityFilter("all")}
            />
            <RiskList
              risks={cellFiltered}
              highlightedIds={selectedCell ? cellFiltered.map((risk) => risk.id) : []}
            />
          </div>
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowLeftRight, BarChart3, Boxes, BrainCircuit, CheckCircle2,
  ChevronDown, Clock, Disc3, FileDown, Flame, Gauge, Layers, ListChecks, Percent,
  Plus, Radar, ShieldAlert, ShieldCheck, Sparkles, Target, TrendingUp, X,
} from "lucide-react";
import {
  HudButton, HudEmptyState, HudFilterBar, HudHeader, HudPageLayout, HudPanel,
} from "@/components/hud";
import type { FilterGroup } from "@/components/hud";
import {
  RiskMatrix5x5,
  RiskMitigationPipeline,
  RiskStatusPipeline,
  RiskTable,
  RiskDetailDrawer,
  RiskKpiGrid,
  RiskInsightStrip,
  SeverityDonutWithLegend,
  RiskExposureTrendChart,
  CategoryDistributionChart,
  TopRiskOwnersChart,
  RiskAreaExposureChart,
  RiskWaterfallChart,
  RiskBubbleChart,
  RiskHeatmapChart,
  DEMO_RISKS,
  DEMO_TREND,
  computeRiskSummary,
  computeSeverityDistribution,
  computeCategoryDistribution,
  computeOwnerDistribution,
  computeDomainExposure,
  computeWaterfall,
  computeHeatmap,
  computeBubble,
  computePipeline,
  computeExposureTrend,
  computeInsights,
  distinctOwners,
  distinctAreas,
  distinctCategories,
  riskExposure,
  isOverdue,
  hasActionPlan,
  riskToFunnelStage,
  computeAging,
  fmtDateShort,
  categoryToDomain,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from "@/components/risks";
import type { RiskKpiCardData, ExtendedRisk, FunnelStage } from "@/components/risks";
import { scoreVariant } from "@/lib/risk-score";
import { useRisks } from "@/hooks/use-risks";
import { usePermissions } from "@/hooks/use-permissions";
import { useHudToast } from "@/hooks/useHudToast";

/* ═══════════════════════════════════════════════════════════════
   COCKPIT EXECUTIVO DE RISCOS
   ═══════════════════════════════════════════════════════════════ */

const PERIOD_DAYS: Record<string, number | null> = {
  all: null, "30": 30, "90": 90, "180": 180, "365": 365,
};

function deltaPct(curr: number, prev: number): number {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export default function RiscosPage() {
  /* ── Data ── */
  const { risks: allRisks, loading, error, dismissAiRisk, refresh } = useRisks();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const toast = useHudToast();
  const canView = hasPermission("risks.view");
  const canDismissAi = hasPermission("risks.ai_dismiss");

  /* ── Demo data fallback / preview ── */
  const [demoPreview, setDemoPreview] = useState(false);
  const usingDemo = !loading && !error && (allRisks.length === 0 || demoPreview);
  const sourceRisks = usingDemo ? DEMO_RISKS : allRisks;

  /* ── Scope (Todos / Alertas IA / Descartados) ── */
  const [scopeFilter, setScopeFilter] = useState<"all" | "ai" | "dismissed">("all");
  const scoped = useMemo(() => {
    if (scopeFilter === "ai") return sourceRisks.filter((r) => r.origin === "ai" && !r.aiDismissed);
    if (scopeFilter === "dismissed") return sourceRisks.filter((r) => r.aiDismissed === true);
    return sourceRisks.filter((r) => !r.aiDismissed);
  }, [sourceRisks, scopeFilter]);

  const aiAlertCount = useMemo(
    () => sourceRisks.filter((r) => r.origin === "ai" && !r.aiDismissed).length,
    [sourceRisks],
  );

  /* ── Detail-level filter state ── */
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [noPlanOnly, setNoPlanOnly] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ prob: number; impact: number } | null>(null);
  const [selectedStage, setSelectedStage] = useState<FunnelStage | null>(null);

  /* ── Drawer + table ── */
  const [detailRisk, setDetailRisk] = useState<ExtendedRisk | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  /* ── Dashboard analytics (scope-level) ── */
  const summary = useMemo(() => computeRiskSummary(scoped), [scoped]);
  const trend = useMemo(() => (usingDemo ? DEMO_TREND : computeExposureTrend(scoped, 6)), [scoped, usingDemo]);
  const insights = useMemo(() => computeInsights(scoped, trend), [scoped, trend]);
  const severityData = useMemo(() => computeSeverityDistribution(scoped), [scoped]);
  const categoryData = useMemo(() => computeCategoryDistribution(scoped), [scoped]);
  const ownerData = useMemo(() => computeOwnerDistribution(scoped), [scoped]);
  const domainData = useMemo(() => computeDomainExposure(scoped), [scoped]);
  const waterfallData = useMemo(() => computeWaterfall(scoped), [scoped]);
  const heatmapData = useMemo(() => computeHeatmap(scoped), [scoped]);
  const bubbleData = useMemo(() => computeBubble(scoped), [scoped]);
  const pipeline = useMemo(() => computePipeline(scoped), [scoped]);

  const variant = scoreVariant(summary.score);
  const posture = summary.score >= 7 ? "Crítica" : summary.score >= 4 ? "Elevada" : "Controlada";
  const health = Math.max(0, Math.min(100, Math.round(100 - summary.score * 10)));

  /* ── Filter option lists ── */
  const ownerOptions = useMemo(() => distinctOwners(scoped), [scoped]);
  const areaOptions = useMemo(() => distinctAreas(scoped), [scoped]);
  const categoryOptions = useMemo(() => distinctCategories(scoped), [scoped]);

  /* ── Detail table risks (respect all filters + drill selections) ── */
  const tableRisks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const periodCut = PERIOD_DAYS[periodFilter];
    return scoped.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q) && !(r.responsibleName ?? "").toLowerCase().includes(q)) return false;
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (ownerFilter !== "all" && r.responsibleName !== ownerFilter) return false;
      if (areaFilter !== "all" && r.area !== areaFilter) return false;
      if (linkFilter === "project" && r.origin !== "project") return false;
      if (linkFilter === "contract" && r.origin !== "contract") return false;
      if (linkFilter === "none" && !!r.referenceName) return false;
      if (periodCut !== null && computeAging(r.createdAt) > periodCut) return false;
      if (overdueOnly && !isOverdue(r)) return false;
      if (noPlanOnly && (hasActionPlan(r) || r.status === "resolved")) return false;
      if (selectedCell && (r.probability !== selectedCell.prob || r.impact !== selectedCell.impact)) return false;
      if (selectedStage && riskToFunnelStage(r) !== selectedStage) return false;
      return true;
    });
  }, [scoped, search, severityFilter, statusFilter, categoryFilter, ownerFilter, areaFilter, linkFilter, periodFilter, overdueOnly, noPlanOnly, selectedCell, selectedStage]);

  /* ── KPI cards ── */
  const totalSpark = trend.map((t) => t.critical + t.high + t.medium);
  const criticalSpark = trend.map((t) => t.critical);
  const highSpark = trend.map((t) => t.high);
  const mediumSpark = trend.map((t) => t.medium);
  const scoreSpark = trend.map((t) => t.score ?? 0);
  const lastTwo = (arr: number[]) => (arr.length >= 2 ? [arr[arr.length - 2], arr[arr.length - 1]] : [0, 0]);

  const kpiCards: RiskKpiCardData[] = [
    { id: "total", label: "Total de riscos", value: summary.total, icon: <ShieldAlert className="h-4 w-4" />, tone: "info", spark: totalSpark, delta: deltaPct(...(lastTwo(totalSpark).reverse() as [number, number])), help: "Riscos no recorte atual (escopo selecionado)." },
    { id: "critical", label: "Críticos", value: summary.critical, icon: <AlertCircle className="h-4 w-4" />, tone: "danger", spark: criticalSpark, delta: deltaPct(...(lastTwo(criticalSpark).reverse() as [number, number])), help: "Severidade crítica (score ≥ 16)." },
    { id: "high", label: "Altos", value: summary.high, icon: <TrendingUp className="h-4 w-4" />, tone: "warning", spark: highSpark, delta: deltaPct(...(lastTwo(highSpark).reverse() as [number, number])), help: "Severidade alta (score 12–15)." },
    { id: "medium", label: "Médios", value: summary.medium, icon: <Layers className="h-4 w-4" />, tone: "info", spark: mediumSpark, help: "Severidade média (score 7–11)." },
    { id: "mitigating", label: "Em mitigação", value: summary.mitigating, icon: <Activity className="h-4 w-4" />, tone: "warning", help: "Riscos com mitigação em andamento." },
    { id: "resolved", label: "Resolvidos", value: summary.resolved, icon: <CheckCircle2 className="h-4 w-4" />, tone: "success", upIsGood: true, help: "Riscos encerrados no período." },
    { id: "aging", label: "Aging médio", value: summary.avgAging, suffix: "d", icon: <Clock className="h-4 w-4" />, tone: summary.avgAging > 60 ? "danger" : summary.avgAging > 30 ? "warning" : "success", help: "Tempo médio em aberto dos riscos ativos." },
    { id: "score", label: "Score corporativo", value: summary.score.toFixed(1), icon: <Gauge className="h-4 w-4" />, tone: variant === "critical" ? "danger" : variant, spark: scoreSpark, delta: deltaPct(...(lastTwo(scoreSpark).reverse() as [number, number])), help: "Índice corporativo de exposição (0–10)." },
    { id: "plan", label: "% com plano", value: summary.withPlanPct, suffix: "%", icon: <ListChecks className="h-4 w-4" />, tone: summary.withPlanPct >= 70 ? "success" : "warning", upIsGood: true, help: "Riscos ativos com plano de ação definido." },
    { id: "ontime", label: "% mitig. no prazo", value: summary.onTimePct, suffix: "%", icon: <Percent className="h-4 w-4" />, tone: summary.onTimePct >= 80 ? "success" : summary.onTimePct >= 60 ? "warning" : "danger", upIsGood: true, help: "Riscos com prazo que não estão em atraso." },
  ];

  /* ── Filter bar ── */
  const filterGroups: FilterGroup[] = [
    { id: "period", label: "Período", value: periodFilter, onChange: setPeriodFilter, options: [{ value: "all", label: "Todo período" }, { value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }, { value: "180", label: "6 meses" }, { value: "365", label: "12 meses" }] },
    { id: "severity", label: "Severidade", value: severityFilter, onChange: setSeverityFilter, options: [{ value: "all", label: "Todas" }, { value: "critical", label: "Crítico" }, { value: "high", label: "Alto" }, { value: "medium", label: "Médio" }, { value: "low", label: "Baixo" }] },
    { id: "status", label: "Status", value: statusFilter, onChange: setStatusFilter, options: [{ value: "all", label: "Todos" }, { value: "open", label: "Aberto" }, { value: "mitigating", label: "Mitigando" }, { value: "resolved", label: "Resolvido" }] },
    { id: "category", label: "Domínio", value: categoryFilter, onChange: setCategoryFilter, options: [{ value: "all", label: "Todos" }, ...categoryOptions] },
    { id: "owner", label: "Responsável", value: ownerFilter, onChange: setOwnerFilter, options: [{ value: "all", label: "Todos" }, ...ownerOptions.map((o) => ({ value: o, label: o }))] },
    { id: "area", label: "Área", value: areaFilter, onChange: setAreaFilter, options: [{ value: "all", label: "Todas" }, ...areaOptions.map((a) => ({ value: a, label: a }))] },
    { id: "link", label: "Vínculo", value: linkFilter, onChange: setLinkFilter, options: [{ value: "all", label: "Todos" }, { value: "project", label: "Projeto" }, { value: "contract", label: "Contrato" }, { value: "none", label: "Sem vínculo" }] },
  ];

  const activeFiltersCount =
    [severityFilter, statusFilter, categoryFilter, ownerFilter, areaFilter, linkFilter, periodFilter].filter((v) => v !== "all").length +
    (overdueOnly ? 1 : 0) + (noPlanOnly ? 1 : 0) + (selectedCell ? 1 : 0) + (selectedStage ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setSeverityFilter("all"); setStatusFilter("all"); setCategoryFilter("all");
    setOwnerFilter("all"); setAreaFilter("all"); setLinkFilter("all"); setPeriodFilter("all");
    setOverdueOnly(false); setNoPlanOnly(false); setSelectedCell(null); setSelectedStage(null); setSearch("");
  }, []);

  /* ── Quick chips ── */
  interface Chip { id: string; label: string; active: boolean; onClick: () => void; tone: "danger" | "warning" | "info" | "success" | "accent" }
  const chips: Chip[] = [
    { id: "crit", label: "Críticos", tone: "danger", active: severityFilter === "critical", onClick: () => { setSeverityFilter(severityFilter === "critical" ? "all" : "critical"); setTableOpen(true); } },
    { id: "high", label: "Altos", tone: "warning", active: severityFilter === "high", onClick: () => { setSeverityFilter(severityFilter === "high" ? "all" : "high"); setTableOpen(true); } },
    { id: "overdue", label: "Em atraso", tone: "danger", active: overdueOnly, onClick: () => { setOverdueOnly((v) => !v); setTableOpen(true); } },
    { id: "noplan", label: "Sem plano de ação", tone: "warning", active: noPlanOnly, onClick: () => { setNoPlanOnly((v) => !v); setTableOpen(true); } },
    { id: "mit", label: "Em mitigação", tone: "info", active: statusFilter === "mitigating", onClick: () => { setStatusFilter(statusFilter === "mitigating" ? "all" : "mitigating"); setTableOpen(true); } },
    { id: "res", label: "Resolvidos", tone: "success", active: statusFilter === "resolved", onClick: () => { setStatusFilter(statusFilter === "resolved" ? "all" : "resolved"); setTableOpen(true); } },
    { id: "ai", label: "IA detectados", tone: "accent", active: scopeFilter === "ai", onClick: () => setScopeFilter(scopeFilter === "ai" ? "all" : "ai") },
  ];

  /* ── Handlers ── */
  const handleCellClick = (prob: number, impact: number) => {
    setSelectedCell((cur) => (cur && cur.prob === prob && cur.impact === impact ? null : { prob, impact }));
    setSelectedStage(null);
    setTableOpen(true);
  };
  const handleStageClick = (stage: FunnelStage) => {
    setSelectedStage((cur) => (cur === stage ? null : stage));
    setSelectedCell(null);
    setTableOpen(true);
  };
  const handleStatusClick = (status: string) => setStatusFilter(status === statusFilter ? "all" : status);

  const handleDismissAi = useCallback(
    async (risk: ExtendedRisk, reason?: string) => {
      if (!risk || risk.origin !== "ai" || risk.aiDismissed) return;
      setDismissingId(risk.id);
      try {
        await dismissAiRisk(risk.id, reason);
        setDetailRisk(null);
        await refresh();
      } finally {
        setDismissingId(null);
      }
    },
    [dismissAiRisk, refresh],
  );

  const handleExport = useCallback(() => {
    try {
      const headers = ["ID", "Título", "Severidade", "Prob", "Impacto", "Score", "Domínio", "Responsável", "Status", "Prazo", "Aging(d)", "Exposição(R$)", "Vínculo"];
      const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const rows = tableRisks.map((r) => [
        r.id, r.title, SEVERITY_LABELS[r.severity], r.probability, r.impact, r.level,
        categoryToDomain(r.category), r.responsibleName ?? "", STATUS_LABELS[r.status],
        fmtDateShort(r.dueDate), computeAging(r.createdAt), riskExposure(r), r.referenceName ?? "",
      ].map(escape).join(";"));
      const csv = "﻿" + [headers.map(escape).join(";"), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `riscos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Relatório exportado", `${tableRisks.length} risco(s) em CSV.`);
    } catch {
      toast.error("Falha ao exportar", "Não foi possível gerar o relatório.");
    }
  }, [tableRisks, toast]);

  const handleViewCritical = () => {
    setSeverityFilter("critical");
    setSelectedCell(null); setSelectedStage(null);
    setTableOpen(true);
  };
  const handleAnalyzeAi = () => {
    setScopeFilter("ai");
    toast.notify("Recorte de IA aplicado", { description: aiAlertCount ? `${aiAlertCount} alerta(s) de IA ativo(s).` : "Nenhum alerta de IA ativo no momento.", variant: "info" });
  };

  const actionToast = (label: string) => (risk: ExtendedRisk) =>
    toast.notify(label, { description: risk.title, variant: "info" });

  /* ── Gates ── */
  if (!permissionsLoading && !canView) {
    return (
      <HudPageLayout maxWidth="2xl">
        <HudPanel elevation={2}>
          <HudEmptyState icon="alert" title="Acesso restrito" description="Visualizar riscos requer a permissão risks.view." compact />
        </HudPanel>
      </HudPageLayout>
    );
  }
  if (loading) {
    return (
      <HudPageLayout maxWidth="2xl">
        <HudPanel elevation={2}>
          <HudEmptyState icon="package" title="Carregando riscos…" description="Sincronizando dados com o servidor." compact />
        </HudPanel>
      </HudPageLayout>
    );
  }
  if (error) {
    return (
      <HudPageLayout maxWidth="2xl">
        <HudPanel elevation={2}>
          <HudEmptyState icon="alert" title="Erro ao carregar riscos" description={error} compact />
        </HudPanel>
      </HudPageLayout>
    );
  }

  const chipToneClass = (tone: Chip["tone"], active: boolean) => {
    const base = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-all";
    if (!active) return `${base} border-ig-border-subtle bg-ig-raised text-ig-fg-muted hover:border-ig-border-strong hover:text-ig-fg-strong`;
    const map: Record<Chip["tone"], string> = {
      danger: "border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] text-ig-danger",
      warning: "border-[color-mix(in_oklab,var(--ig-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning",
      info: "border-[color-mix(in_oklab,var(--ig-info)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_14%,transparent)] text-ig-info",
      success: "border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success",
      accent: "border-ig-accent bg-ig-accent-weak text-ig-accent",
    };
    return `${base} ${map[tone]}`;
  };

  return (
    <HudPageLayout maxWidth="2xl">
      {/* ── HEADER ── */}
      <HudHeader
        title="Riscos"
        subtitle="Mapa corporativo de exposição, mitigação e responsáveis"
        icon={<ShieldAlert className="h-5 w-5" />}
        iconTint="#F5A524"
        breadcrumbs={[{ label: "Governança", href: "/dashboard" }, { label: "Riscos" }]}
        statusChips={[
          { label: `Score ${summary.score.toFixed(1)}`, variant },
          { label: `Postura ${posture}`, variant: variant === "critical" ? "critical" : variant === "warning" ? "warning" : "success" },
          { label: `Saúde ${health}%`, variant: health >= 70 ? "success" : health >= 40 ? "warning" : "critical" },
          { label: "Período · 6 meses", variant: "neutral" },
          ...(usingDemo ? [{ label: "dados demonstrativos", variant: "warning" as const }] : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1 rounded-full border border-ig-border-subtle bg-ig-raised p-0.5">
              {([
                { key: "all", label: "Todos" },
                { key: "ai", label: `Alertas IA${aiAlertCount ? ` (${aiAlertCount})` : ""}` },
                { key: "dismissed", label: "Descartados" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScopeFilter(key)}
                  className={"rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors " + (scopeFilter === key ? "bg-ig-accent text-white" : "text-ig-fg-muted hover:text-ig-fg-strong")}
                >
                  {key === "ai" ? <BrainCircuit className="-mt-px mr-1 inline-block h-3 w-3" /> : null}
                  {label}
                </button>
              ))}
            </div>
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => toast.notify("Novo risco", { description: "Formulário de cadastro em breve.", variant: "info" })}>Novo risco</HudButton>
            <HudButton variant="secondary" size="sm" leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={handleAnalyzeAi}>Analisar com IA</HudButton>
            <HudButton variant="ghost" size="sm" leftIcon={<FileDown className="h-3.5 w-3.5" />} onClick={handleExport}>Exportar</HudButton>
            <HudButton variant="ghost" size="sm" leftIcon={<Flame className="h-3.5 w-3.5" />} onClick={handleViewCritical}>Ver críticos</HudButton>
          </div>
        }
      />

      {/* ── DEMO PREVIEW TOGGLE (only when real data exists) ── */}
      {!loading && !error && allRisks.length > 0 && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setDemoPreview((v) => !v)}
            className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-all " + (demoPreview ? "border-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning" : "border-ig-border-subtle bg-ig-raised text-ig-fg-muted hover:text-ig-fg-strong")}
          >
            <Sparkles className="h-3 w-3" />
            {demoPreview ? "Visualizando dados demonstrativos" : "Pré-visualizar com dados demo"}
          </button>
        </div>
      )}

      {/* ── EXECUTIVE INSIGHT STRIP ── */}
      <RiskInsightStrip insights={insights} />

      {/* ── PREMIUM KPI GRID ── */}
      <RiskKpiGrid cards={kpiCards} />

      {/* ── QUICK CHIPS ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">Recortes rápidos</span>
        {chips.map((chip) => (
          <button key={chip.id} type="button" onClick={chip.onClick} className={chipToneClass(chip.tone, chip.active)}>
            {chip.label}
          </button>
        ))}
      </div>

      {/* ══════ ROW 1: MATRIX + SEVERITY DONUT + STATUS PIPELINE ══════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <HudPanel
          elevation={2}
          title="Matriz 5×5 — Probabilidade × Impacto"
          subtitle="Clique em uma célula para filtrar a tabela"
          icon={<ShieldCheck className="h-4 w-4" />}
          iconTint="#14B8A6"
          watermark="RISK · MATRIX · V5"
        >
          <RiskMatrix5x5
            risks={scoped}
            onCellClick={handleCellClick}
            highlightedCell={selectedCell}
          />
        </HudPanel>

        <div className="grid grid-cols-1 gap-4">
          <HudPanel elevation={2} title="Por Severidade" subtitle="Distribuição e participação" icon={<BarChart3 className="h-4 w-4" />} iconTint="#EF4B55">
            <SeverityDonutWithLegend slices={severityData} height={208} />
          </HudPanel>
          <HudPanel elevation={2} title="Pipeline de Status" subtitle="Clique para filtrar" icon={<Activity className="h-4 w-4" />} iconTint="#14B8A6">
            <RiskStatusPipeline
              counts={{ open: summary.open, mitigating: summary.mitigating, resolved: summary.resolved }}
              active={statusFilter === "all" ? null : (statusFilter as ExtendedRisk["status"])}
              onStatusClick={handleStatusClick}
            />
          </HudPanel>
        </div>
      </div>

      {/* ══════ ROW 2: TREND + WATERFALL + DOMAIN RADAR ══════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HudPanel elevation={2} title="Evolução de Exposição" subtitle="Tendência mensal + score corporativo" icon={<TrendingUp className="h-4 w-4" />} iconTint="#EF4B55">
          <RiskExposureTrendChart data={trend} height={272} />
        </HudPanel>
        <HudPanel elevation={2} title="Ponte de Exposição" subtitle="O que mudou vs. período anterior" icon={<ArrowLeftRight className="h-4 w-4" />} iconTint="#F5A524">
          <RiskWaterfallChart data={waterfallData} height={272} />
        </HudPanel>
        <HudPanel elevation={2} title="Exposição por Domínio" subtitle="Radar de exposição comparativa" icon={<Radar className="h-4 w-4" />} iconTint="#A855F7">
          <RiskAreaExposureChart data={domainData} height={272} />
        </HudPanel>
      </div>

      {/* ══════ ROW 3: BUBBLE + HEATMAP ══════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HudPanel elevation={2} title="Mapa de Risco" subtitle="Probabilidade × Impacto × Exposição" icon={<Disc3 className="h-4 w-4" />} iconTint="#3B82F6">
          <RiskBubbleChart data={bubbleData} height={300} />
        </HudPanel>
        <HudPanel elevation={2} title="Concentração por Área" subtitle="Área × severidade" icon={<Boxes className="h-4 w-4" />} iconTint="#14B8A6">
          <RiskHeatmapChart rows={heatmapData.rows} cols={heatmapData.cols} cells={heatmapData.cells} max={heatmapData.max} height={300} />
        </HudPanel>
      </div>

      {/* ══════ ROW 4: CATEGORY + OWNERS ══════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HudPanel elevation={2} title="Por Categoria" subtitle="Distribuição por domínio" icon={<Layers className="h-4 w-4" />} iconTint="#3B82F6">
          <CategoryDistributionChart data={categoryData} height={252} />
        </HudPanel>
        <HudPanel elevation={2} title="Top Responsáveis" subtitle="Riscos por área responsável" icon={<Target className="h-4 w-4" />} iconTint="#A855F7">
          <TopRiskOwnersChart data={ownerData} height={252} />
        </HudPanel>
      </div>

      {/* ══════ ROW 5: MITIGATION PIPELINE (full width) ══════ */}
      <HudPanel elevation={2} title="Pipeline de Mitigação" subtitle="Conversão, aging e atrasos por etapa — clique para filtrar" icon={<Gauge className="h-4 w-4" />} iconTint="#F5A524">
        <RiskMitigationPipeline stages={pipeline} activeStage={selectedStage} onStageClick={handleStageClick} />
      </HudPanel>

      {/* ══════ ROW 6: COLLAPSIBLE RISK TABLE ══════ */}
      <HudPanel
        elevation={2}
        title="Detalhamento de Riscos"
        subtitle={`${tableRisks.length} risco(s) no recorte atual`}
        icon={<ShieldAlert className="h-4 w-4" />}
        iconTint="#F5A524"
        serial={`RSK-${new Date().getFullYear()}-${String(tableRisks.length).padStart(4, "0")}`}
        watermark="RISK · TABLE · V5"
        headerActions={
          <button
            type="button"
            onClick={() => setTableOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-1.5 text-[11px] font-semibold text-ig-fg-muted transition-all hover:border-ig-accent hover:text-ig-accent"
          >
            {tableOpen ? "Recolher" : "Expandir"}
            <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (tableOpen ? "rotate-180" : "")} />
          </button>
        }
      >
        {tableOpen ? (
          <div className="space-y-4">
            <HudFilterBar
              compact
              searchPlaceholder="Buscar por título, descrição ou responsável…"
              searchValue={search}
              onSearchChange={setSearch}
              filterGroups={filterGroups}
              activeFiltersCount={activeFiltersCount}
              onClearFilters={clearAllFilters}
            />

            {/* Active drill breadcrumb */}
            {(selectedCell || selectedStage || overdueOnly || noPlanOnly) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-raised/60 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">Recorte ativo</span>
                {selectedCell && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ig-accent-weak px-2.5 py-0.5 text-[11px] font-semibold text-ig-accent">
                    Matriz P{selectedCell.prob} × I{selectedCell.impact}
                    <button type="button" onClick={() => setSelectedCell(null)} className="hover:text-ig-fg-strong"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {selectedStage && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ig-accent-weak px-2.5 py-0.5 text-[11px] font-semibold text-ig-accent">
                    Etapa: {pipeline.find((p) => p.stage === selectedStage)?.label}
                    <button type="button" onClick={() => setSelectedStage(null)} className="hover:text-ig-fg-strong"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {overdueOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-semibold text-ig-danger">
                    Em atraso
                    <button type="button" onClick={() => setOverdueOnly(false)} className="hover:text-ig-fg-strong"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {noPlanOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-semibold text-ig-warning">
                    Sem plano de ação
                    <button type="button" onClick={() => setNoPlanOnly(false)} className="hover:text-ig-fg-strong"><X className="h-3 w-3" /></button>
                  </span>
                )}
                <button type="button" onClick={clearAllFilters} className="ml-auto text-[11px] font-semibold text-ig-fg-muted hover:text-ig-danger">Limpar tudo</button>
              </div>
            )}

            <RiskTable risks={tableRisks} onRowClick={setDetailRisk} selectedId={detailRisk?.id ?? null} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setTableOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ig-border-subtle py-6 text-[12px] font-medium text-ig-fg-muted transition-colors hover:border-ig-accent hover:text-ig-accent"
          >
            <ChevronDown className="h-4 w-4" />
            Expandir tabela detalhada de {tableRisks.length} risco(s)
          </button>
        )}
      </HudPanel>

      {/* ── DETAIL DRAWER ── */}
      <RiskDetailDrawer
        risk={detailRisk}
        isOpen={!!detailRisk}
        onClose={() => setDetailRisk(null)}
        canDismissAi={canDismissAi && !usingDemo}
        onDismissAi={handleDismissAi}
        dismissing={!!detailRisk && dismissingId === detailRisk.id}
        onEdit={actionToast("Editar risco — em breve")}
        onCreatePlan={actionToast("Criar plano de ação — em breve")}
        onMarkMitigated={actionToast("Marcar como mitigado — em breve")}
        onReanalyze={actionToast("Reavaliar com IA — em breve")}
      />
    </HudPageLayout>
  );
}

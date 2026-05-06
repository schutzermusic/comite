"use client";

import { useMemo, useState } from "react";
import {
  Activity, AlertCircle, BarChart3, CheckCircle, Clock,
  Gauge, Layers, ShieldAlert, ShieldCheck, Target, TrendingUp,
} from "lucide-react";
import { HudFilterBar, HudHeader, HudKpiStrip, HudPageLayout, HudPanel } from "@/components/hud";
import type { FilterGroup, KpiItem } from "@/components/hud";
import {
  RiskMatrix5x5,
  RiskMitigationFunnel,
  RiskStatusPipeline,
  RiskActionQueue,
  RiskDetailDrawer,
  RiskDrawer,
  SeverityDistributionChart,
  RiskExposureTrendChart,
  CategoryDistributionChart,
  TopRiskOwnersChart,
  RiskAreaExposureChart,
  MOCK_RISKS,
  TREND_DATA,
  countByStage,
  computeAreaExposure,
  computeCategoryDistribution,
  computeOwnerDistribution,
  filterByStage,
} from "@/components/risks";
import type { DrawerContext, FunnelStage, ExtendedRisk } from "@/components/risks";
import { computeCorporateRiskScore, scoreVariant } from "@/lib/risk-score";

/* ═══════════════════════════════════════════════════════════════
   PAGE COMPONENT — RISK CONTROL ROOM
   ═══════════════════════════════════════════════════════════════ */

export default function RiscosPage() {
  /* ── Filter state ── */
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  /* ── Drawer state ── */
  const [drawerCtx, setDrawerCtx] = useState<DrawerContext>(null);
  const [detailRisk, setDetailRisk] = useState<ExtendedRisk | null>(null);

  /* ── Computed metrics ── */
  const totalRisks = MOCK_RISKS.length;
  const criticalCount = MOCK_RISKS.filter((r) => r.severity === "critical").length;
  const highCount = MOCK_RISKS.filter((r) => r.severity === "high").length;
  const mediumCount = MOCK_RISKS.filter((r) => r.severity === "medium").length;
  const lowCount = MOCK_RISKS.filter((r) => r.severity === "low").length;
  const resolvedCount = MOCK_RISKS.filter((r) => r.status === "resolved").length;
  const mitigatingCount = MOCK_RISKS.filter((r) => r.status === "mitigating").length;
  const openCount = MOCK_RISKS.filter((r) => r.status === "open").length;

  const score = computeCorporateRiskScore(MOCK_RISKS);
  const variant = scoreVariant(score);
  const kpiVariant = variant === "critical" ? "danger" : variant;

  const avgAging = useMemo(() => {
    const now = Date.now();
    const open = MOCK_RISKS.filter((r) => r.status !== "resolved");
    if (open.length === 0) return 0;
    return Math.round(open.reduce((s, r) => s + Math.floor((now - r.createdAt.getTime()) / 86400000), 0) / open.length);
  }, []);

  /* ── Derived data ── */
  const funnelCounts = useMemo(() => countByStage(MOCK_RISKS), []);
  const areaCounts = useMemo(() => computeAreaExposure(MOCK_RISKS), []);
  const categoryData = useMemo(() => computeCategoryDistribution(MOCK_RISKS), []);
  const ownerData = useMemo(() => computeOwnerDistribution(MOCK_RISKS), []);

  const statusCounts = useMemo(() => ({
    open: openCount,
    mitigating: mitigatingCount,
    resolved: resolvedCount,
  }), [openCount, mitigatingCount, resolvedCount]);

  /* ── Filters ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return MOCK_RISKS.filter((risk) => {
      const matchSearch = !q || risk.title.toLowerCase().includes(q) || risk.description.toLowerCase().includes(q);
      const matchSeverity = severityFilter === "all" || risk.severity === severityFilter;
      const matchStatus = statusFilter === "all" || risk.status === statusFilter;
      return matchSearch && matchSeverity && matchStatus;
    });
  }, [search, severityFilter, statusFilter]);

  /* ── Drawer filtered risks ── */
  const drawerRisks = useMemo(() => {
    if (!drawerCtx) return [];
    if (drawerCtx.type === "cell") {
      return MOCK_RISKS.filter(
        (r) => r.probability === drawerCtx.probability && r.impact === drawerCtx.impact,
      );
    }
    if (drawerCtx.type === "funnel") {
      return filterByStage(MOCK_RISKS, drawerCtx.stage);
    }
    return [];
  }, [drawerCtx]);

  /* ── Filter UI ── */
  const filterGroups: FilterGroup[] = [
    {
      id: "severity", label: "Severidade", value: severityFilter, onChange: setSeverityFilter,
      options: [
        { value: "all", label: "Todas" }, { value: "critical", label: "Crítico" },
        { value: "high", label: "Alto" }, { value: "medium", label: "Médio" },
        { value: "low", label: "Baixo" },
      ],
    },
    {
      id: "status", label: "Status", value: statusFilter, onChange: setStatusFilter,
      options: [
        { value: "all", label: "Todos" }, { value: "open", label: "Aberto" },
        { value: "mitigating", label: "Mitigando" }, { value: "resolved", label: "Resolvido" },
      ],
    },
  ];

  const activeFiltersCount = (severityFilter === "all" ? 0 : 1) + (statusFilter === "all" ? 0 : 1);

  const kpis: KpiItem[] = [
    { id: "total", label: "Total de riscos", value: totalRisks, variant: "info", icon: <ShieldAlert className="h-5 w-5" /> },
    { id: "critical", label: "Críticos", value: criticalCount, variant: "danger", tintValue: true, icon: <AlertCircle className="h-5 w-5" /> },
    { id: "high", label: "Altos", value: highCount, variant: "warning", tintValue: true, icon: <TrendingUp className="h-5 w-5" /> },
    { id: "medium", label: "Médios", value: mediumCount, variant: "info", icon: <Layers className="h-5 w-5" /> },
    { id: "score", label: "Score corporativo", value: score.toFixed(1), variant: kpiVariant, tintValue: true, icon: <Gauge className="h-5 w-5" /> },
    { id: "mitigating", label: "Em mitigação", value: mitigatingCount, variant: "warning", icon: <Activity className="h-5 w-5" /> },
    { id: "resolved", label: "Resolvidos", value: resolvedCount, variant: "success", tintValue: true, icon: <CheckCircle className="h-5 w-5" /> },
    { id: "aging", label: "Aging médio", value: avgAging, suffix: "d", variant: avgAging > 60 ? "danger" : avgAging > 30 ? "warning" : "default", icon: <Clock className="h-5 w-5" /> },
  ];

  const posture = score >= 7 ? "Crítica" : score >= 4 ? "Elevada" : "Controlada";
  const postureVariant = score >= 7 ? "critical" : score >= 4 ? "warning" : "success";

  /* ── Handlers ── */
  const handleCellClick = (prob: number, impact: number) => {
    setDrawerCtx({ type: "cell", probability: prob, impact });
  };
  const handleFunnelClick = (stage: FunnelStage) => {
    setDrawerCtx({ type: "funnel", stage });
  };
  const handleStatusClick = (status: string) => {
    setStatusFilter(status === statusFilter ? "all" : status);
  };
  const handleRiskClick = (risk: ExtendedRisk) => {
    setDrawerCtx(null);
    setTimeout(() => setDetailRisk(risk), 150);
  };
  const handleQueueRiskClick = (risk: ExtendedRisk) => {
    setDetailRisk(risk);
  };

  return (
    <HudPageLayout maxWidth="2xl">
      {/* ── HEADER ── */}
      <HudHeader
        title="Risk Control Room"
        subtitle="Painel executivo de exposição, mitigação e postura de risco corporativo"
        icon={<ShieldAlert className="h-5 w-5" />}
        iconTint="#F5A524"
        breadcrumbs={[{ label: "Governança", href: "/dashboard" }, { label: "Riscos" }]}
        statusChips={[
          { label: `Score ${score.toFixed(1)}`, variant },
          { label: `Postura ${posture}`, variant: postureVariant },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-accent-weak px-3 py-1.5">
              <Target className="h-3.5 w-3.5 text-ig-accent" />
              <span className="text-[11px] font-semibold text-ig-accent ig-tabular">{openCount} abertos</span>
            </div>
          </div>
        }
      />

      {/* ── KPI STRIP ── */}
      <HudKpiStrip kpis={kpis} columns={4} className="mb-2" connected align="center" size="md" />

      {/* ══════════════════════════════════════════════════════════════
         ROW 1: MATRIX 5×5 + SEVERITY DONUT + STATUS PIPELINE
         ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <HudPanel
          elevation={2}
          title="Matriz 5×5 — Probabilidade × Impacto"
          subtitle="Clique em uma célula para ver os riscos"
          icon={<ShieldCheck className="h-4 w-4" />}
          iconTint="#14B8A6"
          watermark="RISK · MATRIX · V4"
        >
          <RiskMatrix5x5
            risks={filtered}
            onCellClick={handleCellClick}
            highlightedCell={null}
          />
        </HudPanel>

        <div className="grid grid-cols-1 gap-4">
          <HudPanel elevation={2} title="Por Severidade" subtitle="Distribuição atual" icon={<BarChart3 className="h-4 w-4" />} iconTint="#EF4B55">
            <SeverityDistributionChart
              critical={criticalCount}
              high={highCount}
              medium={mediumCount}
              low={lowCount}
              height={220}
            />
          </HudPanel>

          <HudPanel elevation={2} title="Pipeline de Status" subtitle="Clique para filtrar" icon={<Activity className="h-4 w-4" />} iconTint="#14B8A6">
            <RiskStatusPipeline
              counts={statusCounts}
              active={statusFilter === "all" ? null : (statusFilter as ExtendedRisk["status"])}
              onStatusClick={handleStatusClick}
            />
          </HudPanel>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
         ROW 2: TREND + CATEGORY + OWNERS
         ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HudPanel elevation={2} title="Evolução de Risco" subtitle="Tendência mensal de exposição" icon={<TrendingUp className="h-4 w-4" />} iconTint="#EF4B55">
          <RiskExposureTrendChart data={TREND_DATA} height={260} />
        </HudPanel>

        <HudPanel elevation={2} title="Por Categoria" subtitle="Distribuição por domínio" icon={<Layers className="h-4 w-4" />} iconTint="#3B82F6">
          <CategoryDistributionChart data={categoryData} height={260} />
        </HudPanel>

        <HudPanel elevation={2} title="Top Responsáveis" subtitle="Riscos por área responsável" icon={<Target className="h-4 w-4" />} iconTint="#A855F7">
          <TopRiskOwnersChart data={ownerData} height={260} />
        </HudPanel>
      </div>

      {/* ══════════════════════════════════════════════════════════════
         ROW 3: MITIGATION FUNNEL + AREA EXPOSURE
         ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HudPanel
          elevation={2}
          title="Funil de Mitigação"
          subtitle="Clique em uma etapa para ver os riscos"
          icon={<Gauge className="h-4 w-4" />}
          iconTint="#F5A524"
        >
          <RiskMitigationFunnel
            counts={funnelCounts}
            onStageClick={handleFunnelClick}
            activeStage={null}
          />
        </HudPanel>

        <HudPanel elevation={2} title="Exposição por Área" subtitle="Radar de exposição comparativa" icon={<Activity className="h-4 w-4" />} iconTint="#EF4B55">
          <RiskAreaExposureChart data={areaCounts} height={320} />
        </HudPanel>
      </div>

      {/* ══════════════════════════════════════════════════════════════
         ROW 4: RISK ACTION QUEUE (full width)
         ══════════════════════════════════════════════════════════════ */}
      <HudPanel
        elevation={2}
        title="Risk Action Queue"
        subtitle={`${filtered.length} risco(s) no recorte atual`}
        icon={<ShieldAlert className="h-4 w-4" />}
        iconTint="#F5A524"
        serial={`RSK-${new Date().getFullYear()}-${String(filtered.length).padStart(4, "0")}`}
        watermark="RISK · ACTION · QUEUE · V4"
      >
        <div className="space-y-4">
          <HudFilterBar
            compact
            searchPlaceholder="Buscar riscos por título, descrição..."
            searchValue={search}
            onSearchChange={setSearch}
            filterGroups={filterGroups}
            activeFiltersCount={activeFiltersCount}
            onClearFilters={() => { setSeverityFilter("all"); setStatusFilter("all"); }}
          />
          <RiskActionQueue risks={filtered} onRiskClick={handleQueueRiskClick} />
        </div>
      </HudPanel>

      {/* ══════════════════════════════════════════════════════════════
         DRAWERS
         ══════════════════════════════════════════════════════════════ */}
      <RiskDrawer
        context={drawerCtx}
        risks={drawerRisks}
        onClose={() => setDrawerCtx(null)}
        onRiskClick={handleRiskClick}
      />
      <RiskDetailDrawer
        risk={detailRisk}
        isOpen={!!detailRisk}
        onClose={() => setDetailRisk(null)}
      />
    </HudPageLayout>
  );
}

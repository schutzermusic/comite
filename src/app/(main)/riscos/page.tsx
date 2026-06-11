"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity, AlertCircle, ArrowLeftRight, Boxes, BrainCircuit, CheckCircle2,
  ChevronDown, Clock, Disc3, FileDown, Flame, Gauge, Layers, ListChecks, Percent,
  Plus, Radar, ShieldAlert, ShieldCheck, Sparkles, Target, TrendingUp, X,
} from "lucide-react";
import {
  HudButton, HudEmptyState, HudFilterBar, HudHeader, HudKpiStrip, HudPageLayout, HudPanel,
} from "@/components/hud";
import type { FilterGroup, KpiItem } from "@/components/hud";
import {
  RiskMatrix5x5,
  RiskMitigationPipeline,

  RiskTable,
  RiskDetailDrawer,
  RiskDrilldownDrawer,
  RiskFormModal,
  RiskInsightStrip,
  RiskAiAlerts,
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
  buildRiskDrilldownContext,
  distinctOwners,
  distinctAreas,
  distinctCategories,
  riskExposure,
  isOverdue,
  hasActionPlan,
  computeAging,
  fmtDateShort,
  categoryToDomain,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from "@/components/risks";
import type { RiskFormValues, RiskLink, RiskSelection, ExtendedRisk } from "@/components/risks";
import { scoreVariant } from "@/lib/risk-score";
import { triggerContractAiScan, triggerProjectAiScan } from "@/lib/services/risks";
import { getProjectsAsync } from "@/lib/services/projects";
import { listContracts } from "@/lib/contracts/contract-service";
import { useRisks } from "@/hooks/use-risks";
import { usePermissions } from "@/hooks/use-permissions";
import { useHudToast } from "@/hooks/useHudToast";

/* ═══════════════════════════════════════════════════════════════
   COCKPIT EXECUTIVO DE RISCOS
   ═══════════════════════════════════════════════════════════════ */

const PERIOD_DAYS: Record<string, number | null> = {
  all: null, "30": 30, "90": 90, "180": 180, "365": 365,
};

export default function RiscosPage() {
  return (
    <Suspense fallback={null}>
      <RiscosCockpit />
    </Suspense>
  );
}

function RiscosCockpit() {
  /* ── Data ── */
  const { risks: allRisks, loading, error, dismissAiRisk, createRisk, updateRisk, refresh } = useRisks();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const toast = useHudToast();
  const canView = hasPermission("risks.view");
  const canDismissAi = hasPermission("risks.ai_dismiss");

  /* ── Demo data fallback / preview ── */
  const [demoPreview, setDemoPreview] = useState(false);
  const usingDemo = !loading && !error && (allRisks.length === 0 || demoPreview);
  const sourceRisks = usingDemo ? DEMO_RISKS : allRisks;

  /* ── Source filter (chip only — no top-level tab) ── */
  const [aiFilter, setAiFilter] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const aiCount = useMemo(
    () => sourceRisks.filter((r) => r.origin === "ai" && !r.aiDismissed).length,
    [sourceRisks],
  );
  const archivedCount = useMemo(
    () => sourceRisks.filter((r) => r.aiDismissed).length,
    [sourceRisks],
  );
  const scoped = useMemo(() => {
    const base = showArchived
      ? sourceRisks.filter((r) => r.aiDismissed)
      : sourceRisks.filter((r) => !r.aiDismissed);
    return aiFilter ? base.filter((r) => r.origin === "ai") : base;
  }, [sourceRisks, aiFilter, showArchived]);

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

  /* ── Chart drilldown ("Riscos do recorte") ── */
  const [drilldown, setDrilldown] = useState<RiskSelection | null>(null);

  /* ── Drawer + table ── */
  const [detailRisk, setDetailRisk] = useState<ExtendedRisk | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  /* ── Deep-link from a project/contract: /riscos?linkType=project&refId=…&refName=… ── */
  const searchParams = useSearchParams();
  const urlLink = useMemo<RiskLink | null>(() => {
    const t = searchParams.get("linkType");
    if (t !== "project" && t !== "contract") return null;
    return {
      origin: t,
      referenceId: searchParams.get("refId") ?? undefined,
      referenceName: searchParams.get("refName") ?? undefined,
    };
  }, [searchParams]);

  /* ── Create / edit form ── */
  const [formOpen, setFormOpen] = useState<boolean>(() => !!urlLink);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formRisk, setFormRisk] = useState<ExtendedRisk | null>(null);
  const [formFocusPlan, setFormFocusPlan] = useState(false);
  const [formInitialLink, setFormInitialLink] = useState<RiskLink | null>(() => urlLink);
  const [saving, setSaving] = useState(false);

  /* ── Link options (projects/contracts), lazy-loaded on first form open ── */
  const [projectOptions, setProjectOptions] = useState<{ value: string; label: string }[]>([]);
  const [contractOptions, setContractOptions] = useState<{ value: string; label: string }[]>([]);
  const [linkLoaded, setLinkLoaded] = useState(false);

  const loadLinkOptions = useCallback(async () => {
    if (linkLoaded) return;
    setLinkLoaded(true);
    try {
      const [projects, contracts] = await Promise.all([
        getProjectsAsync().catch(() => []),
        listContracts().catch(() => []),
      ]);
      setProjectOptions(projects.map((p) => ({ value: p.id, label: p.codigo ? `${p.codigo} · ${p.nome}` : p.nome })));
      setContractOptions(contracts.map((c) => ({ value: c.id, label: c.title })));
    } catch {
      /* options stay empty — vínculo still selectable once loaded */
    }
  }, [linkLoaded]);

  // When deep-linked from a project/contract, preload the link options so the
  // pre-selected entity renders its label. Runs once on mount.
  useEffect(() => {
    if (urlLink) void loadLinkOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return true;
    });
  }, [scoped, search, severityFilter, statusFilter, categoryFilter, ownerFilter, areaFilter, linkFilter, periodFilter, overdueOnly, noPlanOnly]);

  /* ── Drilldown context (recorte selecionado via chart) ── */
  const drilldownContext = useMemo(
    () => (drilldown ? buildRiskDrilldownContext(scoped, drilldown) : null),
    [drilldown, scoped],
  );

  /* ── KPI strip (padrão HudKpiStrip dos demais módulos) ── */
  const scoreVar = variant === "critical" ? "danger" : variant;
  const kpis: KpiItem[] = [
    { id: "total", label: "Total de riscos", value: summary.total, icon: <ShieldAlert className="h-4 w-4" />, variant: "info", onClick: () => setDrilldown({ kind: "all" }), active: drilldown?.kind === "all" },
    { id: "critical", label: "Críticos", value: summary.critical, icon: <AlertCircle className="h-4 w-4" />, variant: "danger", onClick: () => setDrilldown({ kind: "severity", severity: "critical" }), active: drilldown?.kind === "severity" && drilldown.severity === "critical" },
    { id: "high", label: "Altos", value: summary.high, icon: <TrendingUp className="h-4 w-4" />, variant: "warning", onClick: () => setDrilldown({ kind: "severity", severity: "high" }), active: drilldown?.kind === "severity" && drilldown.severity === "high" },
    { id: "ai", label: "Detectados por IA", value: summary.aiActive, icon: <BrainCircuit className="h-4 w-4" />, variant: "info", onClick: () => { setAiFilter(true); setShowArchived(false); setDrilldown({ kind: "aiDetected" }); }, active: drilldown?.kind === "aiDetected" },
    { id: "mitigating", label: "Em mitigação", value: summary.mitigating, icon: <Activity className="h-4 w-4" />, variant: "warning", onClick: () => setDrilldown({ kind: "status", status: "mitigating" }), active: drilldown?.kind === "status" && drilldown.status === "mitigating" },
    { id: "resolved", label: "Resolvidos", value: summary.resolved, icon: <CheckCircle2 className="h-4 w-4" />, variant: "success", onClick: () => setDrilldown({ kind: "status", status: "resolved" }), active: drilldown?.kind === "status" && drilldown.status === "resolved" },
    { id: "aging", label: "Aging médio", value: summary.avgAging, suffix: "d", icon: <Clock className="h-4 w-4" />, variant: summary.avgAging > 60 ? "danger" : summary.avgAging > 30 ? "warning" : "success", onClick: () => setDrilldown({ kind: "active" }), active: drilldown?.kind === "active" },
    { id: "score", label: "Score corporativo", value: summary.score.toFixed(1), icon: <Gauge className="h-4 w-4" />, variant: scoreVar, tintValue: true, onClick: () => setDrilldown({ kind: "active" }) },
    { id: "plan", label: "% com plano", value: summary.withPlanPct, suffix: "%", icon: <ListChecks className="h-4 w-4" />, variant: summary.withPlanPct >= 70 ? "success" : "warning", onClick: () => setDrilldown({ kind: "noPlan" }), active: drilldown?.kind === "noPlan" },
    { id: "ontime", label: "% mitig. no prazo", value: summary.onTimePct, suffix: "%", icon: <Percent className="h-4 w-4" />, variant: summary.onTimePct >= 80 ? "success" : summary.onTimePct >= 60 ? "warning" : "danger", onClick: () => setDrilldown({ kind: "overdue" }), active: drilldown?.kind === "overdue" },
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
    (overdueOnly ? 1 : 0) + (noPlanOnly ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setSeverityFilter("all"); setStatusFilter("all"); setCategoryFilter("all");
    setOwnerFilter("all"); setAreaFilter("all"); setLinkFilter("all"); setPeriodFilter("all");
    setOverdueOnly(false); setNoPlanOnly(false); setSearch("");
    setAiFilter(false); setShowArchived(false);
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
    { id: "ai", label: "Detectados por IA", tone: "accent", active: aiFilter, onClick: () => { setAiFilter((v) => !v); setShowArchived(false); setTableOpen(true); } },
  ];

  /* ── Handlers ── */
  /* ── Drilldown handlers — every chart routes a RiskSelection to the drawer ── */
  const handleRiskRowClick = (risk: ExtendedRisk) => {
    setDrilldown(null);
    setTimeout(() => setDetailRisk(risk), 120);
  };
  const handleBubbleSelect = (riskId: string) => {
    const risk = scoped.find((r) => r.id === riskId);
    if (risk) setDetailRisk(risk);
  };

  const applySelectionToTable = useCallback((sel: RiskSelection) => {
    switch (sel.kind) {
      case "severity": setSeverityFilter(sel.severity); break;
      case "status": setStatusFilter(sel.status); break;
      case "owner": setOwnerFilter(sel.owner); break;
      case "area": setAreaFilter(sel.area); break;
      case "category": {
        // selection carries the display label; match it back to a raw category value
        const opt = categoryOptions.find((o) => o.label === sel.category);
        if (opt) setCategoryFilter(opt.value);
        break;
      }
      case "overdue": setOverdueOnly(true); break;
      case "noPlan": setNoPlanOnly(true); break;
      case "aiDetected": setAiFilter(true); setShowArchived(false); break;
      default: break; // cell/stage/trend/heatmap/waterfall/domain/project/contract → no clean table mapping
    }
    setDrilldown(null);
    setTableOpen(true);
  }, [categoryOptions]);

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
    setDrilldown({ kind: "severity", severity: "critical" });
  };
  const handleAnalyzeAi = () => {
    setAiFilter(true);
    setShowArchived(false);
    setTableOpen(true);
    toast.notify("Análise por IA", { description: aiCount ? `${aiCount} risco(s) detectado(s) por IA no funil.` : "Nenhum risco detectado por IA no momento.", variant: "info" });
  };

  /* ── CRUD ── */
  const isDemoRisk = (risk: ExtendedRisk) => usingDemo || risk.id.startsWith("DEMO-");

  const openCreate = (link?: RiskLink) => {
    void loadLinkOptions();
    setFormMode("create");
    setFormRisk(null);
    setFormFocusPlan(false);
    setFormInitialLink(link ?? null);
    setFormOpen(true);
  };

  const openEdit = (risk: ExtendedRisk, focusPlan = false) => {
    if (isDemoRisk(risk)) {
      toast.notify("Indisponível em modo demo", { description: "Os dados demonstrativos não podem ser editados.", variant: "warning" });
      return;
    }
    void loadLinkOptions();
    setFormMode("edit");
    setFormRisk(risk);
    setFormFocusPlan(focusPlan);
    setFormOpen(true);
  };

  const handleFormSubmit = useCallback(
    async (values: RiskFormValues) => {
      setSaving(true);
      const resolvedAt = values.status === "resolved" ? (formRisk?.resolvedAt ?? new Date()) : undefined;
      const shared = {
        title: values.title,
        description: values.description,
        category: values.category,
        area: values.area,
        probability: values.probability,
        impact: values.impact,
        status: values.status,
        responsibleName: values.responsibleName || undefined,
        mitigationPlan: values.mitigationPlan || undefined,
        nextAction: values.nextAction || undefined,
        dueDate: values.dueDate ? new Date(`${values.dueDate}T00:00:00`) : undefined,
        financialExposure: values.financialExposure,
        origin: values.origin,
        referenceId: values.origin === "manual" ? undefined : values.referenceId,
        referenceName: values.origin === "manual" ? undefined : values.referenceName,
        resolvedAt,
      };
      try {
        if (formMode === "create") {
          await createRisk({ ...shared, actions: values.actions, history: [], evidences: values.evidences });
          toast.success("Risco criado", values.title);
        } else if (formRisk) {
          const updated = await updateRisk(formRisk.id, { ...shared, actions: values.actions, evidences: values.evidences });
          setDetailRisk((cur) => (cur && cur.id === updated.id ? updated : cur));
          toast.success("Risco atualizado", values.title);
        }
        setFormOpen(false);
      } catch (e) {
        toast.error("Falha ao salvar risco", e instanceof Error ? e.message : "Erro desconhecido.");
      } finally {
        setSaving(false);
      }
    },
    [formMode, formRisk, createRisk, updateRisk, toast],
  );

  const handleMarkMitigated = useCallback(
    async (risk: ExtendedRisk) => {
      if (isDemoRisk(risk)) {
        toast.notify("Indisponível em modo demo", { description: "Ative dados reais para alterar status.", variant: "warning" });
        return;
      }
      try {
        const updated = await updateRisk(risk.id, { status: "resolved", resolvedAt: new Date() });
        setDetailRisk((cur) => (cur && cur.id === updated.id ? updated : cur));
        toast.success("Risco marcado como mitigado", risk.title);
      } catch (e) {
        toast.error("Falha ao atualizar", e instanceof Error ? e.message : "Erro desconhecido.");
      }
    },
    [usingDemo, updateRisk, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleReanalyze = useCallback(
    async (risk: ExtendedRisk) => {
      if (isDemoRisk(risk)) {
        toast.notify("Indisponível em modo demo", { description: "Reavaliação por IA requer dados reais.", variant: "warning" });
        return;
      }
      if (!risk.referenceId || (risk.origin !== "project" && risk.origin !== "contract")) {
        toast.notify("Reavaliação por IA", { description: "Disponível para riscos vinculados a um projeto ou contrato.", variant: "info" });
        return;
      }
      try {
        toast.notify("Reavaliando com IA…", { description: risk.title, variant: "info" });
        if (risk.origin === "project") await triggerProjectAiScan(risk.referenceId);
        else await triggerContractAiScan(risk.referenceId);
        await refresh();
        toast.success("Reavaliação concluída", "Riscos atualizados pela IA.");
      } catch (e) {
        toast.error("Falha na reavaliação por IA", e instanceof Error ? e.message : "Verifique a configuração de IA.");
      }
    },
    [usingDemo, refresh, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => openCreate()}>Novo risco</HudButton>
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

      {/* ── KPI STRIP (padrão dos demais módulos) ── */}
      <HudKpiStrip kpis={kpis} columns={5} size="sm" />

      {/* ── EXECUTIVE INSIGHT STRIP ── */}
      <RiskInsightStrip insights={insights} />

      {/* ── QUICK CHIPS ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">Recortes rápidos</span>
        {chips.map((chip) => (
          <button key={chip.id} type="button" onClick={chip.onClick} className={chipToneClass(chip.tone, chip.active)}>
            {chip.label}
          </button>
        ))}
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => { setShowArchived((v) => !v); setAiFilter(false); setTableOpen(true); }}
            className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-all " + (showArchived ? "border-ig-border-strong bg-ig-raised text-ig-fg-strong" : "border-ig-border-subtle bg-ig-raised text-ig-fg-subtle hover:border-ig-border-strong hover:text-ig-fg-muted")}
          >
            {showArchived ? "← Painel principal" : `Arquivados (${archivedCount})`}
          </button>
        )}
      </div>

      {/* ══════ ROW 1: MATRIX + AI ALERTS ══════
           Desktop: dois cards lado a lado, IA estica para igualar a altura da matriz.
           Mobile: empilhados, cada um com altura automática — sem h-full forçado. ══════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
        {/* Matriz: sem fullHeight — a própria matriz carrega seu aspect-ratio */}
        <HudPanel
          elevation={3}
          sweep
          title="Matriz 5×5 — Probabilidade × Impacto"
          subtitle="Clique em uma célula para ver os riscos"
          icon={<ShieldCheck className="h-4 w-4" />}
          iconTint="#14B8A6"
          watermark="RISK · MATRIX · V5"
        >
          <RiskMatrix5x5
            risks={scoped}
            onCellClick={(probability, impact) => setDrilldown({ kind: "cell", probability, impact })}
            highlightedCell={drilldown?.kind === "cell" ? { prob: drilldown.probability, impact: drilldown.impact } : null}
          />
        </HudPanel>

        {/* IA: fullHeight ativo → estica para igualar altura da matriz no desktop */}
        <HudPanel
          elevation={3}
          fullHeight
          title="Avisos de Riscos por IA"
          subtitle="Sinalizações automáticas priorizadas"
          icon={<BrainCircuit className="h-4 w-4" />}
          iconTint="#A855F7"
          badge={aiCount}
          watermark="AI · ALERTS"
        >
          <RiskAiAlerts risks={scoped} onSelect={setDetailRisk} onAnalyze={handleAnalyzeAi} limit={6} />
        </HudPanel>
      </div>

      {/* ══════ ROW 1b: EVOLUÇÃO DE EXPOSIÇÃO (full width, maior, edge-to-edge) ══════ */}
      <HudPanel elevation={2} noPadding title="Evolução de Exposição" subtitle="Clique em um ponto para ver os riscos" icon={<TrendingUp className="h-4 w-4" />} iconTint="#EF4B55" watermark="TREND · 6M">
        <div className="px-3 pb-2 pt-3 sm:px-4">
          <RiskExposureTrendChart data={trend} height={380} onSelect={(month, severity) => setDrilldown({ kind: "trend", month, severity })} />
        </div>
      </HudPanel>

      {/* ══════ ROW 2: WATERFALL + DOMAIN RADAR ══════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <HudPanel elevation={2} title="Ponte de Exposição" subtitle="Clique em uma barra para ver os riscos" icon={<ArrowLeftRight className="h-4 w-4" />} iconTint="#F5A524" watermark="WATERFALL">
          <RiskWaterfallChart data={waterfallData} height={300} onSelect={(bucket) => setDrilldown({ kind: "waterfall", bucket })} />
        </HudPanel>
        <HudPanel elevation={2} title="Exposição por Domínio" subtitle="Radar de exposição comparativa" icon={<Radar className="h-4 w-4" />} iconTint="#A855F7" watermark="RADAR">
          <RiskAreaExposureChart data={domainData} height={300} />
        </HudPanel>
      </div>

      {/* ══════ ROW 3: BUBBLE + HEATMAP ══════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <HudPanel elevation={2} title="Mapa de Risco" subtitle="Clique em um ponto para abrir o risco" icon={<Disc3 className="h-4 w-4" />} iconTint="#3B82F6" watermark="BUBBLE · MAP">
          <RiskBubbleChart data={bubbleData} height={300} onSelect={handleBubbleSelect} />
        </HudPanel>
        <HudPanel elevation={2} title="Concentração por Área" subtitle="Clique em uma célula para ver os riscos" icon={<Boxes className="h-4 w-4" />} iconTint="#14B8A6" watermark="HEATMAP">
          <RiskHeatmapChart
            rows={heatmapData.rows}
            cols={heatmapData.cols}
            cells={heatmapData.cells}
            max={heatmapData.max}
            height={300}
            onSelect={(area, severityKey) => setDrilldown({ kind: "heatmap", area, severity: severityKey as ExtendedRisk["severity"] })}
          />
        </HudPanel>
      </div>

      {/* ══════ ROW 4: CATEGORY + OWNERS ══════ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <HudPanel elevation={2} title="Por Categoria" subtitle="Clique em uma barra para ver os riscos" icon={<Layers className="h-4 w-4" />} iconTint="#3B82F6" watermark="CATEGORY">
          <CategoryDistributionChart data={categoryData} height={252} onSelect={(category) => setDrilldown({ kind: "category", category })} />
        </HudPanel>
        <HudPanel elevation={2} title="Top Responsáveis" subtitle="Clique em um responsável para ver os riscos" icon={<Target className="h-4 w-4" />} iconTint="#A855F7" watermark="OWNERS">
          <TopRiskOwnersChart data={ownerData} height={252} onSelect={(owner) => setDrilldown({ kind: "owner", owner })} />
        </HudPanel>
      </div>

      {/* ══════ ROW 5: MITIGATION PIPELINE (full width) ══════ */}
      <HudPanel elevation={2} title="Pipeline de Mitigação" subtitle="Clique em uma etapa para ver os riscos" icon={<Gauge className="h-4 w-4" />} iconTint="#F5A524" watermark="PIPELINE · V5">
        <RiskMitigationPipeline
          stages={pipeline}
          activeStage={drilldown?.kind === "stage" ? drilldown.stage : null}
          onStageClick={(stage) => setDrilldown({ kind: "stage", stage })}
        />
      </HudPanel>

      {/* ══════ ROW 6: COLLAPSIBLE RISK TABLE ══════ */}
      <HudPanel
        elevation={2}
        title="Lista completa de riscos"
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

            {/* Active filter breadcrumb (table chips) */}
            {(overdueOnly || noPlanOnly) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-raised/60 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">Recorte ativo</span>
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

      {/* ── DRILLDOWN DRAWER ("Riscos do recorte") ── */}
      <RiskDrilldownDrawer
        context={drilldownContext}
        onClose={() => setDrilldown(null)}
        onRiskClick={handleRiskRowClick}
        onApplyToTable={(ctx) => applySelectionToTable(ctx.selection)}
      />

      {/* ── DETAIL DRAWER ── */}
      <RiskDetailDrawer
        risk={detailRisk}
        isOpen={!!detailRisk}
        onClose={() => setDetailRisk(null)}
        canDismissAi={canDismissAi && !usingDemo}
        onDismissAi={handleDismissAi}
        dismissing={!!detailRisk && dismissingId === detailRisk.id}
        onEdit={(risk) => openEdit(risk)}
        onCreatePlan={(risk) => openEdit(risk, true)}
        onMarkMitigated={handleMarkMitigated}
        onReanalyze={handleReanalyze}
      />

      {/* ── CREATE / EDIT MODAL (mounted only while open → fresh initial values) ── */}
      {formOpen && (
        <RiskFormModal
          open
          mode={formMode}
          risk={formRisk}
          focusPlan={formFocusPlan}
          saving={saving}
          initialLink={formInitialLink ?? undefined}
          projectOptions={projectOptions}
          contractOptions={contractOptions}
          onClose={() => setFormOpen(false)}
          onSubmit={handleFormSubmit}
        />
      )}
    </HudPageLayout>
  );
}

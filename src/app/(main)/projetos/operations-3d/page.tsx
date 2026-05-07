"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  Clock3,
  Cuboid,
  Download,
  Layers3,
  Link2,
  MapPinned,
  Radar,
  ShieldAlert,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { HudHeader, HudKpiStrip, HudPageLayout, type KpiItem } from "@/components/hud";
import { CesiumOperationsMap } from "@/components/operations-3d/CesiumOperationsMap";
import {
  buildOperationsProjectRecords,
  buildOperationsSummary,
  formatOperationsDate,
  formatOperationsMoney,
  getOperationsStatusLabel,
  type OperationsProjectRecord,
  type OperationsProjectStatus,
} from "@/components/operations-3d/operations-projects";
import { cn } from "@/lib/utils";

const STATUS_TOKEN: Record<OperationsProjectStatus, string> = {
  active: "var(--ig-success)",
  attention: "var(--ig-warning)",
  critical: "var(--ig-danger)",
  completed: "var(--ig-accent)",
};

export default function Operations3DPage() {
  const router = useRouter();
  const projects = useMemo(() => buildOperationsProjectRecords(), []);
  const summary = useMemo(() => buildOperationsSummary(projects), [projects]);
  const [selectedProject, setSelectedProject] = useState<OperationsProjectRecord | null>(null);

  const selectedForReport = selectedProject || projects.find((project) => project.status === "critical") || projects[0] || null;

  const kpis: KpiItem[] = [
    {
      id: "projects-mapped",
      label: "Projects mapped",
      value: summary.totalProjects,
      deltaLabel: "Projetos conectados ao mapa",
      icon: <MapPinned className="w-5 h-5" />,
      variant: "info",
    },
    {
      id: "active-fronts",
      label: "Active operational fronts",
      value: summary.activeFronts,
      deltaLabel: "Frentes em execução ou atenção",
      icon: <Zap className="w-5 h-5" />,
      variant: "success",
    },
    {
      id: "critical-alerts",
      label: "Critical alerts",
      value: summary.criticalProjects,
      deltaLabel: `${summary.linkedRisks} riscos vinculados`,
      icon: <ShieldAlert className="w-5 h-5" />,
      variant: "danger",
    },
    {
      id: "assets-linked",
      label: "Assets linked",
      value: summary.assetsLinked,
      deltaLabel: "Ativos, evidências e marcos",
      icon: <Boxes className="w-5 h-5" />,
      variant: "warning",
    },
    {
      id: "last-sync",
      label: "Last sync",
      value: formatOperationsDate(summary.lastUpdate),
      deltaLabel: "Snapshot operacional",
      icon: <Clock3 className="w-5 h-5" />,
      variant: "default",
    },
  ];

  return (
    <HudPageLayout maxWidth="full">
      <style jsx global>{`
        @media print {
          html,
          body {
            background: #ffffff !important;
            color: #111827 !important;
          }
          .ig-ops3d-live {
            display: none !important;
          }
          .ig-ops3d-print {
            display: block !important;
          }
        }
      `}</style>

      <div className="ig-ops3d-live space-y-5">
        <HudHeader
          title="Insight Operations 3D"
          subtitle="Digital twin operacional para projetos, ativos e frentes de serviço no território brasileiro."
          icon={<Cuboid className="h-5 w-5" />}
          iconTint="var(--ig-accent)"
          breadcrumbs={[
            { label: "Projetos", href: "/projetos" },
            { label: "Insight Operations 3D" },
          ]}
          statusChips={[
            { label: "Brasil focus", variant: "success" },
            { label: `${summary.totalProjects} projetos`, variant: "info" },
          ]}
          actions={
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-ig-label text-ig-fg-muted shadow-sm backdrop-blur transition-colors hover:text-ig-fg-strong"
            >
              <Download className="h-4 w-4 text-ig-accent" />
              Exportar PDF
            </button>
          }
        />

        <HudKpiStrip kpis={kpis} columns={5} size="md" />

        <section
          className="relative h-[720px] min-h-[680px] overflow-hidden rounded-2xl border border-ig-border-subtle/70 bg-ig-panel/25 shadow-2xl shadow-black/10 lg:h-[calc(100vh-18rem)] lg:min-h-[660px]"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--ig-panel) 62%, transparent), color-mix(in oklab, var(--ig-bg-canvas) 72%, transparent)), radial-gradient(circle at 22% 18%, color-mix(in oklab, var(--ig-accent) 14%, transparent), transparent 36%)",
          }}
        >
          <CesiumOperationsMap
            projects={projects}
            selectedProjectId={selectedProject?.id || null}
            onSelectProject={setSelectedProject}
          >
            <ProjectInspector
              project={selectedProject}
              summary={summary}
              onClear={() => setSelectedProject(null)}
              onOpenProject={(projectId) => router.push(`/projetos/${projectId}`)}
            />
          </CesiumOperationsMap>
        </section>
      </div>

      <PrintReport
        summary={summary}
        selectedProject={selectedForReport}
      />
    </HudPageLayout>
  );
}

function ProjectInspector({
  project,
  summary,
  onClear,
  onOpenProject,
}: {
  project: OperationsProjectRecord | null;
  summary: ReturnType<typeof buildOperationsSummary>;
  onClear: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <aside className="pointer-events-auto absolute inset-x-3 bottom-3 z-40 max-h-[62vh] md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:w-[420px] md:max-h-none xl:w-[460px]">
      <AnimatePresence mode="wait">
        {project ? (
          <motion.div
            key={project.id}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.24 }}
            className="h-full"
          >
            <InspectorShell>
              <div className="flex items-start justify-between gap-3 border-b border-ig-border-subtle/60 px-4 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="ig-ops-hud-inner flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ig-border-subtle bg-ig-panel/65 text-sm font-semibold text-ig-fg-strong">
                    {project.companyInitials}
                  </span>
                  <div className="min-w-0">
                    <p
                      className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: STATUS_TOKEN[project.status] }}
                    >
                      {getOperationsStatusLabel(project.status)} · {project.uf}
                    </p>
                    <h2 className="mt-1 line-clamp-2 text-base font-semibold leading-tight text-ig-fg-strong">
                      {project.name}
                    </h2>
                    <p className="mt-1 truncate text-ig-caption text-ig-fg-muted">{project.client}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClear}
                  className="ig-ops-hud-inner inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-panel/55 px-2.5 py-1.5 text-ig-caption text-ig-fg-muted transition-colors hover:text-ig-fg-strong"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Brasil
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto px-4 py-4 max-lg:max-h-[calc(58vh-5rem)] md:max-h-[calc(100%-5.5rem)]">
                <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-ig-caption text-ig-fg-muted">Progresso físico</p>
                      <p className="ig-tabular mt-1 text-2xl font-semibold text-ig-fg-strong">{project.progress}%</p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.09em]"
                      style={{
                        background: `color-mix(in oklab, ${STATUS_TOKEN[project.status]} 14%, transparent)`,
                        color: STATUS_TOKEN[project.status],
                      }}
                    >
                      {getOperationsStatusLabel(project.status)}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-ig-bg-raised">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${project.progress}%`,
                        background: `linear-gradient(90deg, ${STATUS_TOKEN[project.status]}, var(--ig-accent))`,
                      }}
                    />
                  </div>
                </div>

                <InfoGrid
                  items={[
                    { label: "Localização", value: project.locationLabel, icon: MapPinned },
                    { label: "Budget/contrato", value: formatOperationsMoney(project.contractTotal), icon: BriefcaseBusiness },
                    { label: "Milestone", value: project.deadlineLabel, icon: CalendarClock },
                    { label: "Gestor responsável", value: project.responsibleManager, icon: UserRound },
                    { label: "Última atualização", value: formatOperationsDate(project.lastUpdate), icon: Clock3 },
                    { label: "Tipo", value: project.type, icon: Layers3 },
                  ]}
                />

                <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
                    <div className="min-w-0">
                      <p className="text-ig-caption text-ig-fg-muted">Risco principal</p>
                      <p className="mt-1 text-sm font-medium leading-snug text-ig-fg-strong">{project.mainRisk}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <LinkedMetric label="Riscos" value={project.linkedRisks} />
                  <LinkedMetric label="Ações" value={project.linkedActions} />
                  <LinkedMetric label="Contratos" value={project.linkedContracts} />
                </div>

                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors"
                  style={{
                    borderColor: "color-mix(in oklab, var(--ig-accent) 46%, var(--ig-border-subtle))",
                    background: "color-mix(in oklab, var(--ig-accent) 14%, var(--ig-panel))",
                    color: "var(--ig-accent)",
                  }}
                >
                  View full project
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </InspectorShell>
          </motion.div>
        ) : (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.24 }}
            className="h-full"
          >
            <InspectorShell>
              <div className="border-b border-ig-border-subtle/60 px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className="ig-ops-hud-inner flex h-9 w-9 items-center justify-center rounded-xl border border-ig-border-subtle bg-ig-panel/60 text-ig-accent">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-accent">
                      Executive overview
                    </p>
                    <h2 className="text-base font-semibold text-ig-fg-strong">Operação Brasil</h2>
                  </div>
                </div>
              </div>

              <div className="space-y-4 overflow-y-auto px-4 py-4 max-lg:max-h-[calc(58vh-5rem)] md:max-h-[calc(100%-5.5rem)]">
                <div className="grid grid-cols-2 gap-2">
                  <OverviewMetric label="Projetos mapeados" value={summary.totalProjects} icon={MapPinned} />
                  <OverviewMetric label="Frentes ativas" value={summary.activeFronts} icon={Zap} />
                  <OverviewMetric label="Projetos críticos" value={summary.criticalProjects} icon={ShieldAlert} danger />
                  <OverviewMetric label="Último sync" value={formatOperationsDate(summary.lastUpdate)} icon={Clock3} />
                </div>

                <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" />
                    <div>
                      <p className="text-ig-caption text-ig-fg-muted">Operational insight</p>
                      <p className="mt-1 text-sm leading-snug text-ig-fg-strong">
                        {summary.criticalProjects > 0
                          ? `${summary.criticalProjects} frente(s) exigem leitura executiva antes do próximo marco. Priorize riscos, ações e contratos vinculados.`
                          : "Carteira mapeada sem alerta crítico aberto. Mantenha monitoramento de marcos, riscos e ativos vinculados."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <LinkedMetric label="Riscos" value={summary.linkedRisks} />
                  <LinkedMetric label="Ações" value={summary.linkedActions} />
                  <LinkedMetric label="Contratos" value={summary.linkedContracts} />
                </div>

                <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3">
                  <p className="text-ig-caption text-ig-fg-muted">Valor em governança</p>
                  <p className="ig-tabular mt-1 text-xl font-semibold text-ig-fg-strong">
                    {formatOperationsMoney(summary.contractTotal)}
                  </p>
                </div>
              </div>
            </InspectorShell>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

function InspectorShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="ig-ops-hud-surface h-full max-h-full overflow-hidden rounded-2xl border border-ig-border-subtle/70 shadow-2xl backdrop-blur-2xl"
      style={{
        background:
          "linear-gradient(145deg, color-mix(in oklab, var(--ig-panel) 84%, transparent), color-mix(in oklab, var(--ig-bg-raised) 62%, transparent))",
        boxShadow:
          "0 22px 58px -34px rgba(0,0,0,.7), inset 0 1px 0 color-mix(in oklab, white 18%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function InfoGrid({
  items,
}: {
  items: Array<{ label: string; value: string; icon: React.ComponentType<{ className?: string }> }>;
}) {
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="ig-ops-hud-inner flex min-w-0 items-start gap-2 rounded-xl border border-ig-border-subtle/60 bg-ig-panel/40 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" />
            <div className="min-w-0">
              <p className="text-ig-caption text-ig-fg-muted">{item.label}</p>
              <p className="mt-0.5 line-clamp-2 text-sm font-medium text-ig-fg-strong">{item.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LinkedMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3 text-center">
      <Link2 className="mx-auto h-3.5 w-3.5 text-ig-accent" />
      <p className="ig-tabular mt-1 text-lg font-semibold text-ig-fg-strong">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ig-fg-muted">{label}</p>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  icon: Icon,
  danger,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}) {
  return (
    <div className="ig-ops-hud-inner rounded-xl border border-ig-border-subtle/60 bg-ig-panel/45 p-3">
      <Icon className={cn("h-4 w-4", danger ? "text-ig-danger" : "text-ig-accent")} />
      <p className="ig-tabular mt-2 text-lg font-semibold text-ig-fg-strong">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ig-fg-muted">{label}</p>
    </div>
  );
}

function PrintReport({
  summary,
  selectedProject,
}: {
  summary: ReturnType<typeof buildOperationsSummary>;
  selectedProject: OperationsProjectRecord | null;
}) {
  return (
    <div className="ig-ops3d-print hidden bg-white p-8 text-slate-950">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Insight Operations 3D</p>
        <h1 className="mt-2 text-2xl font-semibold">Relatório operacional do digital twin</h1>
        <p className="mt-1 text-sm text-slate-600">Última atualização: {formatOperationsDate(summary.lastUpdate)}</p>
      </div>

      <div className="mt-6 grid grid-cols-5 gap-3">
        <PrintMetric label="Projetos mapeados" value={summary.totalProjects} />
        <PrintMetric label="Frentes ativas" value={summary.activeFronts} />
        <PrintMetric label="Alertas críticos" value={summary.criticalProjects} />
        <PrintMetric label="Ativos vinculados" value={summary.assetsLinked} />
        <PrintMetric label="Riscos vinculados" value={summary.linkedRisks} />
      </div>

      {selectedProject && (
        <div className="mt-8 rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Projeto selecionado</p>
              <h2 className="mt-1 text-xl font-semibold">{selectedProject.name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedProject.client} · {selectedProject.locationLabel} · {getOperationsStatusLabel(selectedProject.status)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Progresso</p>
              <p className="text-2xl font-semibold tabular-nums">{selectedProject.progress}%</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <PrintField label="Budget/contrato" value={formatOperationsMoney(selectedProject.contractTotal, false)} />
            <PrintField label="Milestone" value={selectedProject.deadlineLabel} />
            <PrintField label="Gestor responsável" value={selectedProject.responsibleManager} />
            <PrintField label="Última atualização" value={formatOperationsDate(selectedProject.lastUpdate)} />
            <PrintField label="Risco principal" value={selectedProject.mainRisk} wide />
            <PrintField
              label="Riscos / ações / contratos"
              value={`${selectedProject.linkedRisks} riscos · ${selectedProject.linkedActions} ações · ${selectedProject.linkedContracts} contratos`}
              wide
            />
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Risk/alert summary</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {summary.criticalProjects > 0
            ? `${summary.criticalProjects} projeto(s) aparecem como críticos no mapa. O snapshot inclui ${summary.linkedRisks} riscos, ${summary.linkedActions} ações e ${summary.linkedContracts} contratos vinculados.`
            : `Sem projeto crítico no snapshot. A carteira mantém ${summary.linkedRisks} riscos e ${summary.linkedActions} ações em acompanhamento.`}
        </p>
      </div>
    </div>
  );
}

function PrintMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PrintField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn(wide && "col-span-2")}>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-1 text-slate-900">{value}</p>
    </div>
  );
}

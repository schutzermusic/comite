"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
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
import {
  AxPage, Chip, CommandHeader, EmptyState, Meter, SignalStrip, Skeleton, dateShort, href, plural, relativeDue, useResource, useUrlParam,
  type Tone,
} from "@/components/ax";
import type { OperationsOverview } from "@/lib/operations/overview";
import type { ProjectOverviewPayload } from "@/components/operations/projects/ProjectGlance";
import type { ProjectPlanningModel } from "@/lib/operations/planning/read-model";
import { ReadinessChip, ReadinessStrip } from "@/components/operations/planning/shared";
import { HEALTH_LABEL } from "@/lib/operations/projects/health";
import { serviceOrderStatusLabels } from "@/lib/operations/service-orders/labels";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getProjectsAsync, getProjectsV2Async } from "@/lib/services/projects";

type OverviewPayload = OperationsOverview & { ok: true };
type Health = NonNullable<OverviewPayload["projectHealth"]>[number];
const TONE_STATUS: Record<Health["tone"], OperationsProjectStatus> = { danger: "critical", warning: "attention", success: "active" };
const STATUS_TONE: Record<OperationsProjectStatus, Tone> = { critical: "danger", attention: "warning", active: "success", completed: "neutral" };

/**
 * MAPA DE OPERAÇÕES — o globo 3D da carteira (Cesium), com o painel
 * OPERACIONAL ao lado: onde agir primeiro (a mesma saúde da Visão Geral — a
 * pior trava decide) e, com um projeto escolhido, a saúde explicada, as
 * próximas frentes com a prontidão delas, a OS que autoriza o trabalho e o
 * que trava. O marcador tem a cor dessa MESMA leitura. `?project=` abre o
 * mapa já no projeto.
 */
export default function Operations3DPage() {
  return <AxPage testId="operations-map"><OperationsMap /></AxPage>;
}

function OperationsMap() {
  const { organization } = useCurrentUser();
  // Organização de demonstração lê a carteira de exemplo; a real lê os projetos do inquilino.
  const demo = organization?.is_demo === true;
  const [liveRecords, setLiveRecords] = useState<OperationsProjectRecord[]>([]);
  useEffect(() => {
    if (demo) return undefined;
    let active = true;
    void Promise.all([getProjectsAsync(), getProjectsV2Async()])
      .then(([liveProjects, liveProjectsV2]) => { if (active) setLiveRecords(buildOperationsProjectRecords(liveProjects, liveProjectsV2)); })
      .catch(() => { if (active) setLiveRecords([]); });
    return () => { active = false; };
  }, [organization?.id, demo]);
  const demoRecords = useMemo(() => (demo ? buildOperationsProjectRecords() : []), [demo]);
  const records = demo ? demoRecords : liveRecords;

  const ops = useResource<OverviewPayload>("/api/operations/overview");
  const health = useMemo(() => new Map((ops.data?.projectHealth ?? []).map((h) => [h.projectId, h])), [ops.data]);
  // O marcador tem a cor da saúde OPERACIONAL (cronograma, material, cliente, OS) — não de um campo digitado no projeto.
  const projects = useMemo(() => records.map((r) => {
    const h = health.get(r.id);
    if (!h || r.status === "completed") return r;
    return { ...r, status: TONE_STATUS[h.tone], mainRisk: h.reasons[0] ?? "Sem trava operacional" };
  }), [records, health]);
  const summary = useMemo(() => buildOperationsSummary(projects), [projects]);

  const [selectedId, setSelectedId] = useUrlParam<string>("project", "");
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const approximate = projects.filter((p) => p.approximate).length;
  const attention = projects.filter((p) => p.status === "attention").length;

  return (
    <>
      <style jsx global>{`
        @media print {
          html, body { background: #ffffff !important; color: #111827 !important; }
          .ig-ops3d-live { display: none !important; }
          .ig-ops3d-print { display: block !important; }
        }
      `}</style>

      <div className="ig-ops3d-live ax-stack" style={{ gap: 18 }}>
        <CommandHeader domain="operations" area="Mapa de Operações" title="Onde a operação está, e o que trava"
          context={<>
            <span><strong>{summary.totalProjects}</strong> {summary.totalProjects === 1 ? "projeto" : "projetos"} no globo</span>
            {summary.criticalProjects > 0 && <span className="ax-danger-text"><strong>{summary.criticalProjects}</strong> com trava crítica</span>}
            {approximate > 0 && <span>{plural(approximate, "posição aproximada", "posições aproximadas")} (pela UF)</span>}
          </>}
          actions={<>
            <Link className="ax-btn" href="/operacoes">Visão geral</Link>
            <button type="button" className="ax-btn" onClick={() => window.print()}><Download size={15} aria-hidden />Exportar PDF</button>
          </>} />

        <SignalStrip label="Sinais do mapa" items={[
          { label: "Projetos no globo", value: summary.totalProjects, hint: approximate ? `${approximate} sem coordenada — perto do centro da UF` : "todos com coordenada",
            onClick: () => setSelectedId(null) },
          { label: "Trava crítica", value: summary.criticalProjects, tone: summary.criticalProjects ? "danger" : undefined,
            hint: "atividade crítica, falta perto da necessidade, cliente vencido ou OS bloqueada",
            onClick: () => { const p = projects.find((x) => x.status === "critical"); if (p) setSelectedId(p.id); } },
          { label: "Em atenção", value: attention, tone: attention ? "warning" : undefined, hint: "material, medição ou risco pedindo ação",
            onClick: () => { const p = projects.find((x) => x.status === "attention"); if (p) setSelectedId(p.id); } },
          ...(ops.data?.map ? [ops.data.map.located + ops.data.map.unresolved === 0
            ? { label: "Endereço canônico", value: 0, hint: "nenhum projeto com endereço resolvido — as posições vêm da UF", tone: "warning" as const }
            : { label: "Endereço canônico", value: `${ops.data.map.located}/${ops.data.map.located + ops.data.map.unresolved}`,
              hint: ops.data.map.unresolved ? plural(ops.data.map.unresolved, "projeto sem endereço resolvido", "projetos sem endereço resolvido") : "todos resolvidos",
              tone: ops.data.map.unresolved ? "warning" as const : undefined }] : []),
        ]} />

        <section className="ax-mapstage" aria-label="Globo das operações">
          <CesiumOperationsMap projects={projects} selectedProjectId={selectedId || null} onSelectProject={(p) => setSelectedId(p?.id ?? null)}>
            <aside className="ax-mappanel" aria-label={selected ? `Projeto ${selected.name}` : "Onde agir primeiro"} data-testid="map-panel">
              {selected
                ? <SelectedProject key={selected.id} record={selected} onClear={() => setSelectedId(null)} />
                : <Portfolio projects={projects} health={health} loading={!ops.data && ops.state !== "error"} onSelect={(id) => setSelectedId(id)} />}
            </aside>
          </CesiumOperationsMap>
        </section>
      </div>

      <PrintReport summary={summary} selectedProject={selected ?? projects.find((p) => p.status === "critical") ?? projects[0] ?? null} />
    </>
  );
}

/** Sem projeto escolhido: a carteira em ordem de ação — a mesma saúde da Visão Geral, com o motivo. */
function Portfolio({ projects, health, loading, onSelect }: {
  projects: OperationsProjectRecord[]; health: Map<string, Health>; loading: boolean; onSelect: (id: string) => void;
}) {
  const rank: Record<OperationsProjectStatus, number> = { critical: 0, attention: 1, active: 2, completed: 3 };
  const ordered = [...projects].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  return (
    <>
      <header className="ax-mappanel-head">
        <span className="ax-eyebrow"><b>Operação Brasil</b> · onde agir primeiro</span>
        <h2>Carteira por prioridade</h2>
        <p>A pior trava decide a cor — cronograma, material, cliente e OS, a mesma leitura da Visão Geral.</p>
      </header>
      <div className="ax-mappanel-body">
        {loading && !projects.length ? <Skeleton /> : ordered.length === 0 ? (
          <EmptyState compact title="Nenhum projeto no globo">Projetos com endereço ou UF aparecem aqui.</EmptyState>
        ) : (
          <ul className="ax-maplist">
            {ordered.map((p) => {
              const h = health.get(p.id);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onSelect(p.id)} data-tone={STATUS_TONE[p.status]}>
                    <span className="ax-maplist-main">
                      <strong>{p.name}</strong>
                      <small>{p.client} · {p.locationLabel}{p.approximate ? " (aprox.)" : ""}</small>
                      <span className="ax-maplist-why">{h ? (h.reasons.length ? h.reasons.join(" · ") : "sem trava operacional") : p.mainRisk}</span>
                    </span>
                    <span className="ax-maplist-side">
                      <Chip tone={STATUS_TONE[p.status]}>{getOperationsStatusLabel(p.status)}</Chip>
                      {h?.nextMilestone && <small>marco {dateShort(h.nextMilestone)}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

type Planning = ProjectPlanningModel & { ok: true; capabilities: { manage: boolean } };

/** Projeto escolhido: saúde explicada, próximas frentes com prontidão, autorização e o que trava — e para onde ir. */
function SelectedProject({ record, onClear }: { record: OperationsProjectRecord; onClear: () => void }) {
  const overview = useResource<ProjectOverviewPayload>(`/api/operations/projects/${encodeURIComponent(record.id)}/overview`);
  const planning = useResource<Planning>(`/api/operations/projects/${encodeURIComponent(record.id)}/requirements`);
  const o = overview.data;
  const plan = planning.data;
  const readiness = new Map((plan?.readinessByActivity ?? []).map((a) => [a.activityId, a]));
  const fronts = o ? (plan?.activities ?? []).filter((a) => a.start && a.start >= o.today)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")).slice(0, 3) : [];
  const tone = STATUS_TONE[record.status];
  return (
    <>
      <header className="ax-mappanel-head">
        <div className="ax-between">
          <span className="ax-eyebrow" data-tone={tone}><b>{getOperationsStatusLabel(record.status)}</b> · {record.locationLabel}{record.approximate ? " (posição aproximada)" : ""}</span>
          <button type="button" className="ax-btn ghost sm" onClick={onClear}><ArrowLeft size={13} aria-hidden />Brasil</button>
        </div>
        <h2>{record.name}</h2>
        <p>{record.client}</p>
      </header>
      <div className="ax-mappanel-body">
        {!o ? (overview.state === "error" ? <EmptyState compact title="Não foi possível ler o projeto">{overview.message}</EmptyState> : <Skeleton />) : (
          <>
            <dl className="ax-mapfacts">
              <div><dt>Saúde</dt><dd data-tone={o.health.level === "critical" ? "danger" : o.health.level === "attention" ? "warning" : undefined}>
                {HEALTH_LABEL[o.health.level]}</dd>
                <small>{o.health.reasons.slice(0, 2).map((r) => r.text).join(" · ") || "sem bloqueio"}</small></div>
              <div><dt>Avanço físico</dt><dd>{o.progress.percent === null ? "—" : `${o.progress.percent.toLocaleString("pt-BR")}%`}</dd>
                {o.progress.percent !== null && <Meter value={o.progress.percent / 100} label="Avanço físico" />}</div>
              <div><dt>Próximo marco</dt><dd>{o.nextMilestones[0] ? dateShort(o.nextMilestones[0].date) : "—"}</dd>
                <small>{o.nextMilestones[0]?.title ?? "nenhum marco futuro"}</small></div>
              <div><dt>Autorização</dt><dd>{o.serviceOrders[0]
                ? <Link className="ax-link" href={href.serviceOrder(o.serviceOrders[0].id)}>{o.serviceOrders[0].osNumber}</Link> : "sem OS"}</dd>
                <small>{o.serviceOrders[0] ? `OS ${serviceOrderStatusLabels[o.serviceOrders[0].status].toLowerCase()}` : "o projeto nasce da OS emitida"}</small></div>
            </dl>

            <section className="ax-mapsection" aria-label="Próximas frentes">
              <h3>Próximas frentes</h3>
              {!plan ? <Skeleton /> : fronts.length === 0 ? <p className="ax-subtle">Nenhuma frente futura no cronograma.</p> : fronts.map((a) => {
                const r = readiness.get(a.id);
                return (
                  <div key={a.id} className="ax-mapfront">
                    <div className="ax-between"><strong>{a.title}</strong><ReadinessChip value={r?.overall ?? null} /></div>
                    <small>{dateShort(a.start)} · {relativeDue(a.start, o.today).text}</small>
                    <ReadinessStrip cells={r?.cells ?? {}} label={`Prontidão de ${a.title}`} />
                  </div>
                );
              })}
            </section>

            {o.blockers.length > 0 && (
              <section className="ax-mapsection" aria-label="O que trava">
                <h3>O que trava <span className="ax-count danger">{o.blockers.length}</span></h3>
                <ul className="ax-mapblockers">
                  {o.blockers.slice(0, 4).map((b) => (
                    <li key={b.id} data-tone={b.tone}><strong>{b.title}</strong><small>{b.issue}{b.due ? ` · ${relativeDue(b.due, o.today).text}` : ""}</small></li>
                  ))}
                </ul>
              </section>
            )}

            {o.measurements && o.measurements.pending > 0 && (
              <p className="ax-note" style={{ margin: 0 }}>{plural(o.measurements.pending, "medição pendente da operação", "medições pendentes da operação")}
                {o.measurements.next ? ` — próxima ${o.measurements.next.key}, ${dateShort(o.measurements.next.expected)}` : ""}.</p>
            )}
          </>
        )}
      </div>
      <footer className="ax-mappanel-foot">
        <Link className="ax-btn primary" href={href.project(record.id)}>Abrir projeto<ArrowUpRight size={14} aria-hidden /></Link>
        <Link className="ax-btn" href={href.project(record.id, "timeline")}>Plano</Link>
        <Link className="ax-btn" href={href.project(record.id, "supply")}>Materiais</Link>
      </footer>
    </>
  );
}

function PrintReport({ summary, selectedProject }: {
  summary: ReturnType<typeof buildOperationsSummary>; selectedProject: OperationsProjectRecord | null;
}) {
  return (
    <div className="ig-ops3d-print hidden bg-white p-8 text-slate-950">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Mapa de Operações</p>
        <h1 className="mt-2 text-2xl font-semibold">Relatório operacional do mapa</h1>
        <p className="mt-1 text-sm text-slate-600">Última atualização: {formatOperationsDate(summary.lastUpdate)}</p>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-3">
        <PrintMetric label="Projetos no globo" value={summary.totalProjects} />
        <PrintMetric label="Frentes ativas" value={summary.activeFronts} />
        <PrintMetric label="Trava crítica" value={summary.criticalProjects} />
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
              <p className="text-xs text-slate-500">Avanço</p>
              <p className="text-2xl font-semibold tabular-nums">{selectedProject.progress}%</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <PrintField label="Contrato" value={selectedProject.contractTotal ? formatOperationsMoney(selectedProject.contractTotal, false) : "sem valor declarado"} />
            <PrintField label="Próximo marco" value={selectedProject.deadlineLabel} />
            <PrintField label="Gestor responsável" value={selectedProject.responsibleManager} />
            <PrintField label="Última atualização" value={formatOperationsDate(selectedProject.lastUpdate)} />
            <PrintField label="Trava principal" value={selectedProject.mainRisk} wide />
          </div>
        </div>
      )}
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Resumo de travas</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {summary.criticalProjects > 0
            ? `${plural(summary.criticalProjects, "projeto aparece", "projetos aparecem")} com trava crítica no mapa. O retrato inclui ${summary.linkedRisks} riscos e ${summary.linkedActions} ações vinculados.`
            : `Nenhum projeto com trava crítica. A carteira mantém ${summary.linkedRisks} riscos e ${summary.linkedActions} ações em acompanhamento.`}
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

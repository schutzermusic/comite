'use client';

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  Calendar,
  DollarSign,
  FileText,
  ExternalLink,
  TrendingUp,
  AlertTriangle,
  GanttChart,
  Activity,
  X,
  Building2,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Upload,
  ImageOff,
} from 'lucide-react';
import type { Project } from '@/lib/types';
import { getProjectV2ById } from '@/lib/services/projects';
import {
  generateProjectAlerts,
  getHealthScoreColor,
  getSeverityColor,
  formatMoney,
} from '@/lib/utils/project-utils';
import { cn } from '@/lib/utils';
import { ProjectHealthIndicator } from './ProjectHealthIndicator';
import { HudStatusPill, HudProgressBar, HudButton } from '@/components/hud';

interface ProjectDetailDrawerProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_VARIANT: Record<string, 'active' | 'completed' | 'warning' | 'error' | 'neutral'> = {
  em_andamento: 'active',
  concluido: 'completed',
  pausado: 'warning',
  cancelado: 'error',
  planejamento: 'neutral',
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDate(iso?: string, withTime = false) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  } catch {
    return '—';
  }
}

export function ProjectDetailDrawer({
  project,
  open,
  onOpenChange,
}: ProjectDetailDrawerProps) {
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUploadedLogoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    e.target.value = '';
  }, []);

  useEffect(() => {
    return () => { if (uploadedLogoUrl) URL.revokeObjectURL(uploadedLogoUrl); };
  }, [uploadedLogoUrl]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onOpenChange(false);
    },
    [open, onOpenChange],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const v2 = useMemo(() => {
    if (!project) return undefined;
    try {
      return getProjectV2ById(project.id);
    } catch {
      return undefined;
    }
  }, [project]);

  const alerts = useMemo(() => (v2 ? generateProjectAlerts(v2).slice(0, 4) : []), [v2]);

  const openHighRisks = useMemo(
    () =>
      (v2?.risks || []).filter(
        (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
      ),
    [v2],
  );

  const milestones = useMemo(() => v2?.milestones?.slice(0, 5) || [], [v2]);

  const recentActivity = useMemo(() => {
    if (!v2?.audit_log) return [];
    return [...v2.audit_log]
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, 5);
  }, [v2]);

  if (!project) return null;

  const healthScore = v2?.health_score ?? 100;
  const healthColor = getHealthScoreColor(healthScore);
  const valorRestante = (project.valor_total || 0) - (project.valor_executado || 0);
  const progress = Math.max(0, Math.min(100, project.progresso_percentual || 0));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          'project-detail-drawer-v2',
          'w-full sm:w-[460px] sm:max-w-[460px] md:w-[520px] md:max-w-[520px]',
          'p-0 border-l',
          'overflow-hidden flex flex-col',
        )}
      >
        {/* Header */}
        <header className="relative px-5 pt-5 pb-4 border-b drawer-v2-divider">
          {/* Subtle accent halo */}
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-60"
            style={{
              background: `radial-gradient(60% 80% at 80% 0%, ${healthColor}14 0%, transparent 70%)`,
            }}
          />

          <div className="relative flex items-start gap-3">
            {/* Client logo area — upload-enabled */}
            <div className="relative shrink-0 group/logo">
              {uploadedLogoUrl ? (
                <div className="relative w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center drawer-v2-kpi-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={uploadedLogoUrl}
                    alt={project.cliente || 'Logo'}
                    className="max-h-full max-w-full object-contain"
                    style={{ opacity: 0.78 }}
                  />
                  <button
                    onClick={() => { URL.revokeObjectURL(uploadedLogoUrl); setUploadedLogoUrl(null); }}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/logo:opacity-100 transition-opacity rounded-xl"
                    aria-label="Remover logo"
                  >
                    <ImageOff className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1',
                    'drawer-v2-kpi-card drawer-v2-muted',
                    'border border-dashed opacity-60 hover:opacity-100 transition-opacity',
                  )}
                  title="Upload logo do cliente"
                  aria-label="Fazer upload do logo do cliente"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-semibold uppercase tracking-wide leading-none">Logo</span>
                </button>
              )}
              {!uploadedLogoUrl && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center bg-emerald-500 text-white shadow-md opacity-0 group-hover/logo:opacity-100 transition-opacity"
                  aria-label="Upload logo"
                >
                  <Upload className="w-2.5 h-2.5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleLogoUpload}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums tracking-wide border drawer-v2-chip">
                  {project.codigo || '—'}
                </span>
                <HudStatusPill variant={STATUS_VARIANT[project.status] ?? 'neutral'} size="sm">
                  {formatStatus(project.status)}
                </HudStatusPill>
                {project.sankhya_integrado && (
                  <HudStatusPill variant="info" size="sm">
                    Sankhya
                  </HudStatusPill>
                )}
              </div>
              <h2 className="mt-2 text-lg font-semibold drawer-v2-title leading-tight">
                {project.nome}
              </h2>
              <p className="mt-0.5 text-sm drawer-v2-subtitle truncate">
                {project.cliente || 'Cliente não informado'}
              </p>
            </div>

            <button
              onClick={() => onOpenChange(false)}
              className="ml-1 p-1.5 rounded-lg drawer-v2-close transition-colors"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Health + Progress strip */}
          <div className="relative mt-4 grid grid-cols-3 gap-3">
            <HeaderMetric
              label="Health"
              valueNode={
                <ProjectHealthIndicator score={healthScore} variant="ring" size="md" showLabel={false} />
              }
            />
            <HeaderMetric label="Progresso" value={`${progress}%`} accent={healthColor} />
            <HeaderMetric
              label="Valor Total"
              value={formatMoney(project.valor_total || 0)}
              compact
            />
          </div>

          {v2?.last_activity_at && (
            <div className="relative mt-3 flex items-center gap-1.5 text-[11px] drawer-v2-muted">
              <Activity className="w-3 h-3" />
              Última atividade: {formatDate(v2.last_activity_at, true)}
            </div>
          )}
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto drawer-v2-scroll px-5 py-5 space-y-6">
          {/* Risks & Alerts */}
          <Section
            icon={<ShieldAlert className="w-3.5 h-3.5" />}
            title="Riscos & Alertas"
            count={alerts.length + openHighRisks.length}
          >
            {alerts.length === 0 && openHighRisks.length === 0 ? (
              <EmptyHint icon={<ShieldAlert className="w-4 h-4" />} text="Nenhum risco ou alerta aberto" />
            ) : (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl drawer-v2-info-card"
                  >
                    <span
                      className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: getSeverityColor(a.severity) }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs drawer-v2-text">{a.message}</p>
                      <p className="text-[10px] drawer-v2-muted mt-0.5 capitalize">
                        {a.severity}
                      </p>
                    </div>
                  </div>
                ))}
                {openHighRisks.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl drawer-v2-info-card"
                  >
                    <AlertTriangle
                      className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
                      style={{ color: getSeverityColor(r.severity as 'low' | 'medium' | 'high' | 'critical') }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs drawer-v2-text font-medium">{r.title}</p>
                      <p className="text-[10px] drawer-v2-muted mt-0.5 capitalize">
                        {r.category} · {r.severity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Overview */}
          <Section icon={<Building2 className="w-3.5 h-3.5" />} title="Visão Geral">
            <Row label="Cliente" value={project.cliente || '—'} />
            <Row label="Comitê Supervisor" value={project.comite_nome || 'Sem supervisão'} />
            {project.comite_status && project.comite_nome && (
              <Row
                label="Status do Comitê"
                node={
                  <HudStatusPill
                    variant={
                      project.comite_status === 'ativo'
                        ? 'active'
                        : project.comite_status === 'atencao_necessaria'
                        ? 'warning'
                        : 'neutral'
                    }
                    size="sm"
                  >
                    {formatStatus(project.comite_status)}
                  </HudStatusPill>
                }
              />
            )}
            <Row
              label="Impacto"
              value={project.impacto_financeiro?.charAt(0).toUpperCase() + project.impacto_financeiro?.slice(1)}
            />
            <Row label="Risco Geral" value={project.risco_geral ? project.risco_geral.charAt(0).toUpperCase() + project.risco_geral.slice(1) : '—'} />
            <Row label="Responsável" value={project.responsavel?.nome || '—'} />
            {project.descricao && (
              <div className="pt-2">
                <p className="text-[10px] uppercase tracking-wider drawer-v2-label mb-1">Descrição</p>
                <p className="text-sm drawer-v2-text leading-relaxed">{project.descricao}</p>
              </div>
            )}
          </Section>

          {/* Health & Progress */}
          <Section icon={<Sparkles className="w-3.5 h-3.5" />} title="Saúde & Progresso">
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs drawer-v2-label">Progresso geral</span>
                  <span className="text-sm font-semibold drawer-v2-title tabular-nums">{progress}%</span>
                </div>
                <HudProgressBar value={progress} size="md" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniKpi label="Health Score" value={healthScore} suffix="" color={healthColor} />
                <MiniKpi
                  label="Riscos Abertos"
                  value={openHighRisks.length}
                  color={openHighRisks.length > 0 ? '#EF4444' : undefined}
                />
              </div>
            </div>
          </Section>

          {/* Timeline */}
          <Section icon={<Calendar className="w-3.5 h-3.5" />} title="Timeline">
            <Row label="Início" value={formatDate(project.data_inicio)} />
            <Row label="Criado em" value={formatDate(project.created_date)} />
            {v2?.last_activity_at && (
              <Row label="Última atividade" value={formatDate(v2.last_activity_at, true)} />
            )}
          </Section>

          {/* Financial */}
          <Section icon={<DollarSign className="w-3.5 h-3.5" />} title="Financeiro">
            <div className="rounded-xl p-3.5 drawer-v2-kpi-card">
              <div className="flex items-center justify-between">
                <span className="text-xs drawer-v2-label">Valor Total</span>
                <TrendingUp className="w-3.5 h-3.5 drawer-v2-accent" />
              </div>
              <p className="text-xl font-bold drawer-v2-title mt-1.5 tabular-nums">
                {formatMoney(project.valor_total)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="p-3 rounded-xl drawer-v2-kpi-card">
                <span className="text-[10px] drawer-v2-label block mb-1 uppercase tracking-wider">Executado</span>
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#10B981' }}>
                  {formatMoney(project.valor_executado)}
                </p>
              </div>
              <div className="p-3 rounded-xl drawer-v2-kpi-card">
                <span className="text-[10px] drawer-v2-label block mb-1 uppercase tracking-wider">Restante</span>
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#F59E0B' }}>
                  {formatMoney(valorRestante)}
                </p>
              </div>
            </div>
            {project.roi_estimado && (
              <Row label="ROI Estimado" value={`${project.roi_estimado}%`} />
            )}
          </Section>

          {/* Milestones */}
          <Section icon={<ListChecks className="w-3.5 h-3.5" />} title="Milestones" count={milestones.length}>
            {milestones.length === 0 ? (
              <EmptyHint icon={<ListChecks className="w-4 h-4" />} text="Nenhum milestone cadastrado" />
            ) : (
              <div className="space-y-2">
                {milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 p-2.5 rounded-xl drawer-v2-info-card">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        m.status === 'completed' && 'bg-emerald-500',
                        m.status === 'overdue' && 'bg-red-500',
                        m.status === 'pending' && 'bg-amber-500',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs drawer-v2-text truncate">{m.name}</p>
                      <p className="text-[10px] drawer-v2-muted">{formatDate(m.date)}</p>
                    </div>
                    <span className="text-[10px] capitalize drawer-v2-muted">{m.status}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Latest Activity */}
          <Section icon={<Activity className="w-3.5 h-3.5" />} title="Última Atividade">
            {recentActivity.length === 0 ? (
              <EmptyHint icon={<Activity className="w-4 h-4" />} text="Nenhuma atividade recente registrada" />
            ) : (
              <div className="space-y-2">
                {recentActivity.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5 p-2.5 rounded-xl drawer-v2-info-card">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs drawer-v2-text capitalize">
                        <span className="font-medium">{entry.action}</span>
                        {entry.path ? <span className="drawer-v2-muted"> · {entry.path}</span> : null}
                      </p>
                      <p className="text-[10px] drawer-v2-muted">
                        {entry.actor} · {formatDate(entry.timestamp, true)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Footer Quick Actions */}
        <footer className="px-5 py-4 border-t drawer-v2-divider space-y-2">
          <Link
            href={`/projetos/${project.id}`}
            className="block"
            aria-label={`Abrir página completa de ${project.nome}`}
          >
            <HudButton
              variant="primary"
              size="md"
              className="w-full"
              leftIcon={<ExternalLink className="w-4 h-4" />}
            >
              Abrir Página Completa
            </HudButton>
          </Link>
          <div className="grid grid-cols-4 gap-2">
            <Link href={`/projetos/${project.id}?tab=timeline`} aria-label="Ver timeline do projeto">
              <HudButton variant="ghost" size="sm" className="w-full" leftIcon={<GanttChart className="w-3.5 h-3.5" />}>
                Timeline
              </HudButton>
            </Link>
            <Link href={`/projetos/${project.id}?tab=finance`} aria-label="Ver finanças do projeto">
              <HudButton variant="ghost" size="sm" className="w-full" leftIcon={<DollarSign className="w-3.5 h-3.5" />}>
                Finanças
              </HudButton>
            </Link>
            <Link href={`/projetos/${project.id}/analytics`} aria-label="Ver analytics do projeto">
              <HudButton variant="ghost" size="sm" className="w-full" leftIcon={<Activity className="w-3.5 h-3.5" />}>
                Analytics
              </HudButton>
            </Link>
            <Link
              href={`/projetos/${project.id}#documentos`}
              aria-label="Ver documentos do projeto"
            >
              <HudButton variant="ghost" size="sm" className="w-full" leftIcon={<FileText className="w-3.5 h-3.5" />}>
                Docs
              </HudButton>
            </Link>
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function EmptyHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 p-3 rounded-xl drawer-v2-info-card">
      <span className="drawer-v2-muted">{icon}</span>
      <span className="text-xs drawer-v2-muted">{text}</span>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] drawer-v2-section mb-3 flex items-center gap-2">
        {icon}
        {title}
        {typeof count === 'number' && count > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] drawer-v2-chip">
            {count}
          </span>
        )}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  node,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs drawer-v2-label flex-shrink-0">{label}</span>
      {node ? (
        <div className="text-right">{node}</div>
      ) : (
        <span className="text-sm drawer-v2-text text-right truncate">{value || '—'}</span>
      )}
    </div>
  );
}

function HeaderMetric({
  label,
  value,
  valueNode,
  accent,
  compact,
}: {
  label: string;
  value?: string | number;
  valueNode?: React.ReactNode;
  accent?: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl drawer-v2-kpi-card px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider drawer-v2-label">{label}</p>
      <div className="mt-1">
        {valueNode ? (
          valueNode
        ) : (
          <p
            className={cn(
              'font-semibold drawer-v2-title tabular-nums',
              compact ? 'text-sm' : 'text-base',
            )}
            style={accent ? { color: accent } : undefined}
          >
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

function MiniKpi({
  label,
  value,
  suffix = '',
  color,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="p-3 rounded-xl drawer-v2-kpi-card">
      <p className="text-[10px] uppercase tracking-wider drawer-v2-label">{label}</p>
      <p
        className="mt-1 text-lg font-semibold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
        {suffix}
      </p>
    </div>
  );
}

export default ProjectDetailDrawer;

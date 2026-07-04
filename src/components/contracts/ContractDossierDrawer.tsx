'use client';

/**
 * Contract Dossier — premium right-side drawer.
 *
 * Mirrors the Projetos / Riscos drawer behavior (HudDrawer portal + structured
 * sections + sticky quick-action footer). Consumes the same enriched
 * ContractGovernanceRecord used across the contracts module, so no data is
 * duplicated — the contract stays the governance/legal source and the actions
 * link downstream execution modules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HudDrawer, HudButton, HudStatusPill, HudProgressBar, HudBadge } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
  type GovernanceSectionQuality,
} from '@/components/contracts/contract-governance-data';
import {
  getContractById,
  createTaskFromObligation,
  updateContractDocumentStatus,
  listContractRelatedTasks,
  computeApprovalSla,
  type ContractDetail,
  type ContractRelatedTask,
} from '@/lib/contracts/contract-service';
import { useContractItemModals } from '@/components/contracts/useContractItemModals';
import {
  AlertTriangle,
  Archive,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FileText,
  GanttChartSquare,
  Loader2,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;
function riskVariant(risk: ContractGovernanceRecord['contract']['riskClassification']) {
  return risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'active';
}

const statusLabels: Record<string, string> = {
  negotiation: 'Negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo',
  expiring_soon: 'Expirando',
  expired: 'Expirado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

export interface ContractDossierDrawerProps {
  record: ContractGovernanceRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onView: (record: ContractGovernanceRecord) => void;
  onLinkProject: (record: ContractGovernanceRecord) => void;
  onCreateTask: (record: ContractGovernanceRecord) => void;
  onCreateRisk: (record: ContractGovernanceRecord) => void;
  onLinkExistingRisk: (record: ContractGovernanceRecord) => void;
  onAttachDocument: (record: ContractGovernanceRecord) => void;
  onSendToLegal: (record: ContractGovernanceRecord) => void;
  onReviewApproval: (record: ContractGovernanceRecord) => void;
  onCreateObligation: () => void;
  onCreateBilling: () => void;
  onViewDocuments: (record: ContractGovernanceRecord) => void;
  onExportPdf: (record: ContractGovernanceRecord) => void;
  onOpenFinance: (record: ContractGovernanceRecord) => void;
  onOpenBilling: (record: ContractGovernanceRecord) => void;
  /** UI-level RBAC gating; Supabase RLS enforces server-side. */
  permissions: { edit: boolean; approve: boolean; uploadDoc: boolean };
  /** Called after an in-drawer item mutation so the page governance/KPIs refresh. */
  onDataChanged?: () => Promise<void> | void;
}

function QualityBadge({ quality }: { quality?: GovernanceSectionQuality }) {
  if (!quality) return null;
  const live = quality === 'live';
  return (
    <HudBadge variant={live ? 'success' : 'subtle'} size="sm">
      {live ? 'Ao vivo' : 'Estimado'}
    </HudBadge>
  );
}

function Section({ title, icon, quality, children }: { title: string; icon: React.ReactNode; quality?: GovernanceSectionQuality; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-ig-fg-muted">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
        </div>
        <QualityBadge quality={quality} />
      </div>
      {children}
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] font-medium text-ig-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-semibold text-ig-fg-strong">{children}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-ig-success' : tone === 'warning' ? 'text-ig-warning' : tone === 'danger' ? 'text-ig-danger' : 'text-ig-fg-strong';
  return (
    <div className="min-w-0 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  value,
  href,
  badge,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  badge?: React.ReactNode;
  muted?: boolean;
}) {
  const body = (
    <div className="flex items-center gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2 transition-colors hover:border-ig-border-strong">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle bg-ig-panel ${muted ? 'text-ig-fg-subtle' : 'text-ig-accent'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
        <p className={`truncate text-[12px] font-semibold ${muted ? 'text-ig-fg-muted' : href ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>{value}</p>
      </div>
      {badge}
    </div>
  );
  if (href) {
    return (
      <Link href={href} onClick={(event) => event.stopPropagation()}>
        {body}
      </Link>
    );
  }
  return body;
}

export function ContractDossierDrawer({
  record,
  isOpen,
  onClose,
  onView,
  onLinkProject,
  onCreateTask,
  onCreateRisk,
  onLinkExistingRisk,
  onAttachDocument,
  onSendToLegal,
  onReviewApproval,
  onCreateObligation,
  onCreateBilling,
  onViewDocuments,
  onExportPdf,
  onOpenFinance,
  onOpenBilling,
  permissions,
  onDataChanged,
}: ContractDossierDrawerProps) {
  const { notify } = useHudToast();
  const contractId = record?.contract.id ?? null;
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relatedTasks, setRelatedTasks] = useState<ContractRelatedTask[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // All state writes happen inside this callback (not lexically in the effect),
  // so the effect body stays free of synchronous setState.
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const [nextDetail, tasks] = await Promise.all([getContractById(id), listContractRelatedTasks(id)]);
      setDetail(nextDetail);
      setRelatedTasks(tasks);
    } catch {
      setDetail(null);
      setRelatedTasks([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !contractId) return;
    void loadDetail(contractId);
  }, [isOpen, contractId, loadDetail]);

  const refreshAfterMutation = useCallback(async () => {
    if (contractId) await loadDetail(contractId);
    if (onDataChanged) await onDataChanged();
  }, [contractId, loadDetail, onDataChanged]);

  const itemModals = useContractItemModals({ onSuccess: refreshAfterMutation });

  const runItemAction = useCallback(
    async (key: string, action: () => Promise<unknown>, successMsg: string) => {
      setBusyId(key);
      try {
        await action();
        await refreshAfterMutation();
        notify(successMsg, { variant: 'success' });
      } catch (err) {
        notify('Não foi possível concluir', {
          description: err instanceof Error ? err.message : 'Erro inesperado.',
          variant: 'error',
        });
      } finally {
        setBusyId(null);
      }
    },
    [notify, refreshAfterMutation],
  );

  if (!record) return null;

  const sla = detail ? computeApprovalSla(detail.approvals) : null;
  const slaHours = sla?.avgHours ?? null;
  const STEP_LABELS: Record<string, string> = { juridico: 'Jurídico', financeiro: 'Financeiro', comite: 'Comitê', diretoria: 'Diretoria' };

  const billedPercent = record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0;
  const legalLabel = record.legalStatus === 'approved' ? 'Aprovado' : record.legalStatus === 'review' ? 'Em revisão' : 'Pendente';
  const financialLabel = record.financialStatus === 'ok' ? 'Liberado' : record.financialStatus === 'attention' ? 'Atenção' : 'Bloqueado';
  const statusLabel = statusLabels[record.contract.status] ?? record.contract.status;
  const openObligations = record.obligations.filter((o) => o.status !== 'done').length;
  const overdueObligations = record.obligations.filter((o) => o.status === 'overdue').length;
  const dq = record.dataQuality;
  const linksQuality: GovernanceSectionQuality | undefined = dq
    ? (dq.projectLink === 'live' || dq.risks === 'live' || dq.billing === 'live' || dq.documents === 'live' ? 'live' : 'estimated')
    : undefined;

  const canGovern = permissions.edit || permissions.approve || permissions.uploadDoc;
  const footer = (
    <div className="space-y-2.5">
      {/* Navegação para módulos (leitura) */}
      <div className="grid grid-cols-3 gap-2">
        <HudButton variant="secondary" size="sm" leftIcon={<Wallet className="h-4 w-4" />} onClick={() => onOpenFinance(record)}>
          Financeiro
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<Receipt className="h-4 w-4" />} onClick={() => onOpenBilling(record)}>
          Faturamento
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<Archive className="h-4 w-4" />} onClick={() => onViewDocuments(record)}>
          Documentos
        </HudButton>
      </div>

      {/* Ações de governança — gated por RBAC (RLS reforça no servidor) */}
      {canGovern && (
        <div className="border-t border-ig-border-subtle pt-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">Ações</p>
          <div className="grid grid-cols-2 gap-2">
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Workflow className="h-4 w-4" />} onClick={() => onLinkProject(record)}>
                Vincular projeto
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ClipboardCheck className="h-4 w-4" />} onClick={onCreateObligation}>
                Criar obrigação
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Receipt className="h-4 w-4" />} onClick={onCreateBilling}>
                Criar faturamento
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => onCreateTask(record)}>
                Criar tarefa
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => onCreateRisk(record)}>
                Criar risco
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ShieldCheck className="h-4 w-4" />} onClick={() => onLinkExistingRisk(record)}>
                Vincular risco
              </HudButton>
            )}
            {permissions.uploadDoc && (
              <HudButton variant="secondary" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={() => onAttachDocument(record)}>
                Anexar documento
              </HudButton>
            )}
            {permissions.approve && (
              <HudButton variant="secondary" size="sm" leftIcon={<GanttChartSquare className="h-4 w-4" />} onClick={() => onReviewApproval(record)}>
                Aprovar / rejeitar
              </HudButton>
            )}
            {permissions.edit && record.legalStatus !== 'approved' && (
              <HudButton variant="secondary" size="sm" leftIcon={<Scale className="h-4 w-4" />} onClick={() => onSendToLegal(record)}>
                Rev. jurídica
              </HudButton>
            )}
          </div>
        </div>
      )}

      {/* Primário */}
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-ig-border-subtle pt-2.5">
        <HudButton variant="primary" size="sm" leftIcon={<FileSearch className="h-4 w-4" />} onClick={() => onView(record)}>
          Abrir dossiê completo
        </HudButton>
        <HudButton variant="glass" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={() => onExportPdf(record)}>
          PDF
        </HudButton>
      </div>
    </div>
  );

  return (
    <>
    <HudDrawer isOpen={isOpen} onClose={onClose} title={record.contract.name} subtitle={`${record.code} · ${record.contractType}`} width="520px" footer={footer}>
      <div className="space-y-6">
        {/* Hero identity band — echoes the Projetos drawer hero */}
        <div className="relative overflow-hidden rounded-xl border border-ig-border-focus/40 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_92%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent))] px-4 py-3.5">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-ig-accent shadow-[0_0_18px_var(--ig-accent)]" />
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">Exposição total</p>
              <p className="mt-0.5 ig-tabular truncate text-2xl font-semibold text-ig-fg-strong">{formatCurrencyCompact(record.totalValue, record.contract.currency)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">Execução</p>
              <p className="mt-0.5 ig-tabular text-lg font-semibold text-ig-fg-strong">{billedPercent}%</p>
            </div>
          </div>
          <div className="mt-2.5">
            <HudProgressBar value={billedPercent} size="sm" variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'} />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-ig-fg-muted">
              <span className="truncate">Faturado {formatCurrencyCompact(record.billedValue, record.contract.currency)}</span>
              <span className="truncate">Saldo {formatCurrencyCompact(record.remainingValue, record.contract.currency)}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ig-border-subtle pt-3">
            <HudStatusPill variant={riskVariant(record.contract.riskClassification)} size="sm" pulse={record.contract.riskClassification === 'high'}>
              Risco {riskLabels[record.contract.riskClassification]}
            </HudStatusPill>
            <HudStatusPill
              variant={record.contract.status === 'cancelled' || record.contract.status === 'expired' ? 'critical' : record.contract.status.includes('review') || record.contract.status === 'negotiation' ? 'warning' : 'active'}
              size="sm"
            >
              {statusLabel}
            </HudStatusPill>
            {record.aiStatus === 'mock_pending' && <HudStatusPill variant="neutral" size="sm">IA pendente</HudStatusPill>}
            {record.missingDocuments.length > 0 && <HudStatusPill variant="warning" size="sm">{record.missingDocuments.length} docs</HudStatusPill>}
            {record.daysUntilExpiration !== null && record.daysUntilExpiration < 0 ? (
              <HudStatusPill variant="critical" size="sm">{Math.abs(record.daysUntilExpiration)}d vencido</HudStatusPill>
            ) : record.daysUntilExpiration !== null && record.daysUntilExpiration <= 30 ? (
              <HudStatusPill variant="warning" size="sm">{record.daysUntilExpiration}d p/ vencer</HudStatusPill>
            ) : null}
          </div>
        </div>

        {/* A. Identidade */}
        <Section title="A · Identidade" icon={<FileText className="h-4 w-4" />}>
          <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/40 px-3.5 py-1">
            <KV label="Código">{record.code}</KV>
            <KV label="Tipo">{record.contractType}</KV>
            <KV label="Status">{statusLabel}</KV>
            <KV label="Contraparte">{record.companyName}</KV>
            <KV label="Responsável">{record.owner}</KV>
            <KV label="Início">{record.contract.signingDate ? format(new Date(record.contract.signingDate), 'dd/MM/yyyy', { locale: pt }) : '—'}</KV>
            <KV label="Vigência">{record.contract.expirationDate ? format(new Date(record.contract.expirationDate), 'dd/MM/yyyy', { locale: pt }) : '—'}</KV>
          </div>
        </Section>

        {/* B. Vínculos e relacionamentos */}
        <Section title="B · Vínculos e relacionamentos" icon={<Workflow className="h-4 w-4" />} quality={linksQuality}>
          <div className="space-y-2">
            <LinkRow icon={<Building2 className="h-3.5 w-3.5" />} label="Contraparte" value={record.companyName} />
            {record.project ? (
              <LinkRow icon={<Workflow className="h-3.5 w-3.5" />} label="Projeto" value={record.projectReference} href={`/projetos/${record.project.id}`} />
            ) : (
              <button onClick={() => onLinkProject(record)} className="w-full text-left">
                <LinkRow
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="Projeto"
                  value="Sem projeto — clique para vincular"
                  muted
                  badge={<HudBadge variant="warning" size="sm">vincular</HudBadge>}
                />
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <LinkRow icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Riscos" value={`${record.linkedRisks.length} vinculado(s)`} muted={record.linkedRisks.length === 0} />
              <LinkRow icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Tarefas" value={`${record.linkedTasks.length} na agenda`} muted={record.linkedTasks.length === 0} />
              <LinkRow icon={<Scale className="h-3.5 w-3.5" />} label="Deliberações" value={`${record.linkedDeliberations.length} no comitê`} muted={record.linkedDeliberations.length === 0} />
              <LinkRow icon={<Receipt className="h-3.5 w-3.5" />} label="Faturamento" value={`${record.billingEvents.length} evento(s)`} muted={record.billingEvents.length === 0} />
              <LinkRow icon={<Archive className="h-3.5 w-3.5" />} label="Documentos" value={record.missingDocuments.length ? `${record.missingDocuments.length} pendente(s)` : 'Completos'} muted={record.missingDocuments.length === 0} />
              <LinkRow icon={<FileText className="h-3.5 w-3.5" />} label="Reconhecimento" value={record.revenueRecognitionStatus} />
            </div>
          </div>
        </Section>

        {/* C. Exposição financeira */}
        <Section title="C · Exposição financeira" icon={<Receipt className="h-4 w-4" />} quality={dq?.billing}>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total" value={formatCurrencyCompact(record.totalValue)} />
            <Stat label="Faturado" value={formatCurrencyCompact(record.billedValue)} tone="success" />
            <Stat label="Saldo" value={formatCurrencyCompact(record.remainingValue)} tone="warning" />
          </div>
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-ig-fg-muted">Execução financeira</span>
              <span className="font-semibold tabular-nums text-ig-fg-strong">{billedPercent}%</span>
            </div>
            <HudProgressBar value={billedPercent} size="sm" variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Margem est." value={`${record.margin}%`} />
            <Stat label="Adimplência" value={record.paymentStatus} tone={record.paymentStatus === 'Atrasado' ? 'danger' : record.paymentStatus === 'Suspenso' ? 'warning' : 'success'} />
            <Stat label="Valor total" value={formatCurrencyFull(record.totalValue, record.contract.currency)} />
          </div>
        </Section>

        {/* D. Governança / Workflow */}
        <Section title="D · Governança & workflow" icon={<ShieldCheck className="h-4 w-4" />} quality={dq?.approvals}>
          <div className="space-y-2">
            {[
              { label: 'Rota de aprovação', value: record.approvalRoute, variant: 'neutral' as const, icon: <ShieldCheck className="h-3.5 w-3.5" /> },
              { label: 'Jurídico', value: legalLabel, variant: record.legalStatus === 'approved' ? 'active' as const : record.legalStatus === 'review' ? 'warning' as const : 'neutral' as const, icon: <Scale className="h-3.5 w-3.5" /> },
              { label: 'Financeiro', value: financialLabel, variant: record.financialStatus === 'ok' ? 'active' as const : record.financialStatus === 'attention' ? 'warning' as const : 'critical' as const, icon: <GanttChartSquare className="h-3.5 w-3.5" /> },
              { label: 'SLA médio', value: slaHours != null ? `${slaHours}h` : (record.contract.riskClassification === 'high' ? '~26h' : '~18h'), variant: 'info' as const, icon: <CalendarClock className="h-3.5 w-3.5" /> },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-[12px] text-ig-fg-muted">
                  <span className="text-ig-fg-subtle">{item.icon}</span>
                  {item.label}
                </span>
                <HudStatusPill variant={item.variant} size="sm">{item.value}</HudStatusPill>
              </div>
            ))}
            {sla && detail && detail.approvals.length > 0 && (
              <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">SLA por etapa</span>
                  <HudBadge variant={sla.quality === 'live' ? 'success' : 'subtle'} size="sm">{sla.quality === 'live' ? 'Ao vivo' : 'Estimado'}</HudBadge>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['juridico', 'financeiro', 'comite', 'diretoria'] as const).map((step) => {
                    const hours = sla.byStep[step];
                    const isOpen = sla.openStepName === step;
                    return (
                      <div key={step} className="flex items-center justify-between rounded-md border border-ig-border-subtle bg-ig-panel/40 px-2 py-1">
                        <span className="text-[11px] text-ig-fg-muted">{STEP_LABELS[step]}</span>
                        <span className={`text-[11px] font-semibold tabular-nums ${isOpen ? 'text-ig-warning' : 'text-ig-fg-strong'}`}>
                          {hours != null ? `${hours}h` : isOpen && sla.openStepHours != null ? `${sla.openStepHours}h aberto` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {(sla.overdueSteps > 0 || sla.rejectedSteps > 0) && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-ig-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {[sla.overdueSteps > 0 ? `${sla.overdueSteps} etapa(s) em atraso` : null, sla.rejectedSteps > 0 ? `${sla.rejectedSteps} rejeitada(s)` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}
            {permissions.edit && record.legalStatus !== 'approved' && (
              <HudButton variant="glass" size="sm" fullWidth leftIcon={<Scale className="h-4 w-4" />} onClick={() => onSendToLegal(record)}>
                Enviar para revisão jurídica
              </HudButton>
            )}
            {(overdueObligations > 0 || record.financialAllocationsPending) && (
              <div className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ig-fg-strong">
                  <AlertTriangle className="h-3.5 w-3.5 text-ig-warning" />
                  Bloqueios de governança
                </p>
                <p className="mt-1 text-[11px] text-ig-fg-muted">
                  {[overdueObligations > 0 ? `${overdueObligations} obrigação(ões) atrasada(s)` : null, record.financialAllocationsPending ? 'alocação financeira pendente de projeto' : null].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* E. Inteligência de IA */}
        <Section title="E · Inteligência de IA" icon={<BrainCircuit className="h-4 w-4" />} quality={dq?.ai}>
          {record.aiStatus === 'mock_pending' && (
            <div className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] px-3 py-2.5">
              <p className="text-[12px] font-semibold text-ig-fg-strong">Análise IA pendente de backend</p>
              <p className="mt-1 text-[11px] text-ig-fg-muted">Nenhuma cláusula foi lida por motor de IA. Score abaixo é heurístico cadastral.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Risk score" value={`${record.riskScore}/100`} tone={record.riskScore >= 70 ? 'danger' : record.riskScore >= 50 ? 'warning' : 'success'} />
            <Stat label="Confiança IA" value={`${record.confidenceScore}%`} />
            <Stat label="Obrigações abertas" value={openObligations} tone={overdueObligations ? 'warning' : 'default'} />
            <Stat label="Docs faltantes" value={record.missingDocuments.length} tone={record.missingDocuments.length ? 'warning' : 'success'} />
          </div>
          {record.missingDocuments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {record.missingDocuments.map((doc) => (
                <HudBadge key={doc} variant="warning" size="sm">{doc}</HudBadge>
              ))}
            </div>
          )}
        </Section>

        {/* Operação — itens ao vivo do contrato selecionado (lazy getContractById) */}
        <div className="flex items-center justify-between border-t border-ig-border-subtle pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">Operação · itens ao vivo</span>
          {detailLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ig-fg-subtle" />}
        </div>

        {/* F. Obrigações */}
        <Section title="F · Obrigações" icon={<ClipboardCheck className="h-4 w-4" />}>
          {detail && detail.obligations.length > 0 ? (
            <div className="space-y-1.5">
              {detail.obligations.slice(0, 8).map((ob) => {
                const overdue = ob.status === 'overdue';
                const done = ob.status === 'done';
                return (
                  <div key={ob.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{ob.title}</p>
                      <p className="truncate text-[11px] text-ig-fg-muted">{ob.due_date ? format(new Date(ob.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <HudStatusPill variant={overdue ? 'critical' : done ? 'active' : ob.status === 'due_soon' ? 'warning' : 'neutral'} size="sm">
                        {done ? 'Concluída' : overdue ? 'Atrasada' : ob.status === 'due_soon' ? 'Próxima' : 'Aberta'}
                      </HudStatusPill>
                      {permissions.edit && !done && (
                        <IconAction
                          title="Concluir obrigação"
                          tone="success"
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() => itemModals.openCompleteObligation(ob)}
                        />
                      )}
                      {permissions.edit && (
                        <IconAction
                          title="Criar tarefa na agenda"
                          icon={<CalendarClock className="h-3.5 w-3.5" />}
                          disabled={busyId === `obltask-${ob.id}`}
                          onClick={() =>
                            runItemAction(
                              `obltask-${ob.id}`,
                              () => createTaskFromObligation(ob.contract_id, ob.title, `${ob.due_date ?? format(new Date(), 'yyyy-MM-dd')}T23:59:59`, ob.owner_user_id),
                              'Tarefa criada na agenda',
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhuma obrigação cadastrada" />
          )}
        </Section>

        {/* G. Faturamento */}
        <Section title="G · Faturamento" icon={<Receipt className="h-4 w-4" />}>
          {detail && detail.billingEvents.length > 0 ? (
            <div className="space-y-1.5">
              {detail.billingEvents.slice(0, 8).map((be) => {
                const realized = Boolean(be.paid_at) || ['pago', 'paid', 'billed', 'realizado', 'realized'].includes((be.status ?? '').toLowerCase());
                return (
                  <div key={be.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{be.title}</p>
                      <p className="truncate text-[11px] text-ig-fg-muted">
                        {formatCurrencyCompact(Number(be.amount) || 0)} · {be.due_date ? format(new Date(be.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem data'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <HudStatusPill variant={realized ? 'active' : 'warning'} size="sm">{realized ? 'Faturado' : 'Pendente'}</HudStatusPill>
                      {permissions.edit && !realized && (
                        <IconAction
                          title="Marcar como faturado"
                          tone="success"
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() => itemModals.openRealizeBilling(be)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhum evento de faturamento vinculado" />
          )}
        </Section>

        {/* H. Documentos */}
        <Section title="H · Documentos" icon={<Archive className="h-4 w-4" />}>
          {detail && detail.documents.length > 0 ? (
            <div className="space-y-1.5">
              {detail.documents.slice(0, 10).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{doc.title}</p>
                    <p className="truncate text-[11px] text-ig-fg-muted">{DOC_STATUS_LABELS[doc.status] ?? doc.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <HudStatusPill variant={DOC_STATUS_VARIANT[doc.status] ?? 'neutral'} size="sm">{DOC_STATUS_LABELS[doc.status] ?? doc.status}</HudStatusPill>
                    {permissions.uploadDoc && doc.status !== 'pending_approval' && doc.status !== 'approved' && doc.status !== 'rejected' && (
                      <IconAction
                        title="Enviar para aprovação"
                        icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                        disabled={busyId === `docp-${doc.id}`}
                        onClick={() => runItemAction(`docp-${doc.id}`, () => updateContractDocumentStatus(doc.id, 'pending_approval'), 'Documento enviado para aprovação')}
                      />
                    )}
                    {permissions.uploadDoc && doc.status !== 'approved' && (
                      <IconAction
                        title="Aprovar documento"
                        tone="success"
                        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        disabled={busyId === `doca-${doc.id}`}
                        onClick={() => runItemAction(`doca-${doc.id}`, () => updateContractDocumentStatus(doc.id, 'approved'), 'Documento aprovado')}
                      />
                    )}
                    {permissions.uploadDoc && doc.status !== 'rejected' && (
                      <IconAction
                        title="Rejeitar documento"
                        tone="danger"
                        icon={<AlertTriangle className="h-3.5 w-3.5" />}
                        onClick={() => itemModals.openRejectDoc(doc)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhum documento anexado" />
          )}
        </Section>

        {/* I. Tarefas na agenda (leitura) */}
        <Section title="I · Tarefas na agenda" icon={<CalendarClock className="h-4 w-4" />}>
          {relatedTasks.length > 0 ? (
            <div className="space-y-1.5">
              {relatedTasks.slice(0, 8).map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{task.title}</p>
                    <p className="truncate text-[11px] text-ig-fg-muted">{task.due_at ? format(new Date(task.due_at), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}</p>
                  </div>
                  <HudStatusPill variant={task.status === 'done' ? 'active' : task.status === 'blocked' ? 'critical' : 'neutral'} size="sm">{task.status}</HudStatusPill>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhuma tarefa vinculada na agenda" />
          )}
        </Section>
      </div>
    </HudDrawer>
    {itemModals.modals}
    </>
  );
}

const DOC_STATUS_LABELS: Record<string, string> = {
  uploaded: 'Enviado',
  missing: 'Faltante',
  expired: 'Vencido',
  expiring_soon: 'A vencer',
  pending_approval: 'Em aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

const DOC_STATUS_VARIANT: Record<string, 'active' | 'warning' | 'critical' | 'neutral'> = {
  uploaded: 'active',
  missing: 'warning',
  expired: 'critical',
  expiring_soon: 'warning',
  pending_approval: 'warning',
  approved: 'active',
  rejected: 'critical',
};

function IconAction({
  title,
  icon,
  disabled,
  onClick,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger'
      ? 'hover:border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] hover:text-ig-danger'
      : tone === 'success'
        ? 'hover:border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] hover:text-ig-success'
        : 'hover:border-ig-border-focus hover:bg-ig-panel-hover hover:text-ig-fg-strong';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-7 sm:w-7 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function EmptyState({ loading, label }: { loading: boolean; label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-ig-border-subtle bg-ig-panel/30 px-3 py-2.5 text-center text-[11px] text-ig-fg-muted">
      {loading ? 'Carregando…' : label}
    </p>
  );
}

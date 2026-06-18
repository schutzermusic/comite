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

import React from 'react';
import Link from 'next/link';
import { HudDrawer, HudButton, HudStatusPill, HudProgressBar, HudBadge } from '@/components/hud';
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import {
  AlertTriangle,
  Archive,
  BrainCircuit,
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileSearch,
  FileText,
  GanttChartSquare,
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
  onSendToLegal: (record: ContractGovernanceRecord) => void;
  onViewDocuments: (record: ContractGovernanceRecord) => void;
  onExportPdf: (record: ContractGovernanceRecord) => void;
  onOpenFinance: (record: ContractGovernanceRecord) => void;
  onOpenBilling: (record: ContractGovernanceRecord) => void;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-ig-fg-muted">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
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
  onSendToLegal,
  onViewDocuments,
  onExportPdf,
  onOpenFinance,
  onOpenBilling,
}: ContractDossierDrawerProps) {
  if (!record) return null;

  const billedPercent = record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0;
  const legalLabel = record.legalStatus === 'approved' ? 'Aprovado' : record.legalStatus === 'review' ? 'Em revisão' : 'Pendente';
  const financialLabel = record.financialStatus === 'ok' ? 'Liberado' : record.financialStatus === 'attention' ? 'Atenção' : 'Bloqueado';
  const statusLabel = statusLabels[record.contract.status] ?? record.contract.status;
  const openObligations = record.obligations.filter((o) => o.status !== 'done').length;
  const overdueObligations = record.obligations.filter((o) => o.status === 'overdue').length;

  const footer = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <HudButton variant="secondary" size="sm" leftIcon={<Workflow className="h-4 w-4" />} onClick={() => onLinkProject(record)}>
          Vincular projeto
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<ClipboardCheck className="h-4 w-4" />} onClick={() => onCreateTask(record)}>
          Criar tarefa
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => onCreateRisk(record)}>
          Criar risco
        </HudButton>
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
      <div className="grid grid-cols-[1fr_auto] gap-2">
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
    <HudDrawer isOpen={isOpen} onClose={onClose} title={record.contract.name} subtitle={`${record.code} · ${record.contractType}`} width="520px" footer={footer}>
      <div className="space-y-6">
        {/* Executive summary bar */}
        <div className="flex flex-wrap items-center gap-2">
          <HudStatusPill variant={riskVariant(record.contract.riskClassification)} size="sm">
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
          {record.daysUntilExpiration !== null && record.daysUntilExpiration < 0 && (
            <HudStatusPill variant="critical" size="sm">{Math.abs(record.daysUntilExpiration)}d vencido</HudStatusPill>
          )}
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
        <Section title="B · Vínculos e relacionamentos" icon={<Workflow className="h-4 w-4" />}>
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
        <Section title="C · Exposição financeira" icon={<Receipt className="h-4 w-4" />}>
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
        <Section title="D · Governança & workflow" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-2">
            {[
              { label: 'Rota de aprovação', value: record.approvalRoute, variant: 'neutral' as const, icon: <ShieldCheck className="h-3.5 w-3.5" /> },
              { label: 'Jurídico', value: legalLabel, variant: record.legalStatus === 'approved' ? 'active' as const : record.legalStatus === 'review' ? 'warning' as const : 'neutral' as const, icon: <Scale className="h-3.5 w-3.5" /> },
              { label: 'Financeiro', value: financialLabel, variant: record.financialStatus === 'ok' ? 'active' as const : record.financialStatus === 'attention' ? 'warning' as const : 'critical' as const, icon: <GanttChartSquare className="h-3.5 w-3.5" /> },
              { label: 'SLA médio', value: record.contract.riskClassification === 'high' ? '~26h' : '~18h', variant: 'info' as const, icon: <CalendarClock className="h-3.5 w-3.5" /> },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-[12px] text-ig-fg-muted">
                  <span className="text-ig-fg-subtle">{item.icon}</span>
                  {item.label}
                </span>
                <HudStatusPill variant={item.variant} size="sm">{item.value}</HudStatusPill>
              </div>
            ))}
            {record.legalStatus !== 'approved' && (
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
        <Section title="E · Inteligência de IA" icon={<BrainCircuit className="h-4 w-4" />}>
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
      </div>
    </HudDrawer>
  );
}

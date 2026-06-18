'use client';

/**
 * Unified contract card — one cohesive object (not fragmented sub-boxes).
 *
 * Single glass container with an internal grid and light dividers. Clicking the
 * card selects the contract and opens the right-side dossier drawer; the inner
 * "Dossiê" link opens the full dedicated page. Used both in the Visão Geral
 * highlights and in the Contratos cards view so the experience is consistent.
 */

import Link from 'next/link';
import { HudPanel, HudBadge, HudStatusPill, HudProgressBar } from '@/components/hud';
import {
  formatCurrencyCompact,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import { AlertTriangle, ArrowRight, Building2, ShieldCheck, Workflow } from 'lucide-react';

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
function statusVariant(status: string) {
  return status === 'active' || status === 'signed' ? 'active' : status === 'expired' || status === 'cancelled' ? 'critical' : 'warning';
}

export interface ContractCardProps {
  record: ContractGovernanceRecord;
  active?: boolean;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView?: (record: ContractGovernanceRecord) => void;
}

export function ContractCard({ record, active = false, onSelect, onView }: ContractCardProps) {
  const pct = record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0;
  const noBilling = record.billedValue === 0 && record.totalValue > 0;
  const expiringSoon = record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= 30;
  const expired = record.daysUntilExpiration !== null && record.daysUntilExpiration < 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(record)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(record);
        }
      }}
      className="group h-full text-left outline-none"
    >
      <HudPanel
        interactive
        sweep
        elevation={active ? 2 : 1}
        className={`flex h-full flex-col transition-all ${active ? 'ring-1 ring-ig-accent/45' : ''}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <HudBadge variant="outline" size="sm">{record.code}</HudBadge>
            <HudBadge variant={record.contractType.includes('Aditivo') ? 'warning' : 'subtle'} size="sm">{record.contractType}</HudBadge>
          </div>
          <HudStatusPill variant={riskVariant(record.contract.riskClassification)} size="sm" pulse={record.contract.riskClassification === 'high'}>
            {riskLabels[record.contract.riskClassification]}
          </HudStatusPill>
        </div>

        <p className="mt-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-ig-fg-strong">{record.contract.name}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-ig-caption text-ig-fg-muted">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" />
          <span className="truncate">{record.companyName}</span>
          <span className="text-ig-fg-subtle">·</span>
          <span className="truncate">{record.owner}</span>
        </div>

        {/* Linked project */}
        <div className="mt-3 border-t border-ig-border-subtle pt-3">
          {record.project ? (
            <Link
              href={`/projetos/${record.project.id}`}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 items-center gap-2 text-ig-caption font-medium text-ig-accent transition-colors hover:text-ig-accent-strong"
            >
              <Workflow className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{record.projectReference}</span>
            </Link>
          ) : (
            <span className="flex items-center gap-2 text-ig-caption font-medium text-ig-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Sem projeto vinculado
            </span>
          )}
        </div>

        {/* Exposure */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ig-caption text-ig-fg-muted">Exposição total</span>
            <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">{formatCurrencyCompact(record.totalValue, record.contract.currency)}</span>
          </div>
          <div className="flex items-center gap-2">
            <HudProgressBar
              value={pct}
              size="sm"
              className="flex-1"
              variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'}
            />
            <span className="ig-tabular shrink-0 text-ig-caption font-semibold text-ig-fg-strong">{pct}%</span>
          </div>
          <div className="flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
            <span className="truncate">Faturado {formatCurrencyCompact(record.billedValue, record.contract.currency)}</span>
            {noBilling ? (
              <span className="shrink-0 font-semibold text-ig-warning">Sem faturamento</span>
            ) : (
              <span className="shrink-0">Saldo {formatCurrencyCompact(record.remainingValue, record.contract.currency)}</span>
            )}
          </div>
        </div>

        {/* Footer: chips + action */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-ig-border-subtle pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <HudStatusPill variant={statusVariant(record.contract.status)} size="sm">
              {statusLabels[record.contract.status] ?? record.contract.status}
            </HudStatusPill>
            {record.missingDocuments.length > 0 && (
              <HudBadge variant="warning" size="sm">{record.missingDocuments.length} docs</HudBadge>
            )}
            {expired ? (
              <HudBadge variant="danger" size="sm" dot>
                {Math.abs(record.daysUntilExpiration as number)}d vencido
              </HudBadge>
            ) : expiringSoon ? (
              <HudBadge variant="warning" size="sm" dot>
                {record.daysUntilExpiration}d p/ vencer
              </HudBadge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-ig-caption text-ig-fg-subtle sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              {record.riskScore}/100
            </span>
            {onView && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onView(record);
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-ig-label font-semibold text-ig-accent transition-colors hover:bg-ig-accent-weak hover:text-ig-accent-strong"
              >
                Dossiê
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

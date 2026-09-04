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
import { AlertTriangle, ArrowRight, Building2, ShieldCheck, Workflow, X } from 'lucide-react';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { officialCurrencyCompact } from '@/lib/contracts/trust/format';
import { hasOfficialValue, ratioTrusted } from '@/lib/contracts/trust/trusted';
import { missingDocuments as trustedMissingDocs } from '@/lib/contracts/trust/signals';
import { DataClassBadge } from '@/components/contracts/cockpit/PortfolioScope';
import { ClientLogoBanner } from '@/components/portfolio/ClientLogoBanner';

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
  /** Contrato confiável correspondente, quando o batch de relações já foi lido. */
  trusted?: TrustedContract;
  record: ContractGovernanceRecord;
  active?: boolean;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView?: (record: ContractGovernanceRecord) => void;
  onDelete?: (record: ContractGovernanceRecord) => void;
}

export function ContractCard({ record, trusted, active = false, onSelect, onView, onDelete }: ContractCardProps) {
  /**
   * Valores CONFIÁVEIS quando disponíveis.
   *
   * `trusted` chega da listagem depois que o batch de relações é lido; até lá,
   * e para qualquer indicador sem apuração, o card mostra "—" em vez do valor
   * que o enricher fabricava.
   */
  const execution = trusted
    ? ratioTrusted(trusted.billedValue, trusted.totalValue, 'faturado sobre total', ['contracts', 'contract_billing_events'])
    : null;
  const pct = execution && hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;
  /** "Sem evento registrado" só se afirma sobre ausência REAL de evento. */
  const noBilling = Boolean(
    trusted && hasOfficialValue(trusted.billingEvents) && trusted.billingEvents.value.length === 0,
  );
  const docsMissing = trusted ? trustedMissingDocs(trusted) : null;
  const missingCount = docsMissing && hasOfficialValue(docsMissing) ? docsMissing.value.length : null;
  const money = (t: Parameters<typeof officialCurrencyCompact>[0] | undefined) => (t ? officialCurrencyCompact(t) : '—');
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
      className="group relative h-full rounded-[22px] text-left outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
    >
      {/* Selected state: accent edge rail + soft glow — echoes the dossier drawer hero */}
      {active && (
        <span className="pointer-events-none absolute inset-y-5 left-0 z-10 w-[2.5px] rounded-full bg-ig-accent shadow-[0_0_14px_var(--ig-accent)]" />
      )}
      {onDelete && (
        <button
          type="button"
          aria-label="Excluir contrato"
          title="Excluir contrato"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(record);
          }}
          className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-ig-fg-muted opacity-0 transition-all duration-200 hover:bg-red-500/15 hover:text-red-400 focus:opacity-100 focus:outline-none group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <HudPanel
        interactive
        sweep
        elevation={active ? 2 : 1}
        className={`flex h-full flex-col transition-all ${
          active
            ? 'rounded-[22px] ring-1 ring-ig-accent/30 shadow-[0_14px_36px_-18px_color-mix(in_oklab,var(--ig-accent)_55%,transparent)]'
            : ''
        }`}
      >
        <ClientLogoBanner
          client={trusted && hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : record.companyName}
          logoUrl={trusted && hasOfficialValue(trusted.project) ? trusted.project.value.clientLogoUrl : undefined}
        />

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

        {/* Selo de origem: contrato de demonstração nunca deve parecer carteira. */}
        {trusted && <DataClassBadge dataClass={trusted.dataClass} className="mt-2.5" />}
        <p className="mt-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-ig-fg-strong">{record.contract.name}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-ig-caption text-ig-fg-muted">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" />
          <span className="truncate">{trusted && hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : record.companyName}</span>
          <span className="text-ig-fg-subtle">·</span>
          <span className="truncate">{trusted && hasOfficialValue(trusted.contractType) ? trusted.contractType.value : '—'}</span>
        </div>

        {/* Linked project */}
        <div className="mt-3 border-t border-ig-border-subtle pt-3">
          {trusted && hasOfficialValue(trusted.project) ? (
            <Link
              href={`/projetos/${trusted.project.value.id}`}
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
            <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">{money(trusted?.totalValue)}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Sem execução apurada a barra fica neutra: 0% seria lido como
                "nada executado", que é diferente de "não sabemos". */}
            <HudProgressBar
              value={pct ?? 0}
              size="sm"
              showLabel={false}
              className="flex-1"
              variant={pct === null ? 'default' : 'success'}
            />
            <span className="ig-tabular shrink-0 text-ig-caption font-semibold text-ig-fg-strong">{pct === null ? '—' : `${pct}%`}</span>
          </div>
          <div className="flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
            <span className="truncate">Faturado {money(trusted?.billedValue)}</span>
            {noBilling ? (
              <span className="shrink-0 font-semibold text-ig-warning">Sem evento registrado</span>
            ) : (
              <span className="shrink-0">Saldo {money(trusted?.remainingValue)}</span>
            )}
          </div>
        </div>

        {/* Footer: chips + action */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-ig-border-subtle pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <HudStatusPill variant={statusVariant(record.contract.status)} size="sm">
              {statusLabels[record.contract.status] ?? record.contract.status}
            </HudStatusPill>
            {/* O chip de estado de IA saiu: `aiStatus` vinha do enricher e
                rotulava como "Prévia mock"/"IA pendente" contratos sobre os
                quais nenhuma análise foi sequer solicitada. */}
            {(missingCount ?? 0) > 0 && (
              <HudBadge variant="warning" size="sm">{missingCount} docs</HudBadge>
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
            {/* "riskScore NN/100" saiu: era hash(id+nome) exibido ao lado de um
                escudo, o que o fazia parecer avaliação de risco. O risco
                cadastral real já aparece no topo do card. */}
            <span className="hidden items-center gap-1 text-ig-caption text-ig-fg-subtle sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              {riskLabels[record.contract.riskClassification]}
            </span>
            {onView && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onView(record);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-ig-label font-semibold text-ig-accent transition-colors hover:bg-ig-accent-weak hover:text-ig-accent-strong group-hover:border-ig-accent/25"
              >
                Dossiê
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

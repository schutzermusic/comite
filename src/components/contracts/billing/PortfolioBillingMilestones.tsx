'use client';

/**
 * Marcos contratuais de faturamento — visão de carteira.
 *
 * Lê a mesma bancada do dossiê (`contract_milestone_workbench`). Marco
 * contratual ≠ evento de faturamento: a lista aparece mesmo com zero invoices.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, AlertTriangle, Receipt } from 'lucide-react';
import { PortfolioSearch, PortfolioFilters, PortfolioEmpty, matchesPortfolioSearch } from '../portfolio/PortfolioControls';
import { DossierDetailDrawer, DossierSection, DossierStatus } from '../shell/DossierPrimitives';
import { HudPanel } from '@/components/hud';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import { listMilestoneWorkbenchForContracts } from '@/lib/contracts/measurement/milestone-workbench-service';
import {
  assessMilestone,
  deriveChain,
  portfolioBillingStageLabel,
  type PortfolioBillingStageLabel,
} from '@/lib/contracts/measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import { SignalChip } from '../measurement/SignalChip';
import { ChainRail } from '../measurement/ChainRail';
import { ClientLogoBanner } from '@/components/portfolio/ClientLogoBanner';

const STAGE_OPTIONS: readonly PortfolioBillingStageLabel[] = [
  'Previsto contratualmente',
  'Aguardando gatilho',
  'Em medição',
  'Aguardando aceite',
  'Elegível para faturar',
  'Faturado',
  'Recebido',
  'Não apurado',
];

interface Props {
  readonly contractIds: readonly string[];
  readonly contractLabel: (contractId: string) => string;
  /**
   * Marca do cliente por contrato — logo + nome para âncora visual quando a
   * carteira mistura vários contratos na mesma lista.
   */
  readonly contractBrand?: (contractId: string) => {
    client: string;
    logoUrl?: string | null;
  } | null;
  readonly onOpenContract?: (contractId: string) => void;
  /** Mudança no recorte (ex.: refresh da carteira) força nova leitura. */
  readonly refreshKey?: string | number;
}

export function PortfolioBillingMilestones({
  contractIds, contractLabel, contractBrand, onOpenContract, refreshKey = 0,
}: Props) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<MilestoneWorkbenchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const idsKey = contractIds.join(',');

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await listMilestoneWorkbenchForContracts(
        idsKey ? idsKey.split(',') : [],
      );
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar marcos contratuais.');
      setRows([]);
    }
  }, [idsKey, refreshKey]);

  useEffect(() => { void load(); }, [load]);

  const asOf = useMemo(() => new Date(), [rows]);
  const labeled = useMemo(() => {
    if (!rows) return [];
    return rows.map((row) => ({
      row,
      label: portfolioBillingStageLabel(row, asOf),
      assessment: assessMilestone(row, asOf),
      chain: deriveChain(row),
    }));
  }, [rows, asOf]);

  if (rows === null) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-ig-caption text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando marcos contratuais…
        </div>
      </HudPanel>
    );
  }

  const shown = labeled.filter(({ row, label }) =>
    matchesPortfolioSearch(query, row.title, contractLabel(row.contractId))
    && (stage === 'all' || label === stage));
  const selected = labeled.find(({ row }) => row.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      {error && (
        <HudPanel>
          <div className="flex items-start gap-2 p-4 text-ig-caption text-ig-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </HudPanel>
      )}

      {!error && rows.length === 0 && (
        <p className="py-2 text-ig-caption text-ig-fg-muted">
          Nenhum marco de faturamento contratual neste recorte.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <p className="dossier-meta">
            {rows.length} marco(s) contratual(is) · evento de faturamento só aparece quando gerado.
          </p>
          <PortfolioSearch
            value={query}
            onChange={setQuery}
            label="Buscar marco ou contrato"
            count={shown.length}
          />
          <PortfolioFilters
            label="Estágio do marco"
            value={stage}
            onChange={setStage}
            options={[
              { value: 'all', label: 'Todos os estágios', count: labeled.length },
              ...STAGE_OPTIONS.map((value) => ({
                value,
                label: value,
                count: labeled.filter((item) => item.label === value).length,
              })).filter((o) => o.count > 0),
            ]}
          />
          {shown.length === 0 && labeled.length > 0 && (
            <PortfolioEmpty onReset={() => { setQuery(''); setStage('all'); }} />
          )}
          <div>
            {shown.map(({ row, label, assessment }) => {
              const brand = contractBrand?.(row.contractId) ?? null;
              return (
              <button
                key={row.id}
                type="button"
                className="dossier-row"
                aria-haspopup="dialog"
                onClick={() => setSelectedId(row.id)}
              >
                {brand && (
                  <ClientLogoBanner
                    client={brand.client}
                    logoUrl={brand.logoUrl}
                    height={22}
                    align="start"
                    className="shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="dossier-row-title">{row.title}</p>
                  <p className="dossier-meta">
                    {contractLabel(row.contractId)}
                    {row.billingEventId ? ' · com evento de faturamento' : ' · sem evento de faturamento'}
                  </p>
                </div>
                <div>
                  <p className="dossier-meta">Direito contratual</p>
                  <p className="text-xs font-semibold text-ig-fg-strong">
                    {row.entitlementAmount !== null
                      ? formatContractCurrency(row.entitlementAmount)
                      : row.billingAmount !== null
                        ? formatContractCurrency(row.billingAmount)
                        : 'Não apurado'}
                  </p>
                </div>
                <SignalChip tone={assessment.stage.tone} dashed={assessment.stage.dashed}>
                  {label}
                </SignalChip>
                <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-muted" aria-hidden />
              </button>
              );
            })}
          </div>
        </>
      )}

      <DossierDetailDrawer
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.row.title ?? ''}
        subtitle="Marco contratual · direito, medição e elegibilidade"
        footer={selected && onOpenContract ? (
          <button
            type="button"
            className="portfolio-action"
            onClick={() => {
              const id = selected.row.contractId;
              setSelectedId(null);
              onOpenContract(id);
            }}
          >
            Abrir dossiê do contrato
          </button>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-4">
            <DossierSection title="Contrato de origem">
              {(() => {
                const brand = contractBrand?.(selected.row.contractId) ?? null;
                return (
                  <div className="flex items-center gap-3">
                    {brand && (
                      <ClientLogoBanner
                        client={brand.client}
                        logoUrl={brand.logoUrl}
                        height={28}
                        align="start"
                        className="shrink-0"
                      />
                    )}
                    <p className="text-ig-body-sm text-ig-fg-strong">{contractLabel(selected.row.contractId)}</p>
                  </div>
                );
              })()}
            </DossierSection>
            <DossierSection title="Cadeia do marco">
              <ChainRail links={selected.chain} />
            </DossierSection>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="dossier-meta">Direito</p>
                <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
                  {selected.row.entitlementAmount !== null
                    ? formatContractCurrency(selected.row.entitlementAmount)
                    : 'Não apurado'}
                </p>
              </div>
              <div>
                <p className="dossier-meta">Medido</p>
                <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
                  {selected.row.measuredAmount !== null
                    ? formatContractCurrency(selected.row.measuredAmount)
                    : 'Não apurado'}
                </p>
              </div>
              <div>
                <p className="dossier-meta">Aceito</p>
                <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
                  {selected.row.acceptedValue !== null
                    ? formatContractCurrency(selected.row.acceptedValue)
                    : 'Não apurado'}
                </p>
              </div>
            </div>
            <DossierStatus tone={selected.assessment.stage.tone === 'positive' ? 'positive' : selected.assessment.stage.dashed ? 'unknown' : 'attention'}>
              {selected.label}
            </DossierStatus>
            {selected.row.billingEventId ? (
              <p className="flex items-center gap-2 text-ig-caption text-ig-fg-muted">
                <Receipt className="h-3.5 w-3.5" aria-hidden />
                Evento de faturamento vinculado.
              </p>
            ) : (
              <p className="text-ig-caption text-ig-fg-muted">
                Nenhum evento de faturamento gerado — o marco contratual permanece previsto.
              </p>
            )}
          </div>
        )}
      </DossierDetailDrawer>
    </div>
  );
}

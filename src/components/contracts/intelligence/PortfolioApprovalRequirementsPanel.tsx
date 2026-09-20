'use client';

/**
 * Requisitos de aprovação governados — visão de carteira.
 *
 * Distinto das rotas de alçada do instrumento: aqui aparecem exigências do
 * contrato (aceite de medição, aceite técnico, aprovação do cliente) mesmo
 * quando nenhum fluxo foi instanciado ainda.
 */

import { useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { PortfolioSearch, PortfolioFilters, PortfolioEmpty, matchesPortfolioSearch } from '../portfolio/PortfolioControls';
import { DossierDetailDrawer, DossierStatus } from '../shell/DossierPrimitives';
import { HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  APPROVAL_REQUIREMENT_STATE_LABEL,
  type PortfolioApprovalRequirement,
  type PortfolioApprovalRequirements,
  type ApprovalRequirementState,
} from '@/lib/contracts/trust/approval-requirements';

const STATE_TONE: Record<ApprovalRequirementState, 'attention' | 'critical' | 'positive' | 'unknown'> = {
  pending_configuration: 'attention',
  awaiting_decision: 'attention',
  rejected: 'critical',
  approved: 'positive',
  satisfied: 'positive',
};

interface Props {
  readonly requirements: PortfolioApprovalRequirements;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onOpenContract?: (contractId: string) => void;
  readonly className?: string;
}

export function PortfolioApprovalRequirementsPanel({
  requirements, loading = false, error = null, onOpenContract, className,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (loading) {
    return (
      <HudPanel className={className}>
        <p className="p-4 text-ig-caption text-ig-fg-muted">Carregando requisitos de aprovação…</p>
      </HudPanel>
    );
  }

  if (error) {
    return (
      <p className={cn(
        'flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger',
        className,
      )}>
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Requisitos de aprovação indisponíveis: {error}. A ausência nesta tela não significa que o contrato não exija aprovação.</span>
      </p>
    );
  }

  const rows = requirements.requirements;
  const shown = rows.filter((row) =>
    matchesPortfolioSearch(query, row.title, row.contractCode, row.requirementLabel)
    && (filter === 'all'
      || (filter === 'pending' && row.state === 'pending_configuration')
      || (filter === 'awaiting' && row.state === 'awaiting_decision')));
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <div className={cn('space-y-4', className)}>
      {/*
        ─── A TIRA DE QUATRO MÉTRICAS SAIU DAQUI ───────────────────────────

        "Requisitos governados", "Configuração pendente", "Aguardando decisão"
        e "Contratos com exigência" são, os quatro, indicadores da tira
        executiva desta mesma área — que fica poucos pixels acima. Mantê-los
        aqui punha o leitor a conferir dois resumos idênticos antes de chegar
        à única coisa que esta superfície tem de próprio: a bancada.

        Da notícia de governança vai-se direto ao trabalho. Os dois recortes
        que aquela tira oferecia continuam disponíveis logo abaixo, como
        FILTROS da lista — que é onde eles servem para agir, e não só para ler.
      */}
      <HudPanel
        title="Requisitos de aprovação do contrato"
        subtitle="Exigências estruturadas · fluxo só aparece quando instanciado"
        icon={<ShieldCheck className="h-4 w-4" />}
        interactive={false}
      >
        <PortfolioSearch
          value={query}
          onChange={setQuery}
          label="Buscar requisito ou contrato"
          count={shown.length}
        />
        <PortfolioFilters
          label="Situação do requisito"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos', count: rows.length },
            { value: 'pending', label: 'Configuração pendente', count: requirements.pendingConfigurationCount },
            { value: 'awaiting', label: 'Aguardando decisão', count: requirements.awaitingDecisionCount },
          ]}
        />
        {shown.length === 0 ? (
          <PortfolioEmpty
            title={rows.length === 0 ? 'Nenhum requisito de aprovação estruturado neste recorte' : undefined}
            description={rows.length === 0
              ? 'Contratos sem condição de aceite ou aprovação contratual não aparecem aqui. Rotas de alçada do instrumento ficam no painel abaixo.'
              : undefined}
            onReset={query || filter !== 'all' ? () => { setQuery(''); setFilter('all'); } : undefined}
          />
        ) : (
          <div>
            {shown.map((row) => (
              <RequirementRow key={row.id} row={row} onSelect={() => setSelectedId(row.id)} />
            ))}
          </div>
        )}
      </HudPanel>

      <DossierDetailDrawer
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.title ?? ''}
        subtitle={selected ? `${selected.contractCode} · ${selected.requirementLabel}` : undefined}
        footer={selected && onOpenContract ? (
          <button
            type="button"
            className="portfolio-action"
            onClick={() => {
              const id = selected.contractId;
              setSelectedId(null);
              onOpenContract(id);
            }}
          >
            Abrir dossiê do contrato
          </button>
        ) : undefined}
      >
        {selected && <RequirementDetail row={selected} />}
      </DossierDetailDrawer>
    </div>
  );
}

function RequirementRow({
  row, onSelect,
}: { row: PortfolioApprovalRequirement; onSelect: () => void }) {
  return (
    <button type="button" className="dossier-row" aria-haspopup="dialog" onClick={onSelect}>
      <div className="min-w-0 flex-1">
        <p className="dossier-row-title">{row.title}</p>
        <p className="dossier-meta">
          {row.contractCode} · {row.requirementLabel}
          {row.milestoneTitle ? ` · ${row.milestoneTitle}` : ''}
        </p>
      </div>
      <DossierStatus tone={STATE_TONE[row.state]}>
        {APPROVAL_REQUIREMENT_STATE_LABEL[row.state]}
      </DossierStatus>
      <span className="dossier-meta">Ver →</span>
    </button>
  );
}

function RequirementDetail({ row }: { row: PortfolioApprovalRequirement }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="dossier-meta">Estado</p>
        <DossierStatus tone={STATE_TONE[row.state]}>
          {APPROVAL_REQUIREMENT_STATE_LABEL[row.state]}
        </DossierStatus>
      </div>
      <div>
        <p className="dossier-meta">Tipo</p>
        <p className="text-ig-body-sm text-ig-fg-strong">{row.requirementLabel}</p>
      </div>
      {row.milestoneTitle && (
        <div>
          <p className="dossier-meta">Marco relacionado</p>
          <p className="text-ig-body-sm text-ig-fg-strong">{row.milestoneTitle}</p>
        </div>
      )}
      {row.relatedObligation && (
        <div>
          <p className="dossier-meta">Condição / documento</p>
          <p className="text-ig-body-sm text-ig-fg-muted">{row.relatedObligation}</p>
        </div>
      )}
      {row.authority && (
        <div>
          <p className="dossier-meta">Autoridade</p>
          <p className="text-ig-body-sm text-ig-fg-strong">{row.authority}</p>
        </div>
      )}
      {row.sourcePage !== null && (
        <div>
          <p className="dossier-meta">Proveniência</p>
          <p className="text-ig-caption text-ig-fg-muted">
            {row.provenance} · página {row.sourcePage}
          </p>
        </div>
      )}
      {!row.sourcePage && (
        <div>
          <p className="dossier-meta">Proveniência</p>
          <p className="text-ig-caption text-ig-fg-muted">{row.provenance}</p>
        </div>
      )}
    </div>
  );
}



'use client';

/**
 * Risk & Clause Intelligence — e a declaração do que ainda não existe.
 *
 * Este painel é, hoje, majoritariamente uma resposta negativa. O desenho
 * assume isso em vez de disfarçar: cada capacidade diz o seu estado, o que se
 * pode afirmar, e o que falta para a inteligência existir.
 *
 * A distinção que o painel precisa carregar acima de tudo:
 *   · "ninguém registrou ainda"  → há botão, cabe convidar à ação;
 *   · "não há como registrar"    → é lacuna de produto, e convidar mandaria o
 *                                  usuário procurar um botão inexistente.
 */

import { useState } from 'react';
import { PortfolioSearch, PortfolioFilters, PortfolioEmpty, matchesPortfolioSearch } from '../portfolio/PortfolioControls';
import { DossierDisclosure } from '../shell/DossierPrimitives';
import { cn } from '@/lib/utils';
import { ShieldAlert, Scale, Gavel, PlugZap, AlertTriangle, CircleDashed } from 'lucide-react';
import { HudPanel, HudSignal, type HudSignalTone } from '@/components/hud';
import type {
  CapabilityState, ClauseRiskIntelligence, IntelligenceCapability,
} from '@/lib/contracts/trust/clause-risk-intelligence';
import {
  attentionReasonLabel,
  interpretationTitle,
  OPERATIONAL_FAMILY_LABEL,
  type ContractOperationalInterpretationRow,
} from '@/lib/contracts/intelligence/operational-interpretations';
import {
  CLAUSE_REVIEW_LABEL, type ClauseReviewStatus, type ContractClauseRow,
} from '@/lib/contracts/contract-service';
import { contractRiskLabel } from '@/lib/contracts/risk-labels';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import {
  clauseListProvenanceSubtitle, clauseProvenanceLabel,
} from '@/lib/contracts/clause-provenance';


const CAP_ICON: Record<IntelligenceCapability['key'], React.ReactNode> = {
  risks: <ShieldAlert className="h-4 w-4" aria-hidden />,
  clauses: <Scale className="h-4 w-4" aria-hidden />,
  penalties: <Gavel className="h-4 w-4" aria-hidden />,
};

const STATE_CHIP: Record<CapabilityState, { label: string; icon: React.ReactNode; tone: HudSignalTone }> = {
  available: {
    label: 'Disponível',
    icon: <CircleDashed aria-hidden />,
    tone: 'success',
  },
  'no-records': {
    label: 'Sem registros',
    icon: <CircleDashed aria-hidden />,
    tone: 'warning',
  },
  'not-instrumented': {
    label: 'Não instrumentado',
    icon: <PlugZap aria-hidden />,
    tone: 'neutral',
  },
  error: {
    label: 'Indisponível',
    icon: <AlertTriangle aria-hidden />,
    tone: 'danger',
  },
};

export interface ClauseRiskIntelligencePanelProps {
  intelligence: ClauseRiskIntelligence;
  canEdit?: boolean;
  onCreateRisk?: () => void;
  onLinkRisk?: () => void;
  /** P2B — registro manual estruturado. */
  onRegisterClause?: () => void;
  onRegisterPenalty?: (clause?: ContractClauseRow) => void;
  onReviewClause?: (clause: ContractClauseRow) => void;
  onOpenContract?: (id: string) => void;
  className?: string;
}

export function ClauseRiskIntelligencePanel({
  intelligence, canEdit = false, onCreateRisk, onLinkRisk,
  onRegisterClause, onRegisterPenalty, onReviewClause, onOpenContract, className,
}: ClauseRiskIntelligencePanelProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const risks = intelligence.risks.filter((r) => (category === 'all' || category === 'risks') && matchesPortfolioSearch(query, r.title, r.contractCode, r.category));
  const clauses = intelligence.clauses.filter((c) => (category === 'all' || category === 'clauses') && matchesPortfolioSearch(query, c.title, c.clause_type));
  const penalties = intelligence.penalties.filter((p) => (category === 'all' || category === 'penalties') && matchesPortfolioSearch(query, p.title, p.trigger_condition));
  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-2 lg:grid-cols-3">
        {intelligence.capabilities.map((cap) => (
          <CapabilityCard
            key={cap.key}
            capability={cap}
            canEdit={canEdit}
            onCreateRisk={onCreateRisk}
            onLinkRisk={onLinkRisk}
            onRegisterClause={onRegisterClause}
            onRegisterPenalty={onRegisterPenalty}
          />
        ))}
      </div>

      {onOpenContract && <>
        <PortfolioSearch value={query} onChange={setQuery} label="Buscar risco, cláusula ou penalidade" count={risks.length + clauses.length + penalties.length} />
        <PortfolioFilters label="Tipo de registro" value={category} onChange={setCategory} options={[{ value: 'all', label: 'Todos' }, { value: 'risks', label: 'Riscos', count: intelligence.risks.length }, { value: 'clauses', label: 'Cláusulas', count: intelligence.clauses.length }, { value: 'penalties', label: 'Penalidades', count: intelligence.penalties.length }, { value: 'attention', label: 'Requer atenção', count: intelligence.attentionCount }]} />
        {risks.length + clauses.length + penalties.length === 0 && intelligence.attentionCount === 0 && <PortfolioEmpty title="Nenhum registro disponível neste recorte" description="Consulte a cobertura acima ou abra um contrato para examinar suas fontes." onReset={query || category !== 'all' ? () => { setQuery(''); setCategory('all'); } : undefined} />}
      </>}

      {intelligence.attentionCount > 0 && (category === 'all' || category === 'attention') && (
        <HudPanel
          title="Interpretações que requerem atenção"
          subtitle="Fila operacional · contract_operational_interpretations — distinta das cláusulas extraídas"
          icon={<AlertTriangle className="h-4 w-4" />}
          interactive={false}
        >
          <div className="ig-rows">
            {intelligence.pendingProposals
              .filter((row) => matchesPortfolioSearch(
                query,
                interpretationTitle(row),
                OPERATIONAL_FAMILY_LABEL[row.family],
              ))
              .map((row) => (
                <AttentionRow
                  key={row.id}
                  row={row}
                  onOpenContract={onOpenContract}
                />
              ))}
          </div>
        </HudPanel>
      )}

      {risks.length > 0 && (
        <HudPanel
          title="Riscos vinculados"
          subtitle="O vínculo é de Contratos; o conteúdo do risco continua no módulo de Riscos"
          icon={<ShieldAlert className="h-4 w-4" />}
          interactive={false}
        >
          {/* Linhas divididas: ver ObligationsControlTower. */}
          <div className="ig-rows">
            {risks.map((risk) => (
              <div
                key={`${risk.contractId}-${risk.riskId}`}
                className="grid gap-3 py-2.5 md:grid-cols-[1fr_130px_120px] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{risk.title}</p>
                  <p className="truncate text-ig-caption text-ig-fg-muted">
                    {risk.contractCode}{risk.category ? ` · ${risk.category}` : ''}
                  </p>
                  {onOpenContract && <button type="button" className="mt-2 text-xs font-semibold text-ig-accent" onClick={() => onOpenContract(risk.contractId)}>Abrir contrato →</button>}
                </div>
                <span className="truncate text-ig-caption text-ig-fg-muted">{risk.severity ?? 'severidade não lida'}</span>
                <span className="truncate text-ig-caption text-ig-fg-muted">{risk.status ?? 'estado não lido'}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      )}

      {clauses.length > 0 && (
        <HudPanel
          title="Cláusulas monitoradas"
          subtitle={clauseListProvenanceSubtitle(intelligence.clauses)}
          icon={<Scale className="h-4 w-4" />}
          interactive={false}
        >
          <div className="ig-rows">
            {clauses.map((clause) => (
              <DossierDisclosure key={clause.id} title={clause.title}>
                <ClauseRow clause={clause} canEdit={canEdit} onReview={onReviewClause} onRegisterPenalty={onRegisterPenalty} />
                {clause.content && <p className="dossier-meta mb-3 whitespace-pre-wrap">{clause.content}</p>}
                {clause.source_excerpt && <blockquote className="dossier-meta mb-3 border-l-2 border-ig-border-strong pl-3">{clause.source_excerpt}</blockquote>}
                {onOpenContract && <button type="button" className="portfolio-action" onClick={() => onOpenContract(clause.contract_id)}>Abrir contrato de origem</button>}
              </DossierDisclosure>
            ))}
          </div>
        </HudPanel>
      )}

      {penalties.length > 0 && (
        <HudPanel
          title="Penalidades monitoradas"
          subtitle="Gatilho, valor e cláusula de origem"
          icon={<Gavel className="h-4 w-4" />}
          interactive={false}
        >
          <div className="ig-rows">
            {penalties.map((penalty) => {
              const origin = intelligence.clauses.find((c) => c.id === penalty.clause_id);
              return (
                <div
                  key={penalty.id}
                  className="grid gap-3 py-2.5 md:grid-cols-[1fr_140px_160px] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{penalty.title}</p>
                    <p className="truncate text-ig-caption text-ig-fg-muted">
                      {origin ? `origem: ${origin.title}` : 'sem cláusula de origem registrada'}
                    </p>
                    {onOpenContract && <button type="button" className="mt-2 text-xs font-semibold text-ig-accent" onClick={() => onOpenContract(penalty.contract_id)}>Abrir contrato →</button>}
                  </div>
                  <span className="truncate text-ig-body-sm font-semibold ig-tabular text-ig-fg-strong">
                    {formatEffect(penalty.amount, penalty.percentage, null)}
                  </span>
                  <span className="truncate text-ig-caption text-ig-fg-muted" title={penalty.trigger_condition ?? undefined}>
                    {penalty.trigger_condition || 'gatilho não descrito'}
                  </span>
                </div>
              );
            })}
          </div>
        </HudPanel>
      )}

    </div>
  );
}

/**
 * Efeito contratual da cláusula/penalidade.
 *
 * Os três campos são independentes e podem coexistir; quando nenhum existe, o
 * texto diz isso — "—" sozinho sugeriria que alguém tentou medir e não achou.
 */
function AttentionRow({
  row, onOpenContract,
}: {
  row: ContractOperationalInterpretationRow;
  onOpenContract?: (id: string) => void;
}) {
  const reasons = (row.trust_reasons ?? []).map(attentionReasonLabel).join(' · ');
  return (
    <div className="grid gap-3 py-2.5 md:grid-cols-[1fr_160px_120px] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">
          {interpretationTitle(row)}
        </p>
        <p className="truncate text-ig-caption text-ig-fg-muted">
          {OPERATIONAL_FAMILY_LABEL[row.family]}
          {row.source_page ? ` · p.${row.source_page}` : ''}
          {reasons ? ` · ${reasons}` : ''}
        </p>
        {onOpenContract && (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-ig-accent"
            onClick={() => onOpenContract(row.contract_id)}
          >
            Abrir contrato →
          </button>
        )}
      </div>
      <span className="truncate text-ig-caption text-ig-fg-muted">
        interpretação operacional
      </span>
      {/*
        ALERTA é Signal inline, não cápsula (§ anatomia do HudSignal): cápsula
        é para METADADO que classifica a linha e fica quieto. "Requer atenção"
        pede ação, e numa lista de interpretações cada cápsula a mais compete
        em peso com o título do item.
      */}
      <HudSignal variant="inline" size="sm" tone="warning" label="Requer atenção" />
    </div>
  );
}

function formatEffect(
  amount: number | string | null,
  percentage: number | string | null,
  termDays: number | null,
): string {
  const parts: string[] = [];
  const a = amount === null ? null : Number(amount);
  const p = percentage === null ? null : Number(percentage);
  if (a !== null && Number.isFinite(a)) parts.push(formatContractCurrency(a));
  if (p !== null && Number.isFinite(p)) parts.push(`${p}%`);
  if (termDays !== null) parts.push(`${termDays} dia(s)`);
  return parts.length > 0 ? parts.join(' · ') : 'Sem efeito quantificado';
}

const REVIEW_TONE: Record<ClauseReviewStatus, HudSignalTone> = {
  draft: 'neutral',
  in_review: 'warning',
  validated: 'success',
  rejected: 'danger',
  // Substituída não é rejeitada: o conteúdo podia estar certo, outra versão é
  // que passou a valer. Tom neutro e apagado, sem carga de erro.
  superseded: 'neutral',
};

function ClauseRow({
  clause, canEdit, onReview, onRegisterPenalty,
}: {
  clause: ContractClauseRow;
  canEdit: boolean;
  onReview?: (clause: ContractClauseRow) => void;
  onRegisterPenalty?: (clause?: ContractClauseRow) => void;
}) {
  return (
    /*
      Duas faixas em vez de quatro colunas: com a timeline lateral do dossiê, a
      grade de 4 colunas espremia o título em "VIS Multa por …" e a origem em
      "origem documental não i…" — truncando justamente o que identifica a
      cláusula e de onde ela veio.
    */
    <div className="space-y-2 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{clause.title}</p>
          <p className="text-ig-caption text-ig-fg-muted">
            {clause.clause_type ?? 'categoria não informada'} · risco {contractRiskLabel(clause.risk_level)}
          </p>
        </div>
        <HudSignal
          size="sm"
          className="shrink-0"
          label={CLAUSE_REVIEW_LABEL[clause.review_status]}
          tone={REVIEW_TONE[clause.review_status]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-ig-caption ig-tabular text-ig-fg-strong">
          {formatEffect(clause.amount, clause.percentage, clause.term_days)}
        </span>
        {/*
          Proveniência em duas metades, e as duas importam: QUEM estruturou a
          cláusula (Apex a partir do documento, ou uma pessoa) e DE ONDE ela
          foi transcrita (documento e página). O painel dizia a segunda e
          afirmava a primeira errado — atribuindo a um humano o que o Apex
          leu do contrato assinado.
        */}
        <span className="text-ig-caption text-ig-fg-muted">
          {clauseProvenanceLabel(clause)}
        </span>
        <span className="text-ig-caption text-ig-fg-muted">
          {clause.source_document_id
            ? `documento${clause.source_page ? ` · p. ${clause.source_page}` : ''}`
            : clause.source_page
              ? `p. ${clause.source_page} · documento não vinculado`
              : 'origem documental não informada'}
        </span>

        <div className="ml-auto flex items-center gap-2">
        {canEdit && onReview && (
          <button
            type="button"
            title="Revisar cláusula"
            onClick={() => onReview(clause)}
            className="inline-flex h-9 items-center rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-fg-strong"
          >
            Revisar
          </button>
        )}
        {canEdit && onRegisterPenalty && (
          <button
            type="button"
            title="Registrar penalidade a partir desta cláusula"
            onClick={() => onRegisterPenalty(clause)}
            className="inline-flex h-9 items-center rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-danger"
          >
            Penalidade
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

function CapabilityCard({
  capability, canEdit, onCreateRisk, onLinkRisk, onRegisterClause, onRegisterPenalty,
}: {
  capability: IntelligenceCapability;
  canEdit: boolean;
  onCreateRisk?: () => void;
  onLinkRisk?: () => void;
  onRegisterClause?: () => void;
  onRegisterPenalty?: (clause?: ContractClauseRow) => void;
}) {
  const chip = STATE_CHIP[capability.state];
  const dimmed = capability.state === 'not-instrumented';

  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-[16px] border px-4 py-3.5',
      dimmed ? 'border-dashed border-ig-border-strong' : 'border-ig-border-subtle bg-ig-panel/45',
    )}>
      {/*
        Selo em linha PRÓPRIA, abaixo do título.
        Lado a lado, "Cláusulas monitoradas" quebrava em duas linhas com o selo
        flutuando no meio — e a versão anterior, que truncava, perdia a palavra
        que identifica a capacidade de que o painel está falando.
      */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={cn('shrink-0', dimmed ? 'text-ig-fg-subtle/70' : 'text-ig-fg-subtle')}>
            {CAP_ICON[capability.key]}
          </span>
          <span className="min-w-0 text-ig-body-sm font-semibold text-ig-fg-strong">
            {capability.label}
          </span>
        </div>
        {/*
          Estado da capacidade: "Disponível" classifica (cápsula), mas
          "Sem registros" e "Não instrumentado" são AVISOS DE CONFIGURAÇÃO —
          pedem trabalho, e vão na forma reservada a alerta.
        */}
        <HudSignal
          variant={capability.state === 'available' ? 'chip' : 'inline'}
          size="sm"
          icon={chip.icon}
          label={chip.label}
          tone={chip.tone}
        />
      </div>

      <p className="text-ig-caption text-ig-fg-muted">{capability.summary}</p>

      {capability.limitation && (
        <p className="rounded-[10px] border border-ig-border-subtle px-2.5 py-2 text-ig-caption text-ig-fg-subtle">
          {capability.limitation}
        </p>
      )}

      {/*
        A ação só aparece quando existe caminho de escrita. Até P2A, "Registrar
        cláusula" seria a própria mentira que este painel foi feito para não
        contar; a migration 092 abriu o caminho, e por isso o botão existe agora.
      */}
      {capability.actionable && canEdit && capability.key === 'clauses' && onRegisterClause && (
        <div className="mt-auto flex gap-2 pt-1">
          <button
            type="button"
            onClick={onRegisterClause}
            className="rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
          >
            Registrar cláusula
          </button>
        </div>
      )}

      {capability.actionable && canEdit && capability.key === 'penalties' && onRegisterPenalty && (
        <div className="mt-auto flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onRegisterPenalty()}
            className="rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
          >
            Registrar penalidade
          </button>
        </div>
      )}

      {capability.actionable && capability.key === 'risks' && canEdit && (
        <div className="mt-auto flex gap-2 pt-1">
          {onCreateRisk && (
            <button
              type="button"
              onClick={onCreateRisk}
              className="rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
            >
              Criar risco
            </button>
          )}
          {onLinkRisk && (
            <button
              type="button"
              onClick={onLinkRisk}
              className="rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
            >
              Vincular existente
            </button>
          )}
        </div>
      )}
    </div>
  );
}

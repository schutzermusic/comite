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

import { cn } from '@/lib/utils';
import { ShieldAlert, Scale, Gavel, PlugZap, AlertTriangle, CircleDashed } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import type {
  CapabilityState, ClauseRiskIntelligence, IntelligenceCapability,
} from '@/lib/contracts/trust/clause-risk-intelligence';
import {
  CLAUSE_REVIEW_LABEL, type ClauseReviewStatus, type ContractClauseRow,
} from '@/lib/contracts/contract-service';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

const CAP_ICON: Record<IntelligenceCapability['key'], React.ReactNode> = {
  risks: <ShieldAlert className="h-4 w-4" aria-hidden />,
  clauses: <Scale className="h-4 w-4" aria-hidden />,
  penalties: <Gavel className="h-4 w-4" aria-hidden />,
};

const STATE_CHIP: Record<CapabilityState, { label: string; icon: React.ReactNode; tone: string; border: string }> = {
  available: {
    label: 'Disponível',
    icon: <CircleDashed className="h-3 w-3" aria-hidden />,
    tone: 'text-ig-success', border: 'border-ig-success/45',
  },
  'no-records': {
    label: 'Sem registros',
    icon: <CircleDashed className="h-3 w-3" aria-hidden />,
    tone: 'text-ig-warning', border: 'border-ig-warning/45',
  },
  'not-instrumented': {
    label: 'Não instrumentado',
    icon: <PlugZap className="h-3 w-3" aria-hidden />,
    tone: 'text-ig-fg-subtle', border: 'border-ig-border-strong',
  },
  error: {
    label: 'Indisponível',
    icon: <AlertTriangle className="h-3 w-3" aria-hidden />,
    tone: 'text-ig-danger', border: 'border-ig-danger/45',
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
  className?: string;
}

export function ClauseRiskIntelligencePanel({
  intelligence, canEdit = false, onCreateRisk, onLinkRisk,
  onRegisterClause, onRegisterPenalty, onReviewClause, className,
}: ClauseRiskIntelligencePanelProps) {
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

      {intelligence.risks.length > 0 && (
        <HudPanel
          title="Riscos vinculados"
          subtitle="O vínculo é de Contratos; o conteúdo do risco continua no módulo de Riscos"
          icon={<ShieldAlert className="h-4 w-4" />}
          interactive={false}
        >
          {/* Linhas divididas: ver ObligationsControlTower. */}
          <div className="ig-rows">
            {intelligence.risks.slice(0, 30).map((risk) => (
              <div
                key={`${risk.contractId}-${risk.riskId}`}
                className="grid gap-3 py-2.5 md:grid-cols-[1fr_130px_120px] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{risk.title}</p>
                  <p className="truncate text-ig-caption text-ig-fg-muted">
                    {risk.contractCode}{risk.category ? ` · ${risk.category}` : ''}
                  </p>
                </div>
                <span className="truncate text-ig-caption text-ig-fg-muted">{risk.severity ?? 'severidade não lida'}</span>
                <span className="truncate text-ig-caption text-ig-fg-muted">{risk.status ?? 'estado não lido'}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      )}

      {intelligence.clauses.length > 0 && (
        <HudPanel
          title="Cláusulas monitoradas"
          subtitle="Registro manual estruturado — com origem documental e estado de revisão"
          icon={<Scale className="h-4 w-4" />}
          interactive={false}
        >
          <div className="ig-rows">
            {intelligence.clauses.slice(0, 40).map((clause) => (
              <ClauseRow
                key={clause.id}
                clause={clause}
                canEdit={canEdit}
                onReview={onReviewClause}
                onRegisterPenalty={onRegisterPenalty}
              />
            ))}
          </div>
        </HudPanel>
      )}

      {intelligence.penalties.length > 0 && (
        <HudPanel
          title="Penalidades monitoradas"
          subtitle="Gatilho, valor e cláusula de origem"
          icon={<Gavel className="h-4 w-4" />}
          interactive={false}
        >
          <div className="ig-rows">
            {intelligence.penalties.slice(0, 30).map((penalty) => {
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
function formatEffect(
  amount: number | string | null,
  percentage: number | string | null,
  termDays: number | null,
): string {
  const parts: string[] = [];
  const a = amount === null ? null : Number(amount);
  const p = percentage === null ? null : Number(percentage);
  if (a !== null && Number.isFinite(a)) parts.push(BRL.format(a));
  if (p !== null && Number.isFinite(p)) parts.push(`${p}%`);
  if (termDays !== null) parts.push(`${termDays} dia(s)`);
  return parts.length > 0 ? parts.join(' · ') : 'Sem efeito quantificado';
}

const REVIEW_TONE: Record<ClauseReviewStatus, string> = {
  draft: 'border-ig-border-strong text-ig-fg-muted',
  in_review: 'border-ig-warning/45 text-ig-warning',
  validated: 'border-ig-success/45 text-ig-success',
  rejected: 'border-ig-danger/45 text-ig-danger',
  // Substituída não é rejeitada: o conteúdo podia estar certo, outra versão é
  // que passou a valer. Tom neutro e apagado, sem carga de erro.
  superseded: 'border-ig-border-subtle text-ig-fg-subtle',
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
            {clause.clause_type ?? 'categoria não informada'} · risco {clause.risk_level}
          </p>
        </div>
        <span className={cn(
          'shrink-0 rounded-full border px-2 py-px text-ig-label font-semibold',
          REVIEW_TONE[clause.review_status],
        )}>
          {CLAUSE_REVIEW_LABEL[clause.review_status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-ig-caption ig-tabular text-ig-fg-strong">
          {formatEffect(clause.amount, clause.percentage, clause.term_days)}
        </span>
        {/* Proveniência: de qual documento e página a cláusula foi transcrita. */}
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
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-px text-ig-label font-semibold',
          chip.border, chip.tone,
        )}>
          {chip.icon}{chip.label}
        </span>
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

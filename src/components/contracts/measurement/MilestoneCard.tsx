'use client';

/**
 * O MARCO, como objeto de trabalho.
 *
 * ─── O que mudou em relação à linha anterior ───────────────────────────────
 *
 * A linha antiga mostrava título, status, prazo, valor e duas ausências, em
 * quatro colunas de peso igual. Tudo cabia, e nada se destacava — inclusive
 * porque o VALOR e o TÍTULO tinham quase o mesmo peso tipográfico.
 *
 * Aqui a hierarquia é declarada: o número do evento e o valor do DIREITO são o
 * primeiro nível; estágio e sobreposições são o segundo; a cadeia e sua
 * procedência são o terceiro; a ação é o quarto e é única.
 *
 * ─── Três valores, três lugares ────────────────────────────────────────────
 *
 * `entitlementAmount` (direito), `measuredAmount` (apurado) e `acceptedValue`
 * (aceito) NUNCA se fundem numa linha "valor". O card mostra o direito no
 * topo, e apurado/aceito só aparecem quando existem — com o rótulo que diz
 * qual dos três é.
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  AlertTriangle, ArrowUpRight, CalendarClock, FileWarning, Link2,
  Receipt, Settings2, UserX, MoreHorizontal, CircleDashed,
} from 'lucide-react';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import {
  deriveAction, deriveChain, OVERLAY_LABEL, OVERLAY_TONE,
  type MilestoneAssessment, type MilestoneOverlay,
} from '@/lib/contracts/measurement/milestone-stage';
import { SignalChip } from './SignalChip';
import { ChainRail } from './ChainRail';

const OVERLAY_ICON: Record<MilestoneOverlay, React.ReactNode> = {
  OVERDUE: <CalendarClock className="h-3 w-3" aria-hidden />,
  NO_OWNER: <UserX className="h-3 w-3" aria-hidden />,
  NO_EVIDENCE: <FileWarning className="h-3 w-3" aria-hidden />,
  VALUE_UNVERIFIED: <CircleDashed className="h-3 w-3" aria-hidden />,
  ENTITLEMENT_MISSING: <AlertTriangle className="h-3 w-3" aria-hidden />,
};

const ACTION_ICON = {
  configure_requirement: <Settings2 className="h-3.5 w-3.5" aria-hidden />,
  map_timeline: <Link2 className="h-3.5 w-3.5" aria-hidden />,
  view_timeline: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />,
  open_measurement: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />,
  attach_evidence: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />,
  generate_billing: <Receipt className="h-3.5 w-3.5" aria-hidden />,
  view_billing: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />,
  none: null,
} as const;

/** "Evento 03 · Sacar bobinas" → "03". Sem número, sem ordinal inventado. */
function eventOrdinal(title: string): string | null {
  const match = /^Evento\s+(\d{1,2})/i.exec(title.trim());
  return match ? match[1] : null;
}

function stripOrdinal(title: string): string {
  return title.replace(/^Evento\s+\d{1,2}\s*·\s*/i, '');
}

export interface MilestoneCardProps {
  readonly assessment: MilestoneAssessment;
  /** Base para o percentual do contrato. `null` → nenhum percentual é exibido. */
  readonly contractTotal: number | null;
  readonly selected?: boolean;
  readonly canEdit?: boolean;
  readonly busy?: boolean;
  readonly onSelect?: (id: string) => void;
  readonly onAction?: (assessment: MilestoneAssessment) => void;
  readonly onEdit?: (assessment: MilestoneAssessment) => void;
  readonly className?: string;
}

export function MilestoneCard({
  assessment, contractTotal, selected = false, canEdit = false, busy = false,
  onSelect, onAction, onEdit, className,
}: MilestoneCardProps) {
  const { row, stage, overlays } = assessment;
  const chain = deriveChain(row);
  const action = deriveAction(assessment);
  const ordinal = eventOrdinal(row.title);

  /*
    O percentual vem do DIREITO sobre o total do contrato. Derivá-lo de
    `billing_amount` misturaria previsto com direito; derivá-lo de medição
    diria "25% medido" sobre um marco que ninguém mediu.
  */
  const percent = row.entitlementAmount !== null && contractTotal !== null && contractTotal > 0
    ? (row.entitlementAmount / contractTotal) * 100
    : null;

  return (
    <article
      className={cn('dossier-milestone', className)}
      data-stage={stage.stage}
      data-tone={stage.tone}
      data-dashed={stage.dashed || undefined}
      data-overdue={overlays.includes('OVERDUE') || undefined}
      data-selected={selected || undefined}
      aria-labelledby={`ms-${row.id}-title`}
    >
      <span className="dossier-milestone-rail" aria-hidden />

      {/* ── Nível 1: identidade e direito ───────────────────────────────── */}
      <header className="dossier-milestone-head">
        {ordinal && <span className="dossier-milestone-ordinal" aria-hidden>{ordinal}</span>}
        <button
          type="button"
          id={`ms-${row.id}-title`}
          className="dossier-milestone-title"
          onClick={() => onSelect?.(row.id)}
          aria-haspopup={onSelect ? 'dialog' : undefined}
        >
          {ordinal ? stripOrdinal(row.title) : row.title}
        </button>

        <div className="dossier-milestone-money">
          {row.entitlementAmount !== null ? (
            <>
              <span className="dossier-milestone-amount ig-tabular">
                {formatContractCurrency(row.entitlementAmount)}
              </span>
              <span className="dossier-milestone-amount-label">
                Direito contratual
                {percent !== null && (
                  <span className="ig-tabular"> · {percent.toFixed(percent % 1 === 0 ? 0 : 2)}%</span>
                )}
              </span>
            </>
          ) : (
            /* Sem regra de direito o card NÃO cai para o previsto: dizer qual
               número está faltando é mais útil que exibir outro no lugar. */
            <span className="dossier-milestone-amount-missing">Direito sem registro</span>
          )}
        </div>
      </header>

      {/* ── Nível 2: estágio e o que falta ──────────────────────────────── */}
      <div className="dossier-milestone-signals">
        <SignalChip tone={stage.tone} dashed={stage.dashed}>{stage.label}</SignalChip>
        {overlays.map((overlay) => (
          <SignalChip key={overlay} tone={OVERLAY_TONE[overlay]} icon={OVERLAY_ICON[overlay]}>
            {OVERLAY_LABEL[overlay]}
          </SignalChip>
        ))}
        {row.dueDate ? (
          <span className="dossier-milestone-meta ig-tabular">
            prazo {format(new Date(`${row.dueDate}T00:00:00`), 'dd/MM/yyyy', { locale: pt })}
          </span>
        ) : (
          <span className="dossier-milestone-meta">sem prazo</span>
        )}
      </div>

      {/*
        Apurado e aceito só aparecem quando EXISTEM, e sempre rotulados. A
        ausência já está dita pelo chip `Valor não apurado`; repeti-la como
        "R$ 0" seria afirmar medição de zero.
      */}
      {(row.measuredAmount !== null || row.acceptedValue !== null) && (
        <div className="dossier-milestone-values">
          {row.measuredAmount !== null && (
            <span><em>Apurado</em> <b className="ig-tabular">{formatContractCurrency(row.measuredAmount)}</b></span>
          )}
          {row.acceptedValue !== null && (
            <span><em>Aceito</em> <b className="ig-tabular">{formatContractCurrency(row.acceptedValue)}</b></span>
          )}
        </div>
      )}

      {/* ── Nível 3: a cadeia e sua procedência ─────────────────────────── */}
      <ChainRail links={chain} />

      {/* ── Nível 4: uma ação ───────────────────────────────────────────── */}
      <footer className="dossier-milestone-foot">
        {action.kind !== 'none' && onAction && (
          <button
            type="button"
            className={cn('dossier-milestone-action', action.primary && 'is-primary')}
            disabled={busy}
            onClick={() => onAction(assessment)}
          >
            {ACTION_ICON[action.kind]}
            {action.label}
          </button>
        )}
        {canEdit && onEdit && (
          <button
            type="button"
            className="dossier-milestone-more"
            title="Editar marco"
            aria-label={`Editar ${row.title}`}
            onClick={() => onEdit(assessment)}
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </footer>
    </article>
  );
}

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Readiness, ReadinessDimension, RequirementType } from '@/lib/operations/planning/readiness';
import { DIMENSION_LABEL, READINESS_LABEL, REQUIREMENT_TYPE_LABEL, SUPPLY_COVERED_TYPES } from '@/lib/operations/planning/readiness';
import type { PlanningConstraint } from '@/lib/operations/planning/readiness';
import { Chip, Meter, dateShort, href, qty, relativeDue, type Tone } from '@/components/ax';

export const READINESS_TONE: Record<Readiness, Tone> = {
  READY: 'success', PARTIAL: 'warning', SHORTAGE: 'danger', PENDING: 'info', OVERDUE: 'danger', UNCONFIRMED: 'neutral',
};
const MARK: Record<Readiness, string> = { READY: '✓', PARTIAL: '◐', SHORTAGE: '!', PENDING: '…', OVERDUE: '!', UNCONFIRMED: '?' };

export const MATRIX_DIMENSIONS: ReadinessDimension[] = ['team', 'material', 'equipment', 'document', 'customer'];
export { DIMENSION_LABEL };
export const DIMENSION_SHORT: Record<ReadinessDimension, string> = {
  team: 'Equipe', material: 'Material', equipment: 'Equip.', document: 'Doc.', customer: 'Cliente', other: 'Outros',
};

export function ReadinessChip({ value }: { value: Readiness | null | undefined }) {
  if (!value) return <span className="ax-subtle">sem requisito</span>;
  return <Chip tone={READINESS_TONE[value]}>{READINESS_LABEL[value]}</Chip>;
}

/**
 * A prontidão da frente nas cinco dimensões (equipe, material, equipamento,
 * documento, cliente). Marca + palavra, nunca só cor; dimensão sem requisito
 * aparece apagada — "ninguém disse que precisa" é informação também.
 */
export function ReadinessStrip({ cells, label }: { cells: Partial<Record<ReadinessDimension, Readiness>>; label: string }) {
  return (
    <ul className="ax-ready" aria-label={label}>
      {MATRIX_DIMENSIONS.map((d) => {
        const v = cells[d];
        return (
          <li key={d} data-state={v ?? 'none'} title={`${DIMENSION_LABEL[d]}: ${v ? READINESS_LABEL[v] : 'sem requisito'}`}>
            <b aria-hidden>{v ? MARK[v] : '·'}</b>
            <span aria-hidden>{DIMENSION_SHORT[d]}</span>
            <span className="sr-only-ax">{DIMENSION_LABEL[d]}</span>
            <span className="sr-only-ax">: {v ? READINESS_LABEL[v] : 'sem requisito'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Célula da matriz projeto × dimensão: a marca com o nome do estado. */
export function ReadinessMark({ value, label }: { value: Readiness | undefined; label: string }) {
  return (
    <span className="ax-ready-mark" data-state={value ?? 'none'} role="img" aria-label={`${label}: ${value ? READINESS_LABEL[value] : 'sem requisito'}`}
      title={value ? READINESS_LABEL[value] : 'sem requisito'}>
      {value ? MARK[value] : '·'}
    </span>
  );
}

export interface RequirementLineData {
  id: string; project_id: string; requirement_type: RequirementType; title: string; quantity: string | null; unit: string | null;
  status: string; readiness: Readiness | null; coverage: { covered: number; inbound: number } | null;
  needBy: string | null; required_by: string | null; activityStart: string | null; constraints: PlanningConstraint[];
  satisfied_at: string | null; satisfiedByName?: string | null; item_id: string | null;
}

/**
 * Uma necessidade da frente: o que é, para quando (a data que vale — a menor
 * entre a declarada e o início da atividade), quanto está coberto e o que a
 * trava. A ação leva para onde ela se resolve: material no Supply; o resto no
 * planejamento do projeto.
 */
export function RequirementLine({ r, today, actions, showProject }: {
  r: RequirementLineData & { project?: string; activityTitle?: string | null }; today: string; actions?: ReactNode; showProject?: boolean;
}) {
  const due = relativeDue(r.needBy, today);
  const supply = SUPPLY_COVERED_TYPES.includes(r.requirement_type);
  const need = Number(r.quantity ?? 0);
  const covered = r.coverage?.covered ?? 0;
  const inbound = r.coverage?.inbound ?? 0;
  const tone: Tone = r.readiness ? READINESS_TONE[r.readiness] : 'neutral';
  const needFromActivity = r.needBy && r.activityStart && r.needBy === r.activityStart && r.required_by !== r.activityStart;
  return (
    <div className="ax-reqline" data-tone={tone} data-testid="requirement-row">
      <div className="ax-reqline-main">
        <span className="ax-reqline-title">
          <span className="ax-kind">{REQUIREMENT_TYPE_LABEL[r.requirement_type]}</span>
          <strong>{r.title}</strong>
          {r.quantity && <span className="ax-subtle">{qty(r.quantity, r.unit)}</span>}
        </span>
        {showProject && (r.project || r.activityTitle) && (
          <span className="ax-reqline-where">{[r.project, r.activityTitle].filter(Boolean).join(' · ')}</span>
        )}
        {supply && need > 0 && (
          <span className="ax-reqline-cover">
            <Meter value={need ? covered / need : 0} tone={covered >= need ? 'success' : covered > 0 ? 'warning' : 'danger'}
              label={`Coberto ${covered} de ${need}`} />
            <small>{covered >= need ? 'coberto' : `coberto ${qty(covered, r.unit)} de ${qty(need, r.unit)}`}
              {inbound > 0 ? ` · ${qty(inbound, r.unit)} a caminho` : ''}</small>
          </span>
        )}
        {r.constraints.filter((c) => c.code !== 'REQUIREMENT_WITHOUT_ACTIVITY' || !showProject).map((c) => (
          <span key={c.code} className="ax-reqline-flag" data-severity={c.severity}>{c.text}</span>
        ))}
        {r.satisfied_at && <span className="ax-reqline-where">atendido{r.satisfiedByName ? ` por ${r.satisfiedByName}` : ''} em {dateShort(r.satisfied_at)}</span>}
      </div>
      <div className="ax-reqline-when">
        <span className="ax-row-due" data-late={due.late && r.readiness !== 'READY' ? 'true' : undefined}>{r.needBy ? dateShort(r.needBy) : 'sem data'}</span>
        <small>{r.needBy ? (needFromActivity ? 'início da frente' : due.text) : 'defina a data'}</small>
      </div>
      <div className="ax-reqline-state">
        <ReadinessChip value={r.readiness} />
        {actions !== undefined ? (actions && <div className="ax-reqline-actions">{actions}</div>)
          : supply && r.status === 'CONFIRMED' && r.readiness !== 'READY'
            ? <div className="ax-reqline-actions"><Link className="ax-btn sm" href={href.requirement(r.id)}>Cobrir no Supply</Link></div>
            : null}
      </div>
    </div>
  );
}

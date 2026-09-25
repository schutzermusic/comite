'use client';

import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { relativeDue } from '@/components/ax/format';
import type { DecisionPreview, DecisionsModel, SectionState } from '@/lib/dashboard/types';
import { Failed, Restricted } from './common';

type Model = Pick<DecisionsModel, 'count' | 'overdue' | 'top'> & Partial<Pick<DecisionsModel, 'escalated' | 'alsoEligible' | 'setup'>>;

/**
 * DECISÕES, vistas daqui — nunca a caixa. O número é o MESMO do selo do
 * cabeçalho (mesma consulta, mesma loja); os primeiros vêm na ordem da caixa.
 * Decidir é em Decisões (o Supply Chain do local aprova a compra pelo MESMO
 * ato, no módulo). Leitura que falhou diz que falhou — nunca "nada aguardando".
 */
export function DecisionsPanel({ section, count, today, title = 'Decisões', scope = 'org', testId = 'dashboard-decisions' }: {
  section: SectionState<Model>;
  /** O número do selo (quando já conhecido); senão, o do servidor. */
  count?: number | null;
  today: string;
  title?: string;
  scope?: 'org' | 'site';
  testId?: string;
}) {
  const head = (n: number | null, tone?: string) => (
    <div className="dg-panel-head">
      <div className="dg-eyebrow"><Inbox size={14} aria-hidden className="dg-ico" /><span>{title}</span></div>
      {n !== null && n > 0 && <span className="dg-count" data-tone={tone}>{n}</span>}
    </div>
  );
  if (section.state === 'restricted') {
    return <section className="dg-panel dg-dec" aria-label={title} data-testid={testId}>{head(null)}<Restricted>o seu perfil não lê a caixa de decisões.</Restricted></section>;
  }
  if (section.state === 'error') {
    return (
      <section className="dg-panel dg-dec" aria-label={title} data-testid={testId}>
        {head(null)}
        <Failed what="A caixa de decisões" message={section.message} />
        <Link className="dg-link" href="/decisoes">Abrir Decisões<ChevronRight size={14} aria-hidden /></Link>
      </section>
    );
  }
  const d = section.data;
  const n = scope === 'org' && typeof count === 'number' ? count : d.count;
  const tone = d.overdue > 0 ? 'danger' : n > 0 ? 'warn' : undefined;
  return (
    <section className="dg-panel dg-dec" aria-label={title} data-testid={testId}>
      {head(n, tone)}
      {n === 0 ? (
        <p className="dg-empty">
          {scope === 'site' ? 'Nenhuma decisão deste local aguarda você.'
            : d.setup && d.setup.policies === 0 && d.setup.authorities === 0
              ? 'Nenhuma política de aprovação ou alçada foi declarada ainda — as decisões chegam aqui quando forem.'
              : (d.alsoEligible ?? 0) > 0
                ? `Nada aguardando você. ${d.alsoEligible} ${d.alsoEligible === 1 ? 'decisão está' : 'decisões estão'} na sua alçada, com outra pessoa como responsável.`
                : 'Nada aguardando você. Quando uma compra ou um faturamento precisar da sua alçada, ele aparece aqui.'}
        </p>
      ) : (
        <>
          <div className="dg-dec-signals">
            <span><b className="num">{n}</b>aguardando você</span>
            <span data-tone={d.overdue > 0 ? 'danger' : undefined}><b className="num">{d.overdue}</b>{d.overdue === 1 ? 'vencida' : 'vencidas'}</span>
            {typeof d.escalated === 'number' && (
              <span data-tone={d.escalated > 0 ? 'warn' : undefined}><b className="num">{d.escalated}</b>{d.escalated === 1 ? 'escalada' : 'escaladas'}</span>
            )}
          </div>
          <ol className="dg-dec-list">
            {d.top.slice(0, 3).map((item) => <DecisionItem key={item.key} item={item} today={today} />)}
          </ol>
        </>
      )}
      <Link className="dg-link" href="/decisoes">Abrir Decisões<ChevronRight size={14} aria-hidden /></Link>
    </section>
  );
}

function DecisionItem({ item, today }: { item: DecisionPreview; today: string }) {
  const due = item.due ? relativeDue(item.due, today) : null;
  return (
    <li>
      <Link href={item.href} className="dg-dec-item" data-tone={item.priority.tone}>
        <span className="dg-dec-top"><span className="dg-kind">{item.kindLabel}</span><span className="dg-pill" data-tone={item.priority.tone}>{item.priority.label}</span></span>
        <b>{item.title}</b>
        <small>
          {item.project && <span>{item.project}</span>}
          {item.amountRestricted ? <span>Valor restrito</span> : item.amountText ? <span className="num">{item.amountText}</span> : null}
          {due && <span data-late={item.overdue || due.late ? 'true' : undefined}>{due.late ? `venceu ${due.text}` : `prazo ${due.text}`}</span>}
        </small>
      </Link>
    </li>
  );
}

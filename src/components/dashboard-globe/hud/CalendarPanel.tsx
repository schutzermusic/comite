'use client';

import Link from 'next/link';
import { CalendarDays, TriangleAlert } from 'lucide-react';
import { daysBetween, relativeDue } from '@/components/ax/format';
import type { CalendarItem, CalendarModel, SectionState } from '@/lib/dashboard/types';
import { Failed, Restricted, filmDate } from './common';

const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  milestone: 'Marco', activity: 'Atividade', need: 'Necessidade de material', delivery: 'Entrega prevista', due: 'Vencimento',
};
const SHOW = 5;

type Lane = CalendarModel['lanes'][number];
const incomplete = (l: Lane) => l.state === 'unavailable' || (l.state === 'ok' && !!l.partial);

/** Os próximos itens da janela (data válida, de hoje até o fim da janela), em ordem. */
export function nextItems(model: CalendarModel, today: string, limit = SHOW): CalendarItem[] {
  const days = model.days > 0 ? model.days : 30;
  return model.items
    .filter((i) => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(i.date)) return false;
      const d = daysBetween(today, i.date);
      return Number.isFinite(d) && d >= 0 && d <= days;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pt-BR'))
    .slice(0, limit);
}

/**
 * PRÓXIMOS 30 DIAS, compacto: os cinco próximos itens do calendário da
 * empresa (marcos, necessidades, entregas, prazos do cliente, vencimentos).
 * Faixa que falhou aparece ("não carregou"); "nada previsto" só quando TODAS
 * as faixas foram lidas por inteiro.
 */
export function CalendarPanel({ section, today, title = 'Próximos 30 dias', testId = 'dashboard-calendar' }: {
  section: SectionState<CalendarModel>; today: string; title?: string; testId?: string;
}) {
  const head = <div className="dg-eyebrow"><CalendarDays size={14} aria-hidden className="dg-ico" /><span>{title}</span></div>;
  if (section.state === 'restricted') {
    return <section className="dg-panel dg-cal" aria-label={title} data-testid={testId}>{head}<Restricted>o seu perfil não lê o calendário.</Restricted></section>;
  }
  if (section.state === 'error') {
    return <section className="dg-panel dg-cal" aria-label={title} data-testid={testId}>{head}<Failed what="O calendário" message={section.message} /></section>;
  }
  const model = section.data;
  const items = nextItems(model, today);
  const gaps = model.lanes.filter(incomplete);
  const allRestricted = model.lanes.length > 0 && model.lanes.every((l) => l.state === 'restricted');
  const allReadEmpty = model.items.length === 0 && model.lanes.every((l) => l.state === 'ok' && !l.partial);
  const scope = gaps.length > 0 ? ' nas faixas que carregaram' : model.lanes.some((l) => l.state === 'restricted') ? ' nas áreas que você lê' : '';
  return (
    <section className="dg-panel dg-cal" aria-label={title} data-testid={testId}>
      {head}
      {gaps.length > 0 && (
        <ul className="dg-gaps" role="status">
          {gaps.map((l) => (
            <li key={l.id}><TriangleAlert size={12} aria-hidden /><span><b>{l.label}:</b> {l.state === 'unavailable' ? 'não carregou' : 'carregou só em parte'}</span></li>
          ))}
        </ul>
      )}
      {allRestricted ? <Restricted>o seu perfil não lê nenhuma faixa do calendário.</Restricted>
        : allReadEmpty ? <p className="dg-empty">Nada previsto nos próximos {model.days || 30} dias.</p>
          : items.length === 0 ? <p className="dg-empty">Nada nos próximos {model.days || 30} dias{scope}.</p>
            : (
              <ol className="dg-cal-list">
                {items.map((i) => {
                  const due = relativeDue(i.date, today);
                  const body = (
                    <>
                      <span className="dg-cal-date num" data-tone={i.tone}>{filmDate(i.date)}</span>
                      <span className="dg-cal-text">
                        <b>{i.title}</b>
                        <small>{KIND_LABEL[i.kind]}{i.project ? ` · ${i.project}` : ''}</small>
                      </span>
                      <em>{due.text}</em>
                    </>
                  );
                  return <li key={i.id}>{i.href ? <Link href={i.href}>{body}</Link> : <div>{body}</div>}</li>;
                })}
              </ol>
            )}
    </section>
  );
}

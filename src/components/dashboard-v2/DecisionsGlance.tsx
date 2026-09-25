'use client';

import Link from 'next/link';
import { ArrowUpRight, Inbox } from 'lucide-react';
import { Chip, EmptyState, Plane, relativeDue } from '@/components/ax';
import type { DecisionsModel, SectionState } from '@/lib/dashboard/types';

/**
 * DECISÕES, vistas daqui — nunca a caixa.
 *
 * O número é o MESMO do selo (mesma consulta, mesma loja); os três primeiros
 * vêm na ordem da caixa. Nenhum botão de aprovar/recusar: agir é em
 * Decisões, com a impressão digital da decisão, a guarda contra tela velha e
 * a confirmação. Deliberações (votação de comitê) não são decisões e não
 * aparecem aqui.
 */
export function DecisionsGlance({ section, count, today }: { section: SectionState<DecisionsModel>; count: number | null; today: string }) {
  // Caixa não provisionada ou falha de leitura: o bloco some em silêncio — o link "Decisões" do cabeçalho continua.
  if (section.state !== 'ok') return null;
  const d = section.data;
  const n = count ?? d.count;
  return (
    <Plane title="Decisões" count={n > 0 ? n : undefined} countTone={d.overdue > 0 ? 'danger' : n > 0 ? 'warning' : undefined}
      subtitle="O que aguarda você — decidir é em Decisões" flush testId="dashboard-decisions"
      action={<Link className="ax-btn ghost sm" href="/decisoes">Abrir<ArrowUpRight size={13} aria-hidden /></Link>}>
      {n === 0 ? (
        <EmptyState compact title="Nada aguardando você" icon={<Inbox size={18} />}>
          {d.setup && d.setup.policies === 0 && d.setup.authorities === 0
            ? 'Nenhuma política de aprovação ou alçada foi declarada ainda — as decisões chegam aqui quando forem.'
            : d.alsoEligible > 0
              ? `${d.alsoEligible} ${d.alsoEligible === 1 ? 'decisão está' : 'decisões estão'} na sua alçada, com outra pessoa como responsável.`
              : 'Quando uma compra ou um faturamento precisar da sua alçada, ele aparece aqui.'}
        </EmptyState>
      ) : (
        <>
          <div className="dv2-dec-signals">
            <Link href="/decisoes" className="dv2-dec-signal"><b className="num">{n}</b><span>Aguardando você</span></Link>
            <Link href="/decisoes?f=vencidas" className="dv2-dec-signal" data-tone={d.overdue > 0 ? 'danger' : undefined}>
              <b className="num">{d.overdue}</b><span>Vencidas</span>
            </Link>
            <Link href="/decisoes?f=escaladas" className="dv2-dec-signal" data-tone={d.escalated > 0 ? 'warning' : undefined}>
              <b className="num">{d.escalated}</b><span>Escaladas para você</span>
            </Link>
          </div>
          <ol className="dv2-dec-list">
            {d.top.map((item) => {
              const due = item.due ? relativeDue(item.due, today) : null;
              return (
                <li key={item.key}>
                  <Link href={item.href} className="dv2-dec-item" data-tone={item.priority.tone}>
                    <span className="dv2-dec-top">
                      <span className="dv2-kind">{item.kindLabel}</span>
                      <Chip tone={item.priority.tone} quiet>{item.priority.label}</Chip>
                    </span>
                    <span className="dv2-dec-title">{item.title}</span>
                    <span className="dv2-dec-meta">
                      {item.project && <span>{item.project}</span>}
                      {item.amountRestricted ? <span className="ax-subtle">Valor restrito</span> : item.amountText && <strong className="num">{item.amountText}</strong>}
                      {due && <span data-late={item.overdue || due.late ? 'true' : undefined}>{due.late ? `venceu ${due.text}` : `prazo ${due.text}`}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Plane>
  );
}

/** A linha de Decisões no alto da tela quando o bloco lateral cai para baixo da fila (tablet e celular). */
export function DecisionsLine({ model, count }: { model: DecisionsModel; count: number }) {
  return (
    <Link href="/decisoes" className="dv2-decline" data-tone={model.overdue > 0 ? 'danger' : 'warning'}>
      <Inbox size={16} aria-hidden />
      <span>
        <strong>{count} {count === 1 ? 'decisão aguarda você' : 'decisões aguardam você'}</strong>
        {model.overdue > 0 && <> · {model.overdue} {model.overdue === 1 ? 'vencida' : 'vencidas'}</>}
        {model.escalated > 0 && <> · {model.escalated} {model.escalated === 1 ? 'escalada' : 'escaladas'}</>}
      </span>
      <ArrowUpRight size={14} aria-hidden />
    </Link>
  );
}

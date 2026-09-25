'use client';

import { useId, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Chip, date, plural } from '@/components/ax';
import { STATUS_LABEL, STATUS_TONE, effectiveDeadline } from '@/lib/decisions/model';
import type { Bottleneck, CompletedItem, DecisionItem, TeamItem } from '@/lib/decisions/types';
import {
  COMPLETED_ROLE_LABEL, amountText, completedStatus, fullDateTime, ownersText, requesterText, rowContext, sourceLabelFor,
  statusLabelFor, teamAmountText, waitingText,
} from './view';

/**
 * As linhas das três abas. Uma linha é um CARTÃO no celular (valor grande,
 * contexto em rótulo/valor, botão de 44 px) e uma linha densa no computador
 * (valor à direita). Clicar em qualquer ponto abre o detalhe; pelo teclado,
 * o botão é o alvo — nenhum controle aninhado em outro.
 */
const openOnRowClick = (open: () => void) => (e: MouseEvent<HTMLElement>) => {
  if ((e.target as HTMLElement).closest('a, button, summary, input, textarea')) return;
  open();
};

function Row({ tone, current, testId, rowKey, onOpen, titleId, eyebrow, amount, amountMuted, title, context, meta, action }: {
  tone: string; current: boolean; testId: string; rowKey: string; onOpen: () => void; titleId: string;
  eyebrow: ReactNode; amount: string; amountMuted?: boolean; title: string;
  context: Array<{ label: string; value: string; emphasis?: boolean; tone?: 'danger' }>; meta?: ReactNode; action: ReactNode;
}) {
  return (
    <li className="dec-item">
      <article className="dec-row" data-tone={tone} data-open={current ? 'true' : undefined} aria-labelledby={titleId}
        aria-current={current ? 'true' : undefined} data-testid={testId} data-key={rowKey} onClick={openOnRowClick(onOpen)}>
        <div className="dec-row-eyebrow">{eyebrow}</div>
        <div className="dec-row-amount" data-muted={amountMuted ? 'true' : undefined}>{amount}</div>
        <h4 className="dec-row-title" id={titleId}>{title}</h4>
        {context.length > 0 && (
          <dl className="dec-context">
            {context.map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd data-emphasis={c.emphasis ? 'true' : undefined} data-tone={c.tone}>{c.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {meta && <div className="dec-row-meta">{meta}</div>}
        <div className="dec-row-action">{action}</div>
      </article>
    </li>
  );
}

/** "Minhas" e "Também sob sua alçada": o que a pessoa decide, na ordem da fila. */
export function DecisionRow({ item, today, current, onOpen, variant = 'mine' }: {
  item: DecisionItem; today: string; current: boolean; onOpen: (key: string) => void; variant?: 'mine' | 'eligible';
}) {
  const titleId = useId();
  const deadline = effectiveDeadline(item);
  const requester = requesterText(item.requestedBy, item.requestedAt, today);
  const open = () => onOpen(item.key);
  return (
    <Row tone={item.priority.tone} current={current} testId="decision-row" rowKey={item.key} onOpen={open} titleId={titleId}
      eyebrow={<>
        <span className="dec-kind">{item.kindLabel}</span>
        {item.priority.code !== 'NORMAL' && <Chip tone={item.priority.tone}>{item.priority.label}</Chip>}
      </>}
      amount={item.amount === null ? 'Sem valor' : amountText(item.amount, item.currency)} amountMuted={item.amount === null}
      title={item.title} context={rowContext(item)}
      meta={<>
        <Chip tone={STATUS_TONE[item.status]} quiet>{statusLabelFor(item.status, variant === 'mine')}</Chip>
        {item.assignment === 'ESCALATED' && <span className="dec-hint" data-tone="danger">Escalada para você: o prazo da faixa primária venceu</span>}
        {variant === 'eligible' && <span className="dec-hint">Você tem alçada, mas a decisão é de outra faixa</span>}
        {deadline && item.priority.code !== 'OVERDUE' && !item.context.some((c) => c.label === 'Decidir até')
          && <span>Decidir até <strong>{date(deadline)}</strong></span>}
        {requester && <span>{requester}</span>}
      </>}
      action={
        <button type="button" className={variant === 'mine' ? 'ax-btn primary' : 'ax-btn'} onClick={open} aria-describedby={titleId}
          data-testid="decision-open">Analisar</button>
      } />
  );
}

/** "Equipe": com quem está, há quanto tempo e se venceu. Valor que a pessoa não vê é "Restrito". */
export function TeamRow({ item, current, onOpen }: { item: TeamItem; current: boolean; onOpen: (key: string) => void }) {
  const titleId = useId();
  const owners = ownersText(item.owners);
  const deadline = effectiveDeadline(item);
  const waiting = waitingText(item.waitingDays);
  const open = () => onOpen(item.key);
  const context = [
    ...(item.projectName ? [{ label: 'Projeto', value: item.projectName }] : []),
    { label: 'Com', value: owners.text, emphasis: !owners.none, tone: owners.none ? 'danger' as const : undefined },
    ...(waiting ? [{ label: 'Aguardando', value: waiting }] : []),
    ...(deadline ? [{ label: item.overdue ? 'Venceu em' : 'Decidir até', value: date(deadline), tone: item.overdue ? 'danger' as const : undefined }] : []),
  ];
  return (
    <Row tone={item.overdue || owners.none ? 'danger' : item.state === 'ESCALADA' ? 'warning' : 'neutral'} current={current}
      testId="decision-team-row" rowKey={item.key} onOpen={open} titleId={titleId}
      eyebrow={<>
        <span className="dec-kind">{item.kindLabel}</span>
        <Chip tone={STATUS_TONE[item.status]}>{statusLabelFor(item.status, false)}</Chip>
        {item.overdue && <Chip tone="danger">Vencida</Chip>}
      </>}
      amount={teamAmountText(item)} amountMuted={item.amountRestricted || item.amount === null}
      title={item.title} context={context}
      meta={item.requestedBy?.name ? <span>Solicitado por {item.requestedBy.name}</span> : undefined}
      action={<button type="button" className="ax-btn" onClick={open} aria-describedby={titleId}>Ver</button>} />
  );
}

/** "Concluídas": trilha de auditoria — quem decidiu, quando, por quê e sob que alçada. Só leitura. */
export function CompletedRow({ item, current, onOpen }: { item: CompletedItem; current: boolean; onOpen: (key: string) => void }) {
  const titleId = useId();
  const status = completedStatus(item);
  const open = () => onOpen(item.key);
  const context = [
    { label: 'Decisão', value: `${STATUS_LABEL[status]}${item.decidedBy?.name ? ` por ${item.decidedBy.name}` : ''}`, emphasis: true },
    ...(item.decidedAt ? [{ label: 'Quando', value: fullDateTime(item.decidedAt) }] : []),
    ...(item.requestedBy?.name ? [{ label: 'Solicitada por', value: `${item.requestedBy.name}${item.requestedAt ? ` · ${date(item.requestedAt)}` : ''}` }] : []),
    ...(item.projectName ? [{ label: 'Projeto', value: item.projectName }] : []),
    ...(item.authoritySummary ? [{ label: 'Alçada', value: item.authoritySummary }] : []),
  ];
  return (
    <Row tone={STATUS_TONE[status]} current={current} testId="decision-completed-row" rowKey={item.key} onOpen={open} titleId={titleId}
      eyebrow={<>
        <span className="dec-kind">{item.kindLabel}</span>
        <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
        <Chip tone="accent" quiet>{COMPLETED_ROLE_LABEL[item.viewerRole]}</Chip>
      </>}
      amount={item.amount === null ? 'Sem valor' : amountText(item.amount, item.currency)} amountMuted={item.amount === null}
      title={item.title} context={context}
      meta={<>
        {item.reason && <p className="dec-reason" title={item.reason}>“{item.reason}”</p>}
        <Link className="ax-link" href={item.sourceHref}>{sourceLabelFor(item.sourceHref)}<ArrowUpRight size={12} aria-hidden /></Link>
      </>}
      action={<button type="button" className="ax-btn" onClick={open} aria-describedby={titleId}>Ver</button>} />
  );
}

/** Onde as decisões param, por dono. "Sem decisor elegível" é a trava mais grave — fica em cima, em vermelho. */
export function Bottlenecks({ list }: { list: Bottleneck[] }) {
  return (
    <ul className="dec-bottlenecks" data-testid="decisions-bottlenecks-list">
      {list.map((b, i) => (
        <li key={b.owner?.id ?? `sem-decisor-${i}`} data-tone={b.owner === null ? 'danger' : b.overdue > 0 ? 'warning' : undefined}>
          <span className="dec-bn-owner">
            {b.owner ? (b.owner.name ?? 'Pessoa sem nome') : 'Sem decisor elegível'}
          </span>
          <span className="dec-bn-stat"><strong>{b.open.toLocaleString('pt-BR')}</strong> {b.open === 1 ? 'aberta' : 'abertas'}</span>
          <span className="dec-bn-stat" data-tone={b.overdue > 0 ? 'danger' : undefined}>
            <strong>{b.overdue.toLocaleString('pt-BR')}</strong> {b.overdue === 1 ? 'vencida' : 'vencidas'}
          </span>
          <span className="dec-bn-stat">
            {b.oldestWaitingDays === null ? 'espera não medida' : <>mais antiga há <strong>{plural(b.oldestWaitingDays, 'dia', 'dias')}</strong></>}
          </span>
          <span className="dec-bn-amount">{b.amount === null ? '' : amountText(b.amount, 'BRL')}</span>
        </li>
      ))}
    </ul>
  );
}

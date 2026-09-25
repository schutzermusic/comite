'use client';

import { useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Radar } from 'lucide-react';
import { useHudToast } from '@/components/hud';
import {
  Chain, Chip, Due, ErrorState, KV, SidePanel, Skeleton, date, money, notifyChanged, pct, plural, qty, useResource,
} from '@/components/ax';
import {
  ACTION_LABEL, ASSIGNMENT_LABEL, STATUS_LABEL, STATUS_TONE, effectiveDeadline, kindLabel, normalizeReason, parseDecisionKey,
} from '@/lib/decisions/model';
import type { DecisionAction, DecisionActRequest, DecisionDetail, Fact } from '@/lib/decisions/types';
import { ConfirmActDialog } from './ConfirmActDialog';
import {
  ACCESS_LABEL, ACTION_BUTTON_CLASS, ACTION_DONE, CHANNEL_LABEL, NETWORK_MESSAGE, NOTICE_KIND_LABEL, accessNote, amountText, chainView,
  deliveryTone, fullDateTime, interpretActResponse, newIntentId, orderedActions, outcomeLine, sortOptions, statusLabelFor,
  sourceFacts, summaryFacts, verdictTone, type ActVerdict,
} from './view';

type Payload = DecisionDetail & { ok: true };
export type Notice = { tone: 'success' | 'warning' | 'danger'; title: string; text: string };

/**
 * O DETALHE de uma decisão (?d=chave): o que é, quanto, por que chegou até
 * a pessoa, o que muda com cada escolha — e os atos que a fonte executa de
 * verdade, só quando `canAct`. Painel largo no computador; tela cheia no
 * celular, com os atos fixos embaixo.
 *
 * O ato vai para POST /api/decisions/[chave]/act, que executa a MESMA
 * função canônica da origem. Tela velha (409) não é erro: a mensagem diz o
 * que mudou, o detalhe e a lista se refazem e os botões somem se fechou.
 */
export function DecisionPanel({ decisionKey, onClose }: { decisionKey: string; onClose: () => void }) {
  if (!parseDecisionKey(decisionKey)) {
    return (
      <SidePanel open onClose={onClose} wide title="Decisão não encontrada" testId="decision-detail">
        <ErrorState message="O endereço desta decisão não é válido. Abra a decisão de novo pela lista." />
      </SidePanel>
    );
  }
  return <LoadedPanel decisionKey={decisionKey} onClose={onClose} />;
}

function LoadedPanel({ decisionKey, onClose }: { decisionKey: string; onClose: () => void }) {
  const res = useResource<Payload>(`/api/decisions/${encodeURIComponent(decisionKey)}`);
  const d = res.data;
  const { success } = useHudToast();
  const [confirm, setConfirm] = useState<{ action: DecisionAction; intentId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Depois de um desfecho, os atos somem até o detalhe voltar do servidor — sem segundo clique no dado velho.
  const [settledOn, setSettledOn] = useState<Payload | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusNotice = useRef(false);
  // O botão de ato que abriu a confirmação: o foco volta a ele quando se desiste ("Voltar", Esc).
  const confirmOpener = useRef<HTMLElement | null>(null);

  if (!d) {
    return (
      <SidePanel open onClose={onClose} wide testId="decision-detail"
        title={res.state === 'loading' ? 'Carregando decisão…' : 'Decisão indisponível'}>
        {res.state === 'loading' ? <Skeleton /> : <ErrorState message={res.message} onRetry={res.refresh} />}
      </SidePanel>
    );
  }

  const r = d.resolved;
  const item = d.item;
  const kind = item?.kindLabel ?? kindLabel(r.subjectType);
  const decides = d.canAct && (d.access === 'DECIDER' || d.access === 'ELIGIBLE');
  const actions = d.canAct && r.open && settledOn !== d ? orderedActions(d.actions) : [];

  const openConfirm = (action: DecisionAction) => {
    // Uma intenção por abertura: a repetição DESTA confirmação reusa o mesmo intentId.
    confirmOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm({ action, intentId: newIntentId() });
    setReason('');
    setDialogError(null);
    setUncertain(false);
  };

  const settle = (next: Notice) => {
    focusNotice.current = true;
    setConfirm(null);
    setNotice(next);
    setSettledOn(d);
    // Lista, detalhe e o selo de Decisões se refazem a partir do servidor.
    notifyChanged();
  };

  const submit = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setDialogError(null);
    const body: DecisionActRequest = {
      action: confirm.action,
      reason: normalizeReason(reason),
      expectedFingerprint: item?.fingerprint ?? r.fingerprint ?? null,
      intentId: confirm.intentId,
    };
    let verdict: ActVerdict;
    try {
      const response = await fetch(`/api/decisions/${encodeURIComponent(d.key)}/act`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      verdict = interpretActResponse(response.status, await response.json().catch(() => null));
    } catch {
      verdict = { kind: 'error', message: NETWORK_MESSAGE };
    }
    setBusy(false);
    switch (verdict.kind) {
      case 'done': {
        const title = verdict.replay ? 'Já estava registrado' : ACTION_DONE[confirm.action];
        const text = verdict.downstreamPending ? `${verdict.message} O reflexo no módulo de origem é aplicado em instantes.` : verdict.message;
        success(title, text);
        settle({ tone: 'success', title, text });
        break;
      }
      case 'stale': settle({ tone: 'warning', title: 'A decisão mudou', text: verdict.message }); break;
      case 'forbidden': settle({ tone: 'danger', title: 'Ato não permitido', text: verdict.message }); break;
      case 'invalid': setDialogError(verdict.message); break;
      default:
        // Incerto: pode ter gravado. A repetição é a mesma intenção — e a mesma justificativa.
        setDialogError(verdict.message);
        setUncertain(true);
    }
  };

  const footer = actions.length > 0 ? (
    <div className="dec-actions" data-count={actions.length} role="group" aria-label="Atos desta decisão">
      {actions.map((a) => (
        <button key={a} type="button" className={ACTION_BUTTON_CLASS[a]} onClick={() => openConfirm(a)} data-testid={`decision-act-${a.toLowerCase()}`}>
          {ACTION_LABEL[a]}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <SidePanel open onClose={onClose} wide testId="decision-detail" eyebrow={<b>{kind}</b>} title={r.title} footer={footer}
      meta={<>
        <Chip tone={STATUS_TONE[r.status]}>{statusLabelFor(r.status, decides)}</Chip>
        {item && r.open && item.priority.code !== 'NORMAL' && <Chip tone={item.priority.tone}>{item.priority.label}</Chip>}
        {item && r.open && item.assignment !== 'PRIMARY' && <span>{ASSIGNMENT_LABEL[item.assignment]}</span>}
      </>}>
      <DecisionDetailView d={d} notice={notice} noticeRef={noticeRef} />

      {confirm && (
        <ConfirmActDialog action={confirm.action} subjectType={r.subjectType} kind={kind}
          amount={r.amount === null ? 'Sem valor declarado' : amountText(r.amount, r.currency)} title={r.title}
          reasonRequired={d.reasonRequired} reason={reason} onReason={setReason} busy={busy} error={dialogError} locked={uncertain}
          onConfirm={() => void submit()} onCancel={() => setConfirm(null)}
          onClosedFocus={() => {
            if (focusNotice.current && noticeRef.current) {
              focusNotice.current = false;
              noticeRef.current.focus();
              return true;
            }
            const back = confirmOpener.current;
            if (back && back.isConnected) { back.focus(); return true; }
            return false;
          }} />
      )}
    </SidePanel>
  );
}

/**
 * O corpo do detalhe, sem estado: resultado do ato (região viva), valor,
 * desfecho, e os blocos na ordem em que a decisão se lê — RESUMO →
 * COMPARAÇÃO → IMPACTO → POR QUE (autoridade) → CADEIA —, com ITENS, DADOS
 * DA ORIGEM, HISTÓRICO e NOTIFICAÇÕES recolhidos.
 */
export function DecisionDetailView({ d, notice, noticeRef }: {
  d: DecisionDetail; notice: Notice | null; noticeRef?: RefObject<HTMLDivElement>;
}) {
  const r = d.resolved;
  const item = d.item;
  const decides = d.canAct && (d.access === 'DECIDER' || d.access === 'ELIGIBLE');
  const deadline = item ? effectiveDeadline(item) : null;
  const note = accessNote(d);
  return (
    <>
      {/* Região viva sempre montada: o resultado do ato é anunciado quando chega. */}
      <div className="dec-live" role="status" aria-live="polite">
        {notice && (
          <div ref={noticeRef} tabIndex={-1} className="dec-notice" data-tone={notice.tone} data-testid="decision-notice">
            <strong>{notice.title}</strong>
            <p>{notice.text}</p>
          </div>
        )}
      </div>

      <div className="dec-hero">
        <div className="dec-hero-amount" data-muted={r.amount === null ? 'true' : undefined} data-testid="decision-amount">
          {r.amount === null ? (d.amountRestricted ? 'Restrito' : 'Sem valor declarado') : amountText(r.amount, r.currency)}
        </div>
        <div className="dec-hero-facts">
          {r.open && deadline && <span>Decidir até <strong>{date(deadline)}</strong> · <Due value={deadline} today={d.today} /></span>}
          {r.requestedBy?.name && <span>Solicitado por <strong>{r.requestedBy.name}</strong></span>}
          <span>{ACCESS_LABEL[d.access]}</span>
        </div>
      </div>

      {!r.open && (
        <section className="dec-outcome" data-tone={STATUS_TONE[r.status]} aria-label="Desfecho" data-testid="decision-outcome">
          <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
          <p className="dec-outcome-line">{outcomeLine(r.status, r.closedBy, r.closedAt)}</p>
          {r.closedAt && <small>{fullDateTime(r.closedAt)} · registro da origem, imutável</small>}
          {r.reason && <figure className="dec-quote"><figcaption>Justificativa</figcaption><blockquote>{r.reason}</blockquote></figure>}
        </section>
      )}
      {note && <p className="ax-note" style={{ margin: 0 }}>{note}</p>}

      <Block title="Resumo" testId="decision-summary">
        <KV items={summaryFacts(d).map((f): [ReactNode, ReactNode] => [f.label, factValue(f)])} />
        {r.requestNote && <figure className="dec-quote"><figcaption>Nota da submissão</figcaption><blockquote>{r.requestNote}</blockquote></figure>}
      </Block>

      {d.comparison && d.comparison.options.length > 0 && (
        <Block title="Comparação" count={d.comparison.options.length} testId="decision-comparison">
          <p className="dec-cmp-head">
            {d.comparison.needBy ? <>Necessário até <strong>{date(d.comparison.needBy)}</strong> · </> : null}
            chegada calculada para aprovação em <strong>{date(d.comparison.evaluatedOn)}</strong>
          </p>
          <ul className="dec-options">
            {sortOptions(d.comparison.options).map((o) => (
              <li key={o.quoteId} className="dec-option" data-chosen={o.chosen ? 'true' : undefined}>
                <div className="dec-option-head">
                  <strong>{o.supplier}</strong>
                  {(o.chosen || o.recommended || o.cheapest) && (
                    <span className="ax-wrap">
                      {o.chosen && <Chip tone="accent">Escolhido</Chip>}
                      {o.recommended && <Chip tone="info">Recomendado</Chip>}
                      {o.cheapest && <Chip tone="success">Menor custo</Chip>}
                    </span>
                  )}
                </div>
                <div className="dec-option-amount">{amountText(o.landed, o.currency)}<small>custo total (com frete e impostos)</small></div>
                <dl className="dec-option-facts">
                  <div><dt>Prazo</dt><dd>{o.leadDays === null ? 'não informado' : plural(o.leadDays, 'dia', 'dias')}</dd></div>
                  <div><dt>Chegada</dt><dd>{o.eta ? date(o.eta) : 'sem previsão'}</dd></div>
                  <div><dt>Pontualidade</dt><dd>{o.reliability === null ? 'sem histórico' : pct(o.reliability)}</dd></div>
                </dl>
                <Chip tone={verdictTone(o)}>{o.verdict}</Chip>
                {(!o.compliant || !o.supplierOk) && (
                  <p className="dec-option-flags">{[!o.compliant && 'Proposta com desvio', !o.supplierOk && 'Fornecedor não habilitado'].filter(Boolean).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
          {d.comparison.followsRecommendation === false && (
            <p className="dec-flag" data-tone="warning">A escolha não segue a recomendação da avaliação de propostas.</p>
          )}
          {d.comparison.rationale && (
            <figure className="dec-quote">
              <figcaption>Justificativa da escolha{d.comparison.decidedBy?.name ? ` · ${d.comparison.decidedBy.name}` : ''}{d.comparison.decidedAt ? ` · ${date(d.comparison.decidedAt)}` : ''}</figcaption>
              <blockquote>{d.comparison.rationale}</blockquote>
            </figure>
          )}
        </Block>
      )}

      {d.impact.length > 0 && (
        <Block title="Impacto" count={d.impact.length} testId="decision-impact">
          <ul className="dec-impacts">
            {d.impact.map((f, i) => (
              <li key={i} className="ax-apex" data-tone={f.tone}>
                <span className="ax-apex-mark" aria-hidden><Radar size={15} /></span>
                <div className="ax-apex-body">
                  <span className="ax-apex-lead">Apex identificou</span>
                  <span className="ax-apex-title">{f.statement}</span>
                  {f.evidence.length > 0 && (
                    <details className="dec-evidence">
                      <summary>Ver evidência ({f.evidence.length})<ChevronDown size={13} className="dec-chevron" aria-hidden /></summary>
                      <dl>{f.evidence.map((e, j) => <div key={j}><dt>{e.label}</dt><dd title={e.source ?? undefined}>{factValue(e)}</dd></div>)}</dl>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {d.why.length > 0 && (
        <Block title={!r.open ? 'Alçada e origem' : decides ? 'Por que esta decisão chegou até você' : 'Quem decide e por quê'} testId="decision-why">
          <KV items={d.why.map((f): [ReactNode, ReactNode] => [f.label, <span key={f.label} title={f.source ?? undefined}>{factValue(f)}</span>])} />
        </Block>
      )}

      {d.chain.length > 0 && (
        <Block title="Cadeia" testId="decision-chain">
          <div className="dec-chain">
            <Chain label="Da decisão ao faturamento" nodes={chainView(d.chain).map((n) => ({
              label: <><em>{n.label}</em>{n.detail && <span className={n.missing ? 'dec-missing' : undefined}>{n.detail}</span>}</>,
              href: n.href ?? undefined,
            }))} />
          </div>
        </Block>
      )}

      {d.lines.length > 0 && (
        <Block title="Itens" count={d.lines.length} open={false} testId="decision-lines">
          <ul className="dec-lines">
            {d.lines.map((l, i) => (
              <li key={`${l.item}-${i}`}>
                <div className="dec-line-main">
                  <strong>{l.item}</strong>
                  {l.description && <span>{l.description}</span>}
                  {(l.requirement || l.needBy) && (
                    <small>{[l.requirement && `para ${l.requirement}`, l.needBy && `necessário até ${date(l.needBy)}`].filter(Boolean).join(' · ')}</small>
                  )}
                </div>
                <div className="dec-line-num">
                  <small>{qty(l.quantity, l.unit)} × {money(l.unitPrice, r.currency || 'BRL')}</small>
                  <strong>{money(l.subtotal, r.currency || 'BRL')}</strong>
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {sourceFacts(d).length > 0 && (
        <Block title={dataTitle(r.subjectType)} count={sourceFacts(d).length} open={false} testId="decision-source-facts">
          <KV items={sourceFacts(d).map((f): [ReactNode, ReactNode] => [f.label, factValue(f)])} />
        </Block>
      )}

      {d.history.length > 0 && (
        <Block title="Histórico" count={d.history.length} open={false} testId="decision-history">
          <ol className="ax-timeline">
            {d.history.map((h, i) => (
              <li key={`${h.at}-${i}`}><span className="ax-timeline-dot" aria-hidden />
                <div className="ax-cellstack">
                  <span><b>{h.label}</b></span>
                  <small>{[h.actor?.name, fullDateTime(h.at)].filter(Boolean).join(' · ')}{h.detail ? ` · ${h.detail}` : ''}</small>
                </div>
              </li>
            ))}
          </ol>
        </Block>
      )}

      {d.notifications.length > 0 && (
        <Block title="Notificações" count={d.notifications.length} open={false} testId="decision-deliveries">
          <ul className="dec-deliveries">
            {d.notifications.map((n, i) => (
              <li key={`${n.channel}-${n.noticeKind}-${i}`}>
                <b>{CHANNEL_LABEL[n.channel] ?? n.channel}</b>
                <span>{NOTICE_KIND_LABEL[n.noticeKind] ?? n.noticeKind}</span>
                <Chip tone={deliveryTone(n.state)} quiet>{n.stateLabel}</Chip>
                {n.at && <span>{fullDateTime(n.at)}</span>}
                {n.detail && <small>{n.detail}</small>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      <div className="dec-origin">
        {r.open && (
          <span>Também podem decidir: <strong>{d.otherDeciders.count.toLocaleString('pt-BR')}</strong>
            {d.otherDeciders.people.length > 0 && ` — ${d.otherDeciders.people.map((p) => p.name ?? 'Pessoa sem nome').join(', ')}`}</span>
        )}
        <Link className="ax-btn" href={d.sourceHref} title={d.sourceLabel} data-testid="decision-source">
          Ver no contexto original<ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>

    </>
  );
}

/** Um bloco do detalhe, com revelação progressiva (<details>): o essencial aberto, a auditoria recolhida. */
function Block({ title, count, open = true, testId, children }: { title: string; count?: number; open?: boolean; testId?: string; children: ReactNode }) {
  return (
    <details className="dec-block" open={open} data-testid={testId}>
      <summary>
        <h3>{title}</h3>
        {count !== undefined && count > 0 && <span className="ax-count">{count}</span>}
        <ChevronDown size={15} className="dec-chevron" aria-hidden />
      </summary>
      <div className="dec-block-body">{children}</div>
    </details>
  );
}

function dataTitle(subjectType: string): string {
  if (subjectType === 'purchase_order') return 'Dados do pedido';
  if (subjectType === 'contract_billing_event') return 'Dados do faturamento';
  return 'Dados da origem';
}

function factValue(f: Fact): ReactNode {
  if (!f.href) return f.value;
  return <Link className="ax-link" href={f.href}>{f.value}</Link>;
}

'use client';

import { useState, type ReactNode } from 'react';
import { Radar, Trophy } from 'lucide-react';
import { RFQ_STATUS_LABEL, SUPPLIER_STATUS_LABEL } from '@/lib/supply/procurement';
import {
  Busy, Chip, EmptyState, Meter, Plane, SidePanel, dateShort, money, parseDecimalBR, pct, plural, useGovernedAction, useUrlParams,
  useUrlParam, type Tone,
} from '@/components/ax';
import { exactQty, notOrderedNotes, type ProcurementModel } from './shared';

type Rfq = ProcurementModel['rfqs'][number];
type RfqLine = Rfq['lines'][number];
type Quote = Rfq['quotes'][number];
type Evaluation = Rfq['evaluations'][number];

/**
 * Linha FORA DO PEDIDO (248): a requisição dela foi cancelada, encerrada, já
 * tem pedido, ou a linha não tem mais nada em aberto (`orderable` da leitura)
 * — decidir não a põe no pedido, e a comparação (completude, custo posto,
 * necessidade) já não a conta. Só vale na cotação ABERTA: é o que a decisão
 * vai pedir; na decidida, o pedido já existe.
 */
export const outOfOrder = (rfq: Pick<Rfq, 'status'>, l: Pick<RfqLine, 'orderable'>) => rfq.status === 'OPEN' && !l.orderable;

const lineText = (l: Pick<RfqLine, 'itemCode' | 'quantity' | 'unit'>) => `${l.itemCode} ${exactQty(l.quantity, l.unit)}`;
const linesText = (rfq: Pick<Rfq, 'status' | 'lines'>) =>
  rfq.lines.map((l) => `${lineText(l)}${outOfOrder(rfq, l) ? ' (fora do pedido)' : ''}`).join(' · ');

const DECIDED = 'Compra decidida';

/**
 * O aviso de "Decidir compra" sai do que o BANCO devolveu (248): o pedido que
 * nasceu em rascunho e, por requisição, a linha cotada que NÃO entrou nele
 * (`not_ordered`: "RC-… cancelada: a linha CABO-35-XLPE (50 m) não entrou no
 * pedido"), com a quantidade cotada exata. Na repetição, que nada foi
 * duplicado.
 */
export function decideOutcomeNotice(result: Record<string, unknown> | null | undefined, rfq: Pick<Rfq, 'lines'>): { title: string; detail: string } {
  const r = result ?? {};
  const po = typeof r.order_number === 'string' && r.order_number ? r.order_number : null;
  if (r.replayed === true) return { title: DECIDED, detail: `Já estava decidida — nada foi duplicado.${po ? ` O pedido é o ${po}.` : ''}` };
  const born = `${po ? `O pedido ${po}` : 'O pedido'} nasceu em rascunho — confira a entrega e submeta.`;
  const out = notOrderedNotes(r.not_ordered, (id) => {
    const l = rfq.lines.find((x) => x.requisitionLineId === id);
    return l ? `${l.itemCode} (${exactQty(l.quantity, l.unit)})` : null;
  });
  return { title: DECIDED, detail: out.length ? `${born} ${out.join('. ')}.` : born };
}

/** A mensagem do ato "Decidir compra" (via `msg.done`): a recusa leva o nome do ato; o sucesso, o desfecho do banco (`decideOutcomeNotice`). */
export function decideNotice(rfq: Pick<Rfq, 'lines'>) {
  return { title: 'Decidir compra', done: (result: Record<string, unknown>) => decideOutcomeNotice(result, rfq) };
}

/**
 * COTAÇÕES — propostas versionadas e a COMPARAÇÃO lado a lado: custo total
 * posto (itens + frete + impostos), chegada contra a necessidade, prazo,
 * condição, validade, pontualidade MEDIDA do fornecedor e conformidade. A
 * recomendação é explicada; decidir é humano — contra ela, com justificativa.
 * A linha fora do pedido segue à vista, marcada, sem contar na comparação.
 */
export function QuotationsStage({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [openId] = useUrlParam<string>('rfq', '');
  const patch = useUrlParams();
  const rfqs = [...data.rfqs].sort((a, b) => Number(b.status === 'OPEN') - Number(a.status === 'OPEN') || b.createdAt.localeCompare(a.createdAt));
  const open = openId ? data.rfqs.find((r) => r.id === openId) ?? null : null;
  return (
    <Plane flush title="Cotações" count={data.rfqs.filter((r) => r.status === 'OPEN').length}
      subtitle="Proposta nova do mesmo fornecedor é versão nova — a anterior fica no histórico">
      {rfqs.length === 0 ? <EmptyState title="Nenhuma cotação">Marque linhas em Solicitações e abra uma cotação para vários fornecedores.</EmptyState> : (
        <div className="ax-queue">
          {rfqs.map((r) => {
            const received = r.quotes.filter((q) => q.status === 'RECEIVED').length;
            const rec = r.recommendation ? r.quotes.find((q) => q.id === r.recommendation!.quoteId) : null;
            const tone: Tone = r.status !== 'OPEN' ? 'neutral' : received ? 'warning' : 'info';
            return (
              <div key={r.id} className="ax-row no-owner" data-tone={tone} data-testid="rfq-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{RFQ_STATUS_LABEL[r.status]}</span>
                    <span className="ax-row-where">{plural(r.invited.length, 'convidado', 'convidados')} · {received} de {r.invited.length} com proposta
                      {!r.decision && rec ? ` · Apex recomenda ${rec.supplier}` : ''}</span></span>
                  <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ rfq: r.id })}>{r.number}</button>
                  <span className="ax-row-issue">{linesText(r)}</span>
                </div>
                <div className="ax-cellstack">
                  <span className="ax-row-due">{r.responseDue ? dateShort(r.responseDue) : 'sem prazo'}</span>
                  <small>{r.decision ? 'decidida' : received ? 'pronta para decidir' : 'resposta'}</small>
                </div>
                <div className="ax-row-actions">
                  <button type="button" className="ax-btn sm" onClick={() => patch({ rfq: r.id })}>Abrir</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <RfqPanel rfq={open} data={data} onClose={() => patch({ rfq: null })} onChanged={onChanged} />}
    </Plane>
  );
}

function RfqPanel({ rfq, data, onClose, onChanged }: { rfq: Rfq; data: ProcurementModel; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<'quote' | 'decide' | null>(null);
  const canSource = data.capabilities.source;
  const live = rfq.quotes.filter((q) => q.status === 'RECEIVED');
  const evalById = new Map(rfq.evaluations.map((e) => [e.quoteId, e]));
  const columns = live.slice().sort((a, b) => (evalById.get(a.id)?.landed ?? Infinity) - (evalById.get(b.id)?.landed ?? Infinity));
  const onTime = new Map(data.suppliers.map((s) => [s.id, s]));
  // A necessidade é a das linhas que viram pedido (a mesma régua da avaliação); a fora do pedido não a antecipa.
  const need = rfq.lines.filter((l) => !outOfOrder(rfq, l)).map((l) => l.requiredBy).filter(Boolean).sort()[0] ?? null;
  const best = {
    landed: Math.min(...columns.map((q) => evalById.get(q.id)?.landed ?? Infinity)),
    late: Math.min(...columns.map((q) => evalById.get(q.id)?.lateDays ?? Infinity)),
    lead: Math.min(...columns.map((q) => q.leadTimeDays ?? Infinity)),
  };
  const mark = (q: Quote) => (rfq.decision?.quoteId === q.id ? 'chosen' : rfq.recommendation?.quoteId === q.id ? 'recommended' : undefined);

  return (
    <SidePanel open onClose={onClose} wide testId="rfq-drawer" eyebrow={`Cotação · ${RFQ_STATUS_LABEL[rfq.status]}`} title={rfq.number}
      meta={<><span>{linesText(rfq)}</span>
        {need && <span>necessidade {dateShort(need)}</span>}{rfq.responseDue && <span>resposta até {dateShort(rfq.responseDue)}</span>}</>}
      footer={rfq.status === 'OPEN' && canSource ? <>
        <button type="button" className="ax-btn" onClick={() => setMode('quote')}>Registrar proposta</button>
        <button type="button" className="ax-btn primary" disabled={!live.length} onClick={() => setMode('decide')}>Decidir compra</button>
      </> : undefined}>
      {rfq.recommendation && (
        <div className="ax-apex-inline" style={{ marginBottom: 14 }}>
          <Radar size={13} aria-hidden /><span><b>Apex recomenda</b> — {rfq.recommendation.rationale} Decidir é seu: pode escolher outra, com justificativa.</span>
        </div>
      )}
      {rfq.decision && (
        <p className="ax-note" style={{ marginTop: 0 }}>
          <strong>Decisão</strong> de {rfq.decision.decidedBy ?? '—'} {rfq.decision.followsRecommendation ? '(seguiu a recomendação)' : '(contra a recomendação)'}:
          {' '}{rfq.decision.rationale}
        </p>
      )}
      {columns.length === 0 ? (
        <EmptyState compact title="Nenhuma proposta registrada">
          {plural(rfq.invited.length, 'fornecedor convidado', 'fornecedores convidados')}: {rfq.invited.map((i) => i.supplier).join(', ')}.
        </EmptyState>
      ) : (
        <>
          <div className="ax-table-wrap ax-desktop-only">
            <table className="ax-table ax-compare" aria-label="Comparação das propostas">
              <thead>
                <tr>
                  <th scope="col">Critério</th>
                  {columns.map((q) => (
                    <th key={q.id} scope="col" data-mark={mark(q)} data-testid="quote-row">
                      <span className="ax-cellstack">
                        <span className="ax-compare-name">{q.supplier} <small>v{q.version}</small></span>
                        {mark(q) === 'recommended' && <Chip tone="accent">Recomendada</Chip>}
                        {mark(q) === 'chosen' && <Chip tone="success">Escolhida</Chip>}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <CompareRow label="Custo total posto" hint="itens + frete + impostos" columns={columns} mark={mark}
                  cell={(q) => { const e = evalById.get(q.id); return e ? <Best on={e.landed === best.landed}><strong>{money(e.landed, e.currency)}</strong></Best> : '—'; }} />
                <CompareRow label="Composição" columns={columns} mark={mark}
                  cell={(q) => { const e = evalById.get(q.id); return e ? <small>itens {money(e.goods, e.currency)}{q.freight ? ` + frete ${money(q.freight, e.currency)}` : ''}{q.tax ? ` + impostos ${money(q.tax, e.currency)}` : ''}</small> : '—'; }} />
                <CompareRow label="Chegada estimada" hint="hoje + prazo" columns={columns} mark={mark}
                  cell={(q) => { const e = evalById.get(q.id); if (!e) return '—';
                    return <Best on={(e.lateDays ?? 0) === 0 && best.late === 0}><span className="ax-cellstack"><span className="ax-num">{dateShort(e.eta)}</span>
                      <small className={e.lateDays ? 'ax-danger-text' : 'ax-ok-text'}>{e.lateDays ? `${plural(e.lateDays, 'dia', 'dias')} depois da necessidade` : 'chega a tempo'}</small></span></Best>; }} />
                <CompareRow label="Prazo de entrega" columns={columns} mark={mark}
                  cell={(q) => (q.leadTimeDays === null ? '—' : <Best on={q.leadTimeDays === best.lead}>{plural(q.leadTimeDays, 'dia', 'dias')}</Best>)} />
                <CompareRow label="Condição de pagamento" columns={columns} mark={mark} cell={(q) => q.paymentTerms ?? '—'} />
                <CompareRow label="Validade" columns={columns} mark={mark}
                  cell={(q) => { const e = evalById.get(q.id); return <span className={e?.expired ? 'ax-danger-text' : undefined}>{dateShort(q.validityDate)}{e?.expired ? ' · vencida' : ''}</span>; }} />
                <CompareRow label="Pontualidade medida" hint="linhas recebidas no prazo" columns={columns} mark={mark}
                  cell={(q) => { const s = onTime.get(q.supplierId); const rate = s?.onTimeRate ?? null;
                    return rate === null ? <small>sem histórico</small> : <span className="ax-cellstack"><span>{pct(rate)} · {plural(s?.deliveryLines ?? 0, 'linha', 'linhas')}</span>
                      <Meter value={rate} tone={rate >= 0.9 ? 'success' : rate >= 0.7 ? 'warning' : 'danger'} label={`${q.supplier}: ${pct(rate)} no prazo`} /></span>; }} />
                <CompareRow label="Fornecedor" columns={columns} mark={mark}
                  cell={(q) => <Chip tone={q.supplierStatus === 'HOMOLOGATED' ? 'success' : q.supplierStatus === 'PROSPECT' ? 'neutral' : 'danger'} quiet>{SUPPLIER_STATUS_LABEL[q.supplierStatus]}</Chip>} />
                <CompareRow label="Conformidade" columns={columns} mark={mark}
                  cell={(q) => (q.deviations ? <small className="ax-warn-text">Desvio: {q.deviations}</small> : q.lines.every((l) => l.compliant) ? <small className="ax-ok-text">conforme</small> : <small className="ax-warn-text">linha não conforme</small>)} />
                {rfq.lines.map((l) => {
                  // Fora do pedido: o preço cotado fica à vista, mas não soma nem falta — a decisão não pede esta linha.
                  const out = outOfOrder(rfq, l);
                  return (
                    <CompareRow key={l.id} label={`${l.itemCode} · ${exactQty(l.quantity, l.unit)}`} hint={out ? undefined : 'preço unitário'}
                      tag={out ? <span data-testid="rfq-line-out-of-order"><Chip tone="neutral" quiet>fora do pedido</Chip></span> : undefined}
                      columns={columns} mark={mark}
                      cell={(q) => { const ql = q.lines.find((x) => x.rfqLineId === l.id);
                        if (!ql) return out ? <small className="ax-subtle">fora do pedido</small> : <small className="ax-danger-text">não cotado</small>;
                        return <span className="ax-cellstack"><span className="ax-num">{money(ql.unitPrice, q.currency, { cents: true })}</span>
                          <small className={out ? 'ax-subtle' : undefined}>{out ? 'fora do pedido' : money(ql.unitPrice * l.quantity, q.currency)}</small></span>; }} />
                  );
                })}
                <CompareRow label="Pontos de atenção" columns={columns} mark={mark}
                  cell={(q) => { const e = evalById.get(q.id); return e?.flags.length ? <small>{e.flags.join(' · ')}</small> : <small className="ax-subtle">nenhum</small>; }} />
              </tbody>
            </table>
          </div>
          <div className="ax-mobile-only ax-stack" style={{ gap: 10 }}>
            {columns.map((q) => {
              const e = evalById.get(q.id);
              return (
                <article key={q.id} className="ax-quote-card" data-mark={mark(q)} data-testid="quote-card">
                  <header><strong>{q.supplier}</strong> <small>v{q.version}</small>
                    {mark(q) === 'recommended' && <Chip tone="accent">Recomendada</Chip>}{mark(q) === 'chosen' && <Chip tone="success">Escolhida</Chip>}</header>
                  <dl className="ax-kv">
                    <dt>Custo total posto</dt><dd><strong>{e ? money(e.landed, e.currency) : '—'}</strong></dd>
                    <dt>Chegada</dt><dd>{e ? `${dateShort(e.eta)} · ${e.lateDays ? `${e.lateDays} d depois` : 'a tempo'}` : '—'}</dd>
                    <dt>Condição</dt><dd>{q.paymentTerms ?? '—'}</dd>
                    <dt>Pontualidade</dt><dd>{onTime.get(q.supplierId)?.onTimeRate == null ? 'sem histórico' : pct(onTime.get(q.supplierId)!.onTimeRate!)}</dd>
                    {q.deviations && <><dt>Desvio</dt><dd>{q.deviations}</dd></>}
                  </dl>
                </article>
              );
            })}
          </div>
        </>
      )}
      {mode === 'quote' && <QuotePanel rfq={rfq} onClose={() => setMode(null)} onDone={() => { setMode(null); onChanged(); }} />}
      {mode === 'decide' && <DecidePanel rfq={rfq} live={columns} evaluations={evalById} onClose={() => setMode(null)} onDone={() => { setMode(null); onChanged(); }} />}
    </SidePanel>
  );
}

function CompareRow({ label, hint, tag, columns, cell, mark }: {
  label: string; hint?: string; tag?: ReactNode; columns: Quote[]; cell: (q: Quote) => ReactNode; mark: (q: Quote) => string | undefined;
}) {
  return (
    <tr>
      <th scope="row"><span className="ax-cellstack"><span>{label}</span>{hint && <small>{hint}</small>}{tag}</span></th>
      {columns.map((q) => <td key={q.id} data-mark={mark(q)}>{cell(q)}</td>)}
    </tr>
  );
}

function Best({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <span className="ax-best"><Trophy size={11} aria-label="melhor" />{children}</span> : <>{children}</>;
}

export function QuotePanel({ rfq, onClose, onDone }: { rfq: Rfq; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const [supplierId, setSupplierId] = useState(rfq.invited[0]?.supplierId ?? '');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [freight, setFreight] = useState('');
  const [lead, setLead] = useState('');
  const [validity, setValidity] = useState('');
  const [terms, setTerms] = useState('');
  const [deviations, setDeviations] = useState('');
  const lines = rfq.lines.map((l) => ({ rfqLineId: l.id, unitPrice: parseDecimalBR(prices[l.id] ?? '') }))
    .filter((l): l is { rfqLineId: string; unitPrice: number } => l.unitPrice !== null && l.unitPrice >= 0);
  // Toda linha que vira pedido precisa de preço; a fora do pedido é opcional (a decisão não a pede — o banco aceita proposta parcial).
  const priced = new Set(lines.map((l) => l.rfqLineId));
  const complete = lines.length > 0 && rfq.lines.every((l) => outOfOrder(rfq, l) || priced.has(l.id));
  const previous = rfq.quotes.filter((q) => q.supplierId === supplierId).length;
  return (
    <SidePanel open onClose={onClose} testId="quote-form" eyebrow={`Cotação ${rfq.number}`} title="Registrar proposta"
      meta={<span>{previous ? `Este fornecedor já tem ${plural(previous, 'versão', 'versões')}: esta será a v${previous + 1}.` : 'Primeira proposta deste fornecedor.'}</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!supplierId || !complete || busy !== null}
          onClick={() => run(`quote:${rfq.id}:${supplierId}`, `/api/supply/procurement/rfqs/${rfq.id}`, { action: 'quote', supplierId, lines,
            freightAmount: parseDecimalBR(freight) ?? 0, leadTimeDays: lead ? Number(lead) : null, validityDate: validity || null,
            paymentTerms: terms.trim() || null, deviations: deviations.trim() || null }, { title: 'Proposta registrada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Registrar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Fornecedor</span><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          {rfq.invited.map((i) => <option key={i.supplierId} value={i.supplierId}>{i.supplier}</option>)}</select></label>
        {rfq.lines.map((l) => (
          <label key={l.id} className="ax-field"><span>Preço unitário — {l.itemCode} ({exactQty(l.quantity, l.unit)}){outOfOrder(rfq, l) ? ' · fora do pedido, opcional' : ''}</span>
            <input inputMode="decimal" value={prices[l.id] ?? ''} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })} /></label>
        ))}
        <div className="ax-field-row">
          <label className="ax-field"><span>Frete</span><input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} /></label>
          <label className="ax-field"><span>Prazo (dias)</span><input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Validade</span><input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} /></label>
          <label className="ax-field"><span>Condição de pagamento</span><input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="28 dias" /></label>
        </div>
        <label className="ax-field"><span>Desvios (técnicos ou comerciais)</span><textarea value={deviations} onChange={(e) => setDeviations(e.target.value)} /></label>
      </div>
    </SidePanel>
  );
}

export function DecidePanel({ rfq, live, evaluations, onClose, onDone }: {
  rfq: Rfq; live: Quote[]; evaluations: Map<string, Evaluation>; onClose: () => void; onDone: () => void;
}) {
  const { run, busy } = useGovernedAction(onDone);
  const [quoteId, setQuoteId] = useState(rfq.recommendation?.quoteId ?? live[0]?.id ?? '');
  const [rationale, setRationale] = useState('');
  const against = Boolean(rfq.recommendation && quoteId !== rfq.recommendation.quoteId);
  const outside = rfq.lines.filter((l) => outOfOrder(rfq, l));
  return (
    <SidePanel open onClose={onClose} testId="decide-form" eyebrow={`Cotação ${rfq.number}`} title="Decidir compra"
      meta={<span>A decisão gera o pedido em rascunho e fica registrada com a comparação que a sustentou.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!quoteId || rationale.trim().length < 10 || busy !== null}
          onClick={() => run(`decide:${rfq.id}`, `/api/supply/procurement/rfqs/${rfq.id}`, { action: 'decide', quoteId,
            recommendedQuoteId: rfq.recommendation?.quoteId ?? null, rationale: rationale.trim(),
            comparison: { evaluations: rfq.evaluations, recommendation: rfq.recommendation } },
            decideNotice(rfq), { idempotent: false })}>
          <Busy on={busy !== null}>Decidir e gerar pedido</Busy></button>
      </>}>
      {outside.length > 0 && (
        <p className="ax-note" style={{ marginTop: 0 }} data-testid="decide-out-of-order">
          <strong>Fora do pedido:</strong> {outside.map(lineText).join(' · ')} — a requisição não está mais em busca (cancelada, encerrada
          ou já pedida) ou a linha não tem mais nada em aberto. A comparação e o pedido contam só as outras linhas.
        </p>
      )}
      <div className="ax-form" role="radiogroup" aria-label="Proposta escolhida">
        {live.map((q) => {
          const e = evaluations.get(q.id);
          return (
            <label key={q.id} className="ax-choice" data-selected={quoteId === q.id || undefined}>
              <input type="radio" name="quote" checked={quoteId === q.id} onChange={() => setQuoteId(q.id)} />
              <span className="ax-cellstack">
                <span><b>{q.supplier}</b> v{q.version} · {e ? money(e.landed, e.currency) : '—'}</span>
                <small>{e?.lateDays ? `atrasa ${plural(e.lateDays, 'dia', 'dias')}` : 'chega a tempo'}{rfq.recommendation?.quoteId === q.id ? ' · recomendada' : ''}</small>
              </span>
            </label>
          );
        })}
        {against && <p className="ax-problems" role="status" style={{ listStyle: 'none', paddingLeft: 12 }}>Você está indo contra a recomendação — explique o porquê.</p>}
        <label className="ax-field"><span>Justificativa (mín. 10 caracteres)</span><textarea value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      </div>
    </SidePanel>
  );
}

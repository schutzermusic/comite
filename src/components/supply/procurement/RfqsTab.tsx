'use client';

import { useState } from 'react';
import { HudButton, HudDrawer } from '@/components/hud';
import { RFQ_STATUS_LABEL } from '@/lib/supply/procurement';
import { DataTable, EmptyNote, GovernanceNote, StatePill, day } from '@/components/operations/ui';
import { ActModal, qty, useInventoryAct } from '../inventory/shared';
import { brlOf, parseDecimal, type ProcurementModel } from './shared';

type Rfq = ProcurementModel['rfqs'][number];

/** COTAÇÕES — propostas versionadas, comparação além do preço e decisão justificada. */
export function RfqsTab({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.rfqs.find((r) => r.id === openId) ?? null;
  return (
    <>
      <DataTable label="Cotações" columns={['Cotação', 'Itens', 'Convidados', 'Propostas', 'Prazo de resposta', 'Situação', '']}
        count={data.rfqs.length} footer="Proposta nova é versão nova — a anterior fica no histórico"
        empty={<EmptyNote title="Nenhuma cotação" description="Selecione linhas em Solicitações e abra uma cotação." />}>
        {data.rfqs.map((r) => (
          <tr key={r.id} data-testid="rfq-row">
            <td className="tabular-nums"><b>{r.number}</b></td>
            <td>{r.lines.map((l) => `${l.itemCode} ${qty(l.quantity)} ${l.unit}`).join(' · ')}</td>
            <td>{r.invited.map((i) => i.supplier).join(', ')}</td>
            <td className="tabular-nums">{r.quotes.filter((q) => q.status === 'RECEIVED').length} de {r.invited.length}</td>
            <td>{day(r.responseDue)}</td>
            <td><StatePill tone={r.status === 'OPEN' ? 'warning' : r.status === 'DECIDED' ? 'success' : 'neutral'}>{RFQ_STATUS_LABEL[r.status]}</StatePill></td>
            <td><HudButton size="sm" variant="ghost" onClick={() => setOpenId(r.id)}>Abrir</HudButton></td>
          </tr>
        ))}
      </DataTable>
      <HudDrawer isOpen={Boolean(open)} onClose={() => setOpenId(null)} title={open ? `Cotação ${open.number}` : 'Cotação'}
        width="min(760px, 100vw)">
        {open && <RfqDetail rfq={open} canSource={data.capabilities.source} onChanged={onChanged} />}
      </HudDrawer>
    </>
  );
}

function RfqDetail({ rfq, canSource, onChanged }: { rfq: Rfq; canSource: boolean; onChanged: () => void }) {
  const [modal, setModal] = useState<'quote' | 'decide' | null>(null);
  const evalById = new Map(rfq.evaluations.map((e) => [e.quoteId, e]));
  const live = rfq.quotes.filter((q) => q.status === 'RECEIVED');
  return (
    <div className="crm-workspace ops-workspace" data-testid="rfq-drawer">
      <DataTable label="Comparação das propostas" columns={['Fornecedor', 'Custo total posto', 'Chegada', 'Condição', 'Pontos de atenção', '']}
        count={live.length} footer="Custo total posto = itens + frete + impostos · chegada = hoje + prazo"
        empty={<EmptyNote title="Nenhuma proposta registrada" description="Registre as propostas recebidas dos convidados." />}>
        {live.map((q) => {
          const e = evalById.get(q.id);
          const recommended = rfq.recommendation?.quoteId === q.id;
          const chosen = rfq.decision?.quoteId === q.id;
          return (
            <tr key={q.id} data-testid="quote-row">
              <td><b>{q.supplier}</b> <span className="crm-muted">v{q.version}</span>
                {recommended && <p><StatePill tone="accent">Recomendada</StatePill></p>}
                {chosen && <p><StatePill tone="success">Escolhida</StatePill></p>}</td>
              <td className="tabular-nums">{e ? brlOf(e.landed, e.currency) : '—'}
                {e && <p className="crm-muted">itens {brlOf(e.goods, e.currency)}{q.freight ? ` + frete ${brlOf(q.freight, e.currency)}` : ''}</p>}</td>
              <td className={e?.lateDays ? 'crm-tone-danger' : undefined}>{day(e?.eta ?? null)}
                {e?.lateDays ? <p className="crm-muted">{e.lateDays} dia(s) depois da necessidade</p> : null}</td>
              <td>{q.paymentTerms ?? '—'}<p className="crm-muted">validade {day(q.validityDate)}</p></td>
              <td>{e?.flags.length ? e.flags.join(' · ') : <span className="crm-muted">nenhum</span>}</td>
              <td />
            </tr>
          );
        })}
      </DataTable>
      {rfq.recommendation && (
        <GovernanceNote>Recomendação da Apex — {rfq.recommendation.rationale} Decidir é seu: pode escolher outra, com justificativa.</GovernanceNote>
      )}
      {rfq.decision && (
        <p style={{ padding: '0 14px' }}><b>Decisão</b> de {rfq.decision.decidedBy ?? '—'}
          {rfq.decision.followsRecommendation ? ' (seguiu a recomendação)' : ' (contra a recomendação)'}: {rfq.decision.rationale}</p>
      )}
      {rfq.status === 'OPEN' && canSource && (
        <div className="ops-row-actions" style={{ padding: '12px 14px' }}>
          <HudButton size="sm" variant="secondary" onClick={() => setModal('quote')}>Registrar proposta</HudButton>
          <HudButton size="sm" variant="primary" disabled={!live.length} onClick={() => setModal('decide')}>Decidir compra</HudButton>
        </div>
      )}
      {modal === 'quote' && <QuoteModal rfq={rfq} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
      {modal === 'decide' && <DecideModal rfq={rfq} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
    </div>
  );
}

function QuoteModal({ rfq, onClose, onDone }: { rfq: Rfq; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [supplierId, setSupplierId] = useState(rfq.invited[0]?.supplierId ?? '');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [freight, setFreight] = useState('');
  const [lead, setLead] = useState('');
  const [validity, setValidity] = useState('');
  const [terms, setTerms] = useState('');
  const [deviations, setDeviations] = useState('');
  const toNum = parseDecimal;
  const lines = rfq.lines.map((l) => ({ rfqLineId: l.id, unitPrice: toNum(prices[l.id] ?? '') }))
    .filter((l) => Number.isFinite(l.unitPrice) && (prices[l.rfqLineId] ?? '') !== '');
  return (
    <ActModal title="Registrar proposta" subtitle="Registrar de novo o mesmo fornecedor cria uma nova versão." onClose={onClose} busy={busy}
      disabled={!supplierId || !lines.length} confirmLabel="Registrar" testId="quote-form"
      onConfirm={() => act(`/api/supply/procurement/rfqs/${rfq.id}`, { action: 'quote', supplierId, lines,
        freightAmount: freight ? toNum(freight) : 0, leadTimeDays: lead ? Number(lead) : null, validityDate: validity || null,
        paymentTerms: terms.trim() || null, deviations: deviations.trim() || null }, 'Proposta registrada')}>
      <label>Fornecedor<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        {rfq.invited.map((i) => <option key={i.supplierId} value={i.supplierId}>{i.supplier}</option>)}</select></label>
      {rfq.lines.map((l) => (
        <label key={l.id}>Preço unitário — {l.itemCode} ({qty(l.quantity)} {l.unit})
          <input inputMode="decimal" value={prices[l.id] ?? ''} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })} /></label>
      ))}
      <div className="ops-form-row">
        <label>Frete<input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} /></label>
        <label>Prazo (dias)<input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
        <label>Validade<input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} /></label>
      </div>
      <label>Condição de pagamento<input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="28 dias" /></label>
      <label>Desvios (técnicos ou comerciais)<textarea value={deviations} onChange={(e) => setDeviations(e.target.value)} /></label>
    </ActModal>
  );
}

function DecideModal({ rfq, onClose, onDone }: { rfq: Rfq; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const live = rfq.quotes.filter((q) => q.status === 'RECEIVED');
  const [quoteId, setQuoteId] = useState(rfq.recommendation?.quoteId ?? live[0]?.id ?? '');
  const [rationale, setRationale] = useState('');
  const against = Boolean(rfq.recommendation && quoteId !== rfq.recommendation.quoteId);
  return (
    <ActModal title="Decidir compra" subtitle="A decisão gera o pedido de compra em rascunho. Fica registrada com a comparação."
      onClose={onClose} busy={busy} disabled={!quoteId || rationale.trim().length < 10} confirmLabel="Decidir e gerar pedido" testId="decide-form"
      onConfirm={() => act(`/api/supply/procurement/rfqs/${rfq.id}`, { action: 'decide', quoteId,
        recommendedQuoteId: rfq.recommendation?.quoteId ?? null, rationale: rationale.trim(),
        comparison: { evaluations: rfq.evaluations, recommendation: rfq.recommendation } }, 'Compra decidida')}>
      {live.map((q) => {
        const e = rfq.evaluations.find((x) => x.quoteId === q.id);
        return (
          <label key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input type="radio" name="quote" style={{ width: 'auto' }} checked={quoteId === q.id} onChange={() => setQuoteId(q.id)} />
            <span><b>{q.supplier}</b> v{q.version} · {e ? brlOf(e.landed, e.currency) : '—'}{e?.lateDays ? ` · atrasa ${e.lateDays} dia(s)` : ''}
              {rfq.recommendation?.quoteId === q.id ? ' · recomendada' : ''}</span>
          </label>
        );
      })}
      {against && <p className="crm-tone-warning">Você está indo contra a recomendação — explique o porquê.</p>}
      <label>Justificativa (mín. 10 caracteres)<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
    </ActModal>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, PackageCheck, Radar, ShoppingCart } from 'lucide-react';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import {
  COVERAGE_STATUS_LABEL, REQUIREMENT_PRIORITY_LABEL, SUPPLY_RISK_LABEL, strategyOptions, type SupplyRisk,
} from '@/lib/supply/coverage';
import {
  Busy, Chain, Chip, CoverageBar, KV, Section, SidePanel, apexActionable, apexDeepLink, date, href, parseDecimalBR, pct, qty,
  relativeDue, useGovernedAction, type ApexPayload, type ApexSignal, type Tone,
} from '@/components/ax';

export interface DemandCaps { plan: boolean; reserve: boolean; transfer: boolean; requestPurchase: boolean; inventory: boolean }
const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };

/**
 * O REQUISITO aberto: a equação (requerido = consumido + reservado + entrando
 * + inspeção + falta), o item no estoque e as formas de cobrir a falta — cada
 * uma com a simulação do que muda e o ato governado. O banco refaz a conta de
 * disponibilidade na hora; a tela só propõe.
 */
export function RequirementPanel({ row, today, caps, apex, signal, onClose, onApex }: {
  row: MaterialDemandRow; today: string; caps: DemandCaps; apex?: ApexPayload | null; signal: ApexSignal | null;
  onClose: () => void; onApex: (s: ApexSignal) => void;
}) {
  const c = row.coverage;
  const due = relativeDue(row.needBy, today);
  const options = strategyOptions(row.requirementType ?? 'MATERIAL', c.shortage, row.stock);
  return (
    <SidePanel open onClose={onClose} wide testId="demand-drawer"
      eyebrow={<>{row.itemCode ?? 'Material'} · {COVERAGE_STATUS_LABEL[c.status]}</>}
      title={row.itemDescription ?? row.title}
      meta={<>
        <Chip tone={RISK_TONE[row.risk]}>Risco {SUPPLY_RISK_LABEL[row.risk].toLowerCase()}</Chip>
        <span>Necessidade <strong>{date(row.needBy)}</strong> ({due.text})</span>
        <span>{row.project}</span>
      </>}>
      {signal && (
        <div className="ax-apex-inline" style={{ marginBottom: 14 }} data-testid="apex-inline">
          <Radar size={13} aria-hidden />
          <span>Apex recomenda: <b>{signal.action.label}</b> — {signal.rationale}</span>
          {apexActionable(signal, apex?.capabilities) && <button type="button" className="ax-btn primary sm" onClick={() => onApex(signal)}>Executar</button>}
          {signal.action.kind === 'OPEN' && <Link className="ax-btn sm" href={apexDeepLink(signal)}>Abrir</Link>}
        </div>
      )}

      <Section title="A equação do requisito">
        <CoverageBar unit={row.unit} parts={{ required: c.required, consumed: c.consumed, reserved: c.reserved, transit: c.inTransit,
          inspection: c.inspection, onOrder: c.onOrder, shortage: c.shortage }} />
        <dl className="ax-equation" aria-label="Requerido menos o que cobre">
          <dt>Requerido</dt><dd>{qty(c.required, row.unit)}</dd>
          {c.consumed > 0 && <><dt>− Consumido</dt><dd>{qty(c.consumed, row.unit)}</dd></>}
          <dt>− Reservado para este requisito</dt><dd>{qty(c.reserved, row.unit)}</dd>
          <dt>− Em transferência</dt><dd>{qty(c.inTransit, row.unit)}</dd>
          <dt>− Em pedido de compra</dt><dd>{qty(c.onOrder, row.unit)}</dd>
          <dt>− Em inspeção (quarentena)</dt><dd>{qty(c.inspection, row.unit)}</dd>
          <dt className="total">= Falta</dt><dd className={c.shortage > 0 ? 'total short' : 'total'}>{qty(c.shortage, row.unit)}</dd>
        </dl>
        {c.requested > 0 && (
          <p className="ax-note" style={{ marginTop: 8 }}>
            {qty(c.requested, row.unit)} requisitados ainda sem pedido emitido — requisição não é cobertura até virar pedido.
          </p>
        )}
      </Section>

      <Section title="O item no estoque">
        {!caps.inventory ? <p className="ax-muted" style={{ margin: 0 }}>Seu perfil não lê o estoque — a cobertura acima segue válida.</p>
          : !row.itemStock ? <p className="ax-muted" style={{ margin: 0 }}>Requisito sem item do catálogo vinculado.</p> : (
            <>
              <KV items={[
                ['Em mão (locais ativos)', qty(row.itemStock.onHand, row.unit)],
                ['Reservado (todas as demandas)', qty(row.itemStock.reserved, row.unit)],
                ['Disponível', <strong key="a">{qty(row.itemStock.available, row.unit)}</strong>],
                ['Em quarentena', qty(row.itemStock.quarantine, row.unit)],
              ]} />
              {row.stock.length > 0 && (
                <ul className="ax-loclist" aria-label="Estoque livre por local">
                  {row.stock.map((s) => (
                    <li key={s.locationId}><span>{s.locationName}</span>
                      <em>{s.isDestination ? 'canteiro do projeto' : 'outro local'}</em><strong>{qty(s.available, row.unit)}</strong></li>
                  ))}
                </ul>
              )}
            </>
          )}
      </Section>

      {c.shortage > 0 && (
        <Section title="Como cobrir a falta">
          <div className="ax-options" data-testid="demand-strategy">
            {options.map((o, i) => (
              <StrategyOption key={`${o.strategy}:${o.locationId ?? i}`} row={row} option={o} caps={caps} />
            ))}
          </div>
        </Section>
      )}

      <Section title="De onde vem a demanda">
        <Chain label="Da necessidade ao projeto" nodes={[
          { label: row.title },
          ...(row.activity ? [{ label: row.activity, href: href.projectSchedule(row.projectId) }] : []),
          { label: row.project, href: href.project(row.projectId, 'supply') },
        ]} />
        <KV items={[
          ['Prioridade', REQUIREMENT_PRIORITY_LABEL[row.priority] ?? row.priority],
          ['Data do requisito', date(row.requiredBy)],
          ['Início da atividade', row.activityStart ? date(row.activityStart) : '—'],
        ]} />
        <p className="ax-note" style={{ marginTop: 6 }}>A necessidade é a data mais cedo entre o requisito e o início da atividade.</p>
      </Section>
    </SidePanel>
  );
}

function StrategyOption({ row, option, caps }: {
  row: MaterialDemandRow; option: ReturnType<typeof strategyOptions>[number]; caps: DemandCaps;
}) {
  const { run, busy } = useGovernedAction();
  const c = row.coverage;
  const [amount, setAmount] = useState(String(option.quantity).replace('.', ','));
  const [site, setSite] = useState(row.sites[0]?.id ?? '');
  const q = parseDecimalBR(amount);
  const valid = q !== null && q > 0 && q <= option.quantity + 1e-9;
  const covered = c.covered + c.inbound;
  const after = valid ? Math.min(c.required, covered + (q as number)) : covered;
  const simulation = valid && c.required > 0 && (
    <p className="ax-sim" aria-live="polite">
      Falta {qty(c.shortage, row.unit)} → <strong>{qty(Math.max(0, c.shortage - (q as number)), row.unit)}</strong>
      {' · '}coberto ou entrando {pct(covered / c.required)} → <strong>{pct(after / c.required)}</strong>
    </p>
  );
  const location = row.stock.find((s) => s.locationId === option.locationId);
  const qtyField = (
    <label className="ax-field ax-qty"><span>Quantidade ({row.unit ?? 'un'})</span>
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!valid} />
      {!valid && <small className="error">Até {qty(option.quantity, row.unit)}.</small>}
    </label>
  );

  if (option.strategy === 'RESERVE_FROM_STOCK' && option.locationId) {
    return (
      <div className="ax-option" data-testid="strategy-option" data-strategy="reserve">
        <span className="ax-option-icon" aria-hidden><PackageCheck size={16} /></span>
        <div className="ax-option-body">
          <b>Reservar do estoque em {location?.locationName ?? 'local do projeto'}</b>
          <p>{option.rationale}</p>
          {caps.reserve && qtyField}
          {simulation}
        </div>
        {caps.reserve ? (
          <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
            onClick={() => run(`reserve:${row.requirementId}:${option.locationId}`, '/api/supply/inventory/reservations',
              { requirementId: row.requirementId, locationId: option.locationId, quantity: q },
              { title: 'Reservado', detail: `${qty(q, row.unit)} para ${row.project}` })}>
            <Busy on={busy !== null}>Reservar</Busy></button>
        ) : <span className="ax-subtle">Sem alçada para reservar</span>}
      </div>
    );
  }
  if (option.strategy === 'TRANSFER' && option.locationId) {
    const hasSite = row.sites.length > 0;
    return (
      <div className="ax-option" data-testid="strategy-option" data-strategy="transfer">
        <span className="ax-option-icon" aria-hidden><ArrowRightLeft size={16} /></span>
        <div className="ax-option-body">
          <b>Transferir de {location?.locationName ?? 'outro local'}{hasSite ? '' : ' (o projeto não tem canteiro: reservar lá)'}</b>
          <p>{option.rationale}</p>
          {caps.transfer && hasSite && row.sites.length > 1 && (
            <label className="ax-field"><span>Canteiro de destino</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                {row.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
          )}
          {(hasSite ? caps.transfer : caps.reserve) && qtyField}
          {simulation}
        </div>
        {hasSite ? (caps.transfer ? (
          <button type="button" className="ax-btn primary" disabled={!valid || !site || busy !== null}
            onClick={() => run(`transfer:${row.requirementId}:${option.locationId}:${site}`, '/api/supply/inventory/transfers',
              { fromLocationId: option.locationId, toLocationId: site, projectId: row.projectId,
                lines: [{ itemId: row.itemId, quantity: q, requirementId: row.requirementId }] },
              { title: 'Transferência solicitada', detail: `${qty(q, row.unit)} para ${row.sites.find((s) => s.id === site)?.name ?? 'o canteiro'}` })}>
            <Busy on={busy !== null}>Pedir transferência</Busy></button>
        ) : <span className="ax-subtle">Sem alçada para transferir</span>) : (caps.reserve ? (
          <button type="button" className="ax-btn" disabled={!valid || busy !== null}
            onClick={() => run(`reserve:${row.requirementId}:${option.locationId}`, '/api/supply/inventory/reservations',
              { requirementId: row.requirementId, locationId: option.locationId, quantity: q },
              { title: 'Reservado', detail: `${qty(q, row.unit)} em ${location?.locationName ?? 'outro local'}` })}>
            <Busy on={busy !== null}>Reservar lá</Busy></button>
        ) : <span className="ax-subtle">Sem alçada para reservar</span>)}
      </div>
    );
  }
  if (option.strategy === 'BUY') {
    const already = c.requested >= option.quantity;
    return (
      <div className="ax-option" data-testid="strategy-option" data-strategy="buy">
        <span className="ax-option-icon" aria-hidden><ShoppingCart size={16} /></span>
        <div className="ax-option-body">
          <b>Comprar {qty(option.quantity, row.unit)}</b>
          <p>{option.rationale}</p>
        </div>
        {already ? <Link className="ax-btn" href="/supply/compras?stage=solicitacoes">Já requisitado · ver</Link>
          : caps.requestPurchase ? (
            <button type="button" className="ax-btn" disabled={busy !== null}
              onClick={() => run(`requisition:${row.requirementId}`, '/api/supply/procurement/requisitions',
                { source: 'SHORTAGE', requirementIds: [row.requirementId] },
                { title: 'Compra requisitada', detail: 'A requisição segue para cotação em Compras.' })}>
              <Busy on={busy !== null}>Requisitar compra</Busy></button>
          ) : <span className="ax-subtle">Sem alçada para requisitar</span>}
      </div>
    );
  }
  return (
    <div className="ax-option" data-testid="strategy-option" data-strategy="service">
      <span className="ax-option-icon" aria-hidden><ShoppingCart size={16} /></span>
      <div className="ax-option-body"><b>Contratar serviço · {qty(option.quantity, row.unit)}</b><p>{option.rationale}</p></div>
    </div>
  );
}

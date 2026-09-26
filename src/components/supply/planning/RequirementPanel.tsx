'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, PackageCheck, Radar, ShieldAlert, ShoppingCart, Truck } from 'lucide-react';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import {
  COVERAGE_STATUS_LABEL, REQUIREMENT_PRIORITY_LABEL, SUPPLY_RISK_LABEL, strategyOptions, summarizeCoverage, type SupplyRisk,
} from '@/lib/supply/coverage';
import {
  Busy, Chain, Chip, CoverageBar, KV, Section, SidePanel, apexActionable, apexDeepLink, date, href, parseDecimalBR, pct, qty,
  relativeDue, useGovernedAction, type ApexPayload, type ApexSignal, type Tone,
} from '@/components/ax';
import {
  COVERAGE_EXCEPTION_MAX_REASON, coverageOverrideBody, exceptionOutcomeNotice, exceptionReasonState, pendingOverlapText, purchaseGate,
  type PurchaseGate,
} from '../coverage-gate';

export interface DemandCaps {
  plan: boolean; reserve: boolean; transfer: boolean; requestPurchase: boolean; inventory: boolean;
  /** `procurement.coverage_override` — a exceção de cobertura (regra 246). Ausente = o caminho não é oferecido. */
  coverageOverride?: boolean;
}
const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };
const REQUISITIONS_URL = '/api/supply/procurement/requisitions';
const REQUISITIONS_HREF = '/supply/compras?stage=solicitacoes';

/**
 * A cobertura do requisito com os números da regra 246 (`pendingTransfer`,
 * `purchasable`, lidos da visão). Uma leitura sem eles (resposta antiga em
 * cache) passa pela regra do DOMÍNIO (`summarizeCoverage`) — nunca por uma
 * conta da tela.
 */
function coverageOf(row: MaterialDemandRow): MaterialDemandRow['coverage'] {
  const c = row.coverage;
  return Number.isFinite(c.purchasable) && Number.isFinite(c.pendingTransfer) ? c : summarizeCoverage(c);
}

/**
 * O REQUISITO aberto: a equação (requerido = consumido + reservado + entrando
 * + inspeção + falta), o item no estoque e as formas de cobrir a falta — cada
 * uma com a simulação do que muda e o ato governado. O banco refaz a conta de
 * disponibilidade na hora; a tela só propõe.
 *
 * Regra 246: a transferência pedida e ainda não despachada aparece na equação
 * SEM sair da falta (não é cobertura) e fica fora da compra. As formas de
 * cobrir vêm da regra do domínio sobre a COBERTURA (`strategyOptions`: a falta
 * sem o pendente, sem reservar/transferir por cima do já requisitado); o ato
 * de comprar requisita o COMPRÁVEL do banco, e a tela diz qual é. Com o que
 * falta todo em transferência pedida, a compra espera: resolver a
 * transferência no Estoque, ou a exceção de cobertura para quem tem a alçada.
 */
export function RequirementPanel({ row, today, caps, apex, signal, onClose, onApex }: {
  row: MaterialDemandRow; today: string; caps: DemandCaps; apex?: ApexPayload | null; signal: ApexSignal | null;
  onClose: () => void; onApex: (s: ApexSignal) => void;
}) {
  const c = coverageOf(row);
  const due = relativeDue(row.needBy, today);
  const gate = purchaseGate(c, { request: caps.requestPurchase, coverageOverride: caps.coverageOverride === true });
  const options = strategyOptions(row.requirementType ?? 'MATERIAL', c, row.stock);
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
          {gate.pending > 0 && <><dt>Transferência pedida (sem despacho)</dt><dd data-testid="demand-pending-qty">{qty(gate.pending, row.unit)}</dd></>}
          {c.shortage > 0 && gate.purchasable !== null && (gate.pending > 0 || c.requested > 0) && (
            <><dt>Comprável agora</dt><dd data-testid="demand-purchasable-qty">{qty(gate.purchasable, row.unit)}</dd></>
          )}
        </dl>
        {gate.pending > 0 && (
          <p className="ax-note" style={{ marginTop: 8 }} data-testid="demand-pending-note">
            {gate.overlap > 0
              // Depois da exceção de cobertura, a parte sobreposta JÁ foi comprada: "não é comprada de novo" seria falso.
              ? `${qty(gate.pending, row.unit)} em transferência pedida, ainda sem despacho: não é cobertura — não sai da falta. `
                + `${qty(gate.overlap, row.unit)} dela já foram comprados por exceção de cobertura: se a transferência também for despachada, chegam em dobro.`
              : `${qty(gate.pending, row.unit)} em transferência pedida, ainda sem despacho: não é cobertura — não sai da falta — e não é comprada de novo.`}
            {gate.purchasable !== null && gate.purchasable > 0 ? ` A requisição compra só o comprável (${qty(gate.purchasable, row.unit)}).`
              : gate.blocked ? ' Sem comprável agora: a compra espera o despacho ou o cancelamento da transferência.' : ''}
          </p>
        )}
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
            {gate.pending > 0 && <PendingTransferOption row={row} gate={gate} caps={caps} />}
            {options.map((o, i) => (
              <StrategyOption key={`${o.strategy}:${o.locationId ?? i}`} row={row} option={o} caps={caps} gate={gate} />
            ))}
            {gate.canException && <CoverageExceptionOption row={row} gate={gate} />}
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

function StrategyOption({ row, option, caps, gate }: {
  row: MaterialDemandRow; option: ReturnType<typeof strategyOptions>[number]; caps: DemandCaps; gate: PurchaseGate;
}) {
  const { run, busy } = useGovernedAction();
  const c = coverageOf(row);
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
    // COMPRAR = o resto da falta sem o pendente (o já requisitado está pedido). O ATO requisita o COMPRÁVEL do
    // banco — não a sobra do plano —, e a tela diz qual é; e quanto a mais iria se a rede acima não vier antes.
    const already = c.requested >= option.quantity - 1e-9;
    const ask = gate.purchasable ?? 0;
    const planAsk = Math.max(0, option.quantity - c.requested);
    const extra = ask - planAsk > 1e-9 ? ask - planAsk : 0;
    const excluded = [
      gate.pending > 0 ? `os ${qty(gate.pending, row.unit)} pedidos em transferência` : null,
      c.requested > 0 ? `os ${qty(c.requested, row.unit)} já requisitados` : null,
    ].filter(Boolean).join(' e ');
    return (
      <div className="ax-option" data-testid="strategy-option" data-strategy="buy">
        <span className="ax-option-icon" aria-hidden><ShoppingCart size={16} /></span>
        <div className="ax-option-body">
          <b>Comprar {qty(option.quantity, row.unit)}</b>
          <p>{option.rationale}</p>
          {!already && (
            <p className="ax-sim" data-testid="demand-buy-ask">
              A requisição pede <strong>{qty(ask, row.unit)}</strong> — o comprável do banco{excluded ? `, já sem ${excluded}` : ''}.
            </p>
          )}
          {!already && extra > 0 && (
            <p className="ax-warn-text" style={{ margin: 0, fontSize: 12.5 }}>
              Aberta agora, ela pede {qty(ask, row.unit)}: reserve ou transfira antes o que está acima, ou {qty(extra, row.unit)} a mais vão para a compra.
            </p>
          )}
          {!already && c.requested > 0 && <Link className="ax-link" href={REQUISITIONS_HREF} style={{ fontSize: 12.5 }}>{qty(c.requested, row.unit)} já requisitados · ver</Link>}
        </div>
        {already ? <Link className="ax-btn" href={REQUISITIONS_HREF}>Já requisitado · ver</Link>
          : caps.requestPurchase ? (
            <button type="button" className="ax-btn" disabled={busy !== null || ask <= 0}
              onClick={() => run(`requisition:${row.requirementId}`, REQUISITIONS_URL,
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

/**
 * A transferência pedida e ainda não despachada (regra 246), dita às claras:
 * não é cobertura e fica fora da compra. Com o que falta todo nela, a compra
 * ESPERA — o caminho é resolver a transferência no Estoque (despachar: a falta
 * cai; cancelar: volta a ser comprável), ou a exceção abaixo para quem tem a alçada.
 * Depois da exceção (`gate.overlap`), a parte sobreposta JÁ foi comprada: diz
 * quanto, que chega em dobro se a transferência também for despachada, e que o
 * caminho é cancelá-la.
 */
function PendingTransferOption({ row, gate, caps }: { row: MaterialDemandRow; gate: PurchaseGate; caps: DemandCaps }) {
  const transfers = Array.isArray(row.pendingTransfers) ? row.pendingTransfers.filter((t) => t.qty > 0) : [];
  const overlap = pendingOverlapText(gate, (n) => qty(n, row.unit));
  return (
    <div className="ax-option" data-testid="demand-pending-transfer" data-strategy="pending" data-blocked={gate.blocked ? 'true' : undefined}
      data-overlap={overlap ? 'true' : undefined}>
      <span className="ax-option-icon" aria-hidden><Truck size={16} /></span>
      <div className="ax-option-body">
        <b>Transferência pedida · {qty(gate.pending, row.unit)}</b>
        {overlap ? <p data-testid="demand-pending-overlap">{overlap}</p>
          : <p>Ainda não saiu da origem: não conta como cobertura (a falta continua) e fica fora da compra.</p>}
        {transfers.length > 0 && (
          <ul className="ax-loclist" aria-label="Transferências pedidas, sem despacho">
            {transfers.map((t) => (
              <li key={t.transferId}>
                <Link className="ax-link" href={t.href}>{t.number ?? 'Transferência'} · resolver</Link>
                <em>{t.statusLabel}</em>
                <strong>{qty(t.qty, row.unit)}</strong>
              </li>
            ))}
          </ul>
        )}
        {gate.blocked && (
          <p className="ax-warn-text" style={{ margin: 0, fontSize: 12.5 }} data-testid="demand-purchase-blocked">
            Compra bloqueada: o que falta ({qty(gate.exceptionQty, row.unit)}) está pedido em transferência. Ela é liberada quando a
            transferência for despachada (a falta cai) ou cancelada (volta a ser comprável).
            {!gate.canException && caps.requestPurchase ? ' Comprar também a parte pendente só com exceção de cobertura, por quem tem essa alçada.' : ''}
          </p>
        )}
      </div>
      <Link className="ax-btn" href={transfers.length === 1 ? transfers[0].href : href.inventoryView('transferencias')}>Resolver a transferência</Link>
    </div>
  );
}

/**
 * A EXCEÇÃO DE COBERTURA (regra 246), explícita e à parte: compra também a
 * parte pedida em transferência (falta − requisitado), com a justificativa
 * (mín. 20 caracteres, contador) em `coverageOverride: { reason }`. O banco
 * confere `procurement.coverage_override` e registra a exceção; a recusa vem
 * do servidor, em português. O aviso de sucesso é o que o BANCO fez (a
 * exceção usada ou não) — `exceptionNotice`.
 */
function CoverageExceptionOption({ row, gate }: { row: MaterialDemandRow; gate: PurchaseGate }) {
  const { run, busy } = useGovernedAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const st = exceptionReasonState(reason);
  const without = gate.purchasable !== null && gate.purchasable > 0
    ? `sem a exceção, a requisição compra ${qty(gate.purchasable, row.unit)}`
    : 'sem a exceção, a compra fica bloqueada';
  return (
    <div className="ax-option" data-testid="coverage-exception" data-strategy="exception">
      <span className="ax-option-icon" aria-hidden><ShieldAlert size={16} /></span>
      <div className="ax-option-body">
        <b>Exceção de cobertura · comprar {qty(gate.exceptionQty, row.unit)}</b>
        <p>
          Compra também {qty(gate.exceptionExtra, row.unit)} já pedidos em transferência, que ainda não saíram da origem ({without}).
          Fica registrada com o seu nome, a justificativa e as transferências. Se a transferência também for despachada, o material chega em dobro.
        </p>
        {open && (
          <>
            <label className="ax-field"><span>Justificativa da exceção (obrigatória — mín. 20 caracteres)</span>
              <textarea value={reason} maxLength={COVERAGE_EXCEPTION_MAX_REASON} onChange={(e) => setReason(e.target.value)} readOnly={busy !== null}
                aria-invalid={!st.ok || undefined} data-testid="coverage-exception-reason" />
              <small className={st.ok ? undefined : 'error'} aria-live="polite">{st.counter}{st.hint ? ` · ${st.hint}` : ''}</small>
            </label>
            <span className="ax-wrap">
              <button type="button" className="ax-btn ghost" disabled={busy !== null} onClick={() => setOpen(false)}>Voltar</button>
              <button type="button" className="ax-btn primary" disabled={!st.ok || busy !== null} data-testid="coverage-exception-submit"
                onClick={async () => {
                  const r = await run(`coverage-exception:${row.requirementId}`, REQUISITIONS_URL,
                    { source: 'SHORTAGE', requirementIds: [row.requirementId], ...coverageOverrideBody(reason) }, exceptionNotice(row.unit));
                  if (r.ok) { setOpen(false); setReason(''); }
                }}>
                <Busy on={busy !== null}>Registrar a exceção e requisitar</Busy></button>
            </span>
          </>
        )}
      </div>
      {!open && <button type="button" className="ax-btn" onClick={() => setOpen(true)}>Pedir exceção</button>}
    </div>
  );
}

/**
 * O aviso da EXCEÇÃO sai do que o BANCO devolveu (`exceptionOutcomeNotice`):
 * se a transferência foi despachada ou cancelada nesse meio-tempo, ele
 * requisita só o comprável, sem exceção — e o aviso diz isso. O resto é o
 * contrato de `useGovernedAction` (mesma chave por intenção, recusa em português).
 */
export function exceptionNotice(unit: string | null) {
  return { title: 'Exceção de cobertura', done: (result: Record<string, unknown>) => exceptionOutcomeNotice(result, (n) => qty(n, unit)) };
}

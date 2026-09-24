'use client';

import { useState } from 'react';
import { HudButton, useHudToast } from '@/components/hud';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import { SUPPLY_STRATEGY_LABEL, strategyOptions } from '@/lib/supply/coverage';
import { formatQty } from './CoverageBar';

async function post(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload.ok, error: payload?.error as string | undefined, result: payload?.result };
}

/**
 * ESTRATÉGIA PARA A FALTA — explicável e governada. A recomendação diz quanto
 * cada fonte cobre e por quê; agir é um ato separado (reservar ou pedir
 * transferência), e o banco refaz a conta de disponibilidade na hora.
 */
export function DemandActions({
  row, canAct, canRequest = false, onChanged,
}: { row: MaterialDemandRow; canAct: boolean; canRequest?: boolean; onChanged?: () => void }) {
  const { success, error: notifyError } = useHudToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [site, setSite] = useState(row.sites[0]?.id ?? '');
  const options = strategyOptions(row.requirementType ?? 'MATERIAL', row.coverage.shortage, row.stock);

  const reserve = async (locationId: string, quantity: number) => {
    setBusy(`r:${locationId}`);
    const out = await post('/api/supply/inventory/reservations', { requirementId: row.requirementId, locationId, quantity,
      idempotencyKey: crypto.randomUUID() });
    setBusy(null);
    if (!out.ok) { notifyError('Reserva recusada', out.error); return; }
    success('Reservado', `${formatQty(quantity)} ${row.unit ?? ''} para ${row.project}`);
    onChanged?.();
  };
  const transfer = async (fromLocationId: string, quantity: number) => {
    if (!site) return;
    setBusy(`t:${fromLocationId}`);
    const out = await post('/api/supply/inventory/transfers', { fromLocationId, toLocationId: site,
      lines: [{ itemId: row.itemId, quantity, requirementId: row.requirementId }], idempotencyKey: crypto.randomUUID() });
    setBusy(null);
    if (!out.ok) { notifyError('Transferência recusada', out.error); return; }
    success('Transferência solicitada', String(out.result?.transfer_number ?? ''));
    onChanged?.();
  };

  const requisition = async () => {
    setBusy('buy');
    const out = await post('/api/supply/procurement/requisitions', { source: 'SHORTAGE', requirementIds: [row.requirementId],
      idempotencyKey: crypto.randomUUID() });
    setBusy(null);
    if (!out.ok) { notifyError('Requisição recusada', out.error); return; }
    success('Compra requisitada', String(out.result?.requisition_number ?? ''));
    onChanged?.();
  };

  if (row.coverage.shortage <= 0) {
    return <p className="crm-muted" style={{ padding: '0 14px' }}>Sem falta: nada a decidir para este material.</p>;
  }
  return (
    <section aria-label="Estratégia" data-testid="demand-strategy">
      <p className="crm-eyebrow" style={{ padding: '0 14px' }}>Estratégia recomendada</p>
      {row.sites.length > 1 && canAct && (
        <label className="ops-form" style={{ padding: '6px 14px' }}>Canteiro de destino
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            {row.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <div className="sup-options">
        {options.map((o, i) => (
          <div key={`${o.strategy}:${o.locationId ?? i}`} className="sup-option" data-testid="strategy-option">
            <div>
              <b>{SUPPLY_STRATEGY_LABEL[o.strategy]} · {formatQty(o.quantity)} {row.unit}</b>
              <p className="crm-muted">{o.rationale}</p>
            </div>
            {canAct && o.strategy === 'RESERVE_FROM_STOCK' && o.locationId && (
              <HudButton size="sm" variant="primary" disabled={busy !== null} onClick={() => reserve(o.locationId!, o.quantity)}>
                Reservar</HudButton>
            )}
            {canAct && o.strategy === 'TRANSFER' && o.locationId && (row.sites.length ? (
              <HudButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => transfer(o.locationId!, o.quantity)}>
                Pedir transferência</HudButton>
            ) : (
              <HudButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => reserve(o.locationId!, o.quantity)}>
                Reservar lá</HudButton>
            ))}
            {o.strategy === 'BUY' && (row.coverage.requested >= row.coverage.shortage
              ? <span className="crm-muted">Já requisitado ({formatQty(row.coverage.requested)})</span>
              : canRequest && <HudButton size="sm" variant="secondary" disabled={busy !== null} onClick={requisition}>Requisitar compra</HudButton>)}
          </div>
        ))}
      </div>
      {!canAct && !canRequest && <p className="crm-muted" style={{ padding: '0 14px' }}>Sem alçada para reservar ou transferir este material.</p>}
    </section>
  );
}

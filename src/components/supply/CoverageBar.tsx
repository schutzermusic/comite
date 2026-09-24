'use client';

import type { CoverageSummary } from '@/lib/supply/coverage';
import './supply.css';

const fmt = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * A cobertura em uma régua: consumido, reservado, em trânsito, em pedido — e o
 * fundo vermelho é a falta. Sempre com os números ao lado: cor sozinha não é
 * informação.
 */
export function CoverageBar({ coverage, unit }: { coverage: CoverageSummary; unit: string | null }) {
  const total = Math.max(coverage.required, coverage.covered + coverage.inbound, 1);
  const pct = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="sup-bar" aria-label={`Coberto ${fmt(coverage.covered)} de ${fmt(coverage.required)} ${unit ?? ''}`}>
      <div className="sup-bar-track" aria-hidden>
        <i data-seg="consumed" style={{ width: pct(coverage.consumed) }} />
        <i data-seg="reserved" style={{ width: pct(coverage.reserved) }} />
        <i data-seg="in_transit" style={{ width: pct(coverage.inTransit) }} />
        <i data-seg="on_order" style={{ width: pct(coverage.onOrder) }} />
        <i data-seg="inspection" style={{ width: pct(coverage.inspection) }} />
      </div>
      <div className="sup-bar-legend">
        <span>Req. <b>{fmt(coverage.required)}</b> {unit}</span>
        {coverage.reserved > 0 && <span>Res. <b>{fmt(coverage.reserved)}</b></span>}
        {coverage.consumed > 0 && <span>Cons. <b>{fmt(coverage.consumed)}</b></span>}
        {coverage.inbound > 0 && <span>Entrando <b>{fmt(coverage.inbound)}</b></span>}
        {coverage.inspection > 0 && <span>Em inspeção <b>{fmt(coverage.inspection)}</b></span>}
        {coverage.shortage > 0 && <span className="sup-short">Falta <b className="sup-short">{fmt(coverage.shortage)}</b></span>}
      </div>
    </div>
  );
}

export { fmt as formatQty };

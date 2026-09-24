/**
 * COBERTURA DE MATERIAL — a equação do plano, em código puro.
 *
 *   coberto  = reservado (ativo) + consumido
 *   entrando = em trânsito (transferência) + em pedido (compra aberta)
 *   falta    = requerido − coberto − entrando   (nunca negativa)
 *
 * Estoque físico sozinho NUNCA é disponibilidade: disponível = em mão −
 * reservado (INV-09). Esta função não olha estoque: olha o que foi ALOCADO
 * ao requisito. Um requisito pode ser coberto por várias fontes ao mesmo
 * tempo (INV-07): 40% reserva, 30% transferência, 30% compra.
 */

export interface CoverageFigures {
  required: number;
  reserved: number;
  consumed: number;
  inTransit: number;
  onOrder: number;
  requested: number;
}

export type CoverageStatus = 'COVERED' | 'PARTIAL' | 'INBOUND' | 'SHORT';

export interface CoverageSummary extends CoverageFigures {
  covered: number;
  inbound: number;
  shortage: number;
  /** Fração coberta (0–1), só com o que JÁ está em mãos. */
  coveredRatio: number;
  status: CoverageStatus;
}

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

export function summarizeCoverage(f: Partial<CoverageFigures>): CoverageSummary {
  const required = Math.max(0, n(f.required));
  const reserved = Math.max(0, n(f.reserved));
  const consumed = Math.max(0, n(f.consumed));
  const inTransit = Math.max(0, n(f.inTransit));
  const onOrder = Math.max(0, n(f.onOrder));
  const requested = Math.max(0, n(f.requested));
  const covered = reserved + consumed;
  const inbound = inTransit + onOrder;
  const shortage = Math.max(0, required - covered - inbound);
  const status: CoverageStatus = required > 0 && covered >= required ? 'COVERED'
    : shortage === 0 ? 'INBOUND'
      : covered > 0 || inbound > 0 ? 'PARTIAL' : 'SHORT';
  return { required, reserved, consumed, inTransit, onOrder, requested, covered, inbound, shortage,
    coveredRatio: required > 0 ? Math.min(1, covered / required) : 0, status };
}

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  COVERED: 'Coberto', INBOUND: 'Coberto com entrada', PARTIAL: 'Parcial', SHORT: 'Em falta',
};

/** A linha da visão `supply_requirement_coverage`, tipada. */
export interface CoverageViewRow {
  requirement_id: string; project_id: string; activity_id: string | null; item_id: string | null;
  requirement_type: string; required_by: string | null; unit: string | null;
  required_qty: string | number | null; reserved_qty: string | number; consumed_qty: string | number;
  in_transit_qty: string | number; on_order_qty: string | number; requested_qty: string | number;
}

export function fromViewRow(r: CoverageViewRow): CoverageSummary {
  return summarizeCoverage({ required: n(r.required_qty), reserved: n(r.reserved_qty), consumed: n(r.consumed_qty),
    inTransit: n(r.in_transit_qty), onOrder: n(r.on_order_qty), requested: n(r.requested_qty) });
}

/**
 * RISCO DE SUPPLY de um requisito — perto da data de necessidade, o que ainda
 * falta decide. Crítico: falta a ≤ 7 dias (ou vencido); alto: ≤ 14; médio:
 * falta com mais folga; baixo: sem falta.
 */
export type SupplyRisk = 'critical' | 'high' | 'medium' | 'low';
export function supplyRisk(summary: Pick<CoverageSummary, 'shortage' | 'status'>, daysToNeed: number | null): SupplyRisk {
  if (summary.shortage <= 0) return 'low';
  if (daysToNeed === null) return 'medium';
  if (daysToNeed <= 7) return 'critical';
  if (daysToNeed <= 14) return 'high';
  return 'medium';
}
export const SUPPLY_RISK_LABEL: Record<SupplyRisk, string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' };

/** Estratégias de suprimento — abstração extensível (MAKE fica para quando existir fabricação). */
export type SupplyStrategy = 'RESERVE_FROM_STOCK' | 'TRANSFER' | 'BUY' | 'EXTERNAL_SERVICE';
export const SUPPLY_STRATEGY_LABEL: Record<SupplyStrategy, string> = {
  RESERVE_FROM_STOCK: 'Reservar do estoque', TRANSFER: 'Transferir de outro local', BUY: 'Comprar', EXTERNAL_SERVICE: 'Contratar serviço',
};

export interface StockAtLocation { locationId: string; locationName: string; available: number; isDestination: boolean }

/**
 * Opções para cobrir a FALTA, na ordem que menos custa ao projeto: estoque
 * no próprio local, depois transferência de outro local, depois compra. Cada
 * opção diz quanto cobre e por quê — a recomendação é explicável, e agir é
 * outro ato (reservar, transferir e requisitar são funções governadas).
 */
export function strategyOptions(
  requirementType: string, shortage: number, stock: StockAtLocation[],
): Array<{ strategy: SupplyStrategy; quantity: number; locationId?: string; rationale: string }> {
  if (shortage <= 0) return [];
  if (requirementType === 'EXTERNAL_SERVICE') {
    return [{ strategy: 'EXTERNAL_SERVICE', quantity: shortage, rationale: 'Serviço externo é contratado, não estocado.' }];
  }
  const out: Array<{ strategy: SupplyStrategy; quantity: number; locationId?: string; rationale: string }> = [];
  let remaining = shortage;
  for (const s of stock.filter((x) => x.isDestination && x.available > 0)) {
    const q = Math.min(remaining, s.available);
    out.push({ strategy: 'RESERVE_FROM_STOCK', quantity: q, locationId: s.locationId,
      rationale: `${q} disponível(is) em ${s.locationName}, no local de entrega — reservar evita compra e frete.` });
    remaining -= q;
    if (remaining <= 0) return out;
  }
  for (const s of stock.filter((x) => !x.isDestination && x.available > 0).sort((a, b) => b.available - a.available)) {
    const q = Math.min(remaining, s.available);
    out.push({ strategy: 'TRANSFER', quantity: q, locationId: s.locationId,
      rationale: `${q} disponível(is) em ${s.locationName} — transferir evita comprar o que a empresa já tem.` });
    remaining -= q;
    if (remaining <= 0) return out;
  }
  out.push({ strategy: 'BUY', quantity: remaining,
    rationale: stock.length ? `Estoque disponível não cobre ${remaining}: comprar o restante.` : 'Sem estoque disponível do item: comprar.' });
  return out;
}

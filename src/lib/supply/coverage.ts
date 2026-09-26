/**
 * COBERTURA DE MATERIAL — a equação do plano, em código puro.
 *
 *   coberto  = reservado (ativo) + consumido
 *   entrando = em trânsito (transferência) + em pedido (compra aberta) + em inspeção
 *   falta    = requerido − coberto − entrando   (nunca negativa)
 *
 * Em inspeção (235) é o recebido na quarentena para o requisito: não é
 * reservável, mas já chegou — conta como entrando, não como falta.
 *
 * REGRA 246 (docs/operations-supply/COVERAGE-SEMANTICS.md) — a mesma para
 * estoque e compras:
 *
 *   pendente  = transferências PEDIDAS/APROVADAS sem reserva na origem
 *               (`pending_transfer_qty`): NÃO é cobertura — a falta e o risco
 *               continuam — mas também não é comprada de novo;
 *   comprável = GREATEST(falta − requisitado − pendente, 0) (`purchasable_qty`):
 *               o que `purchase_requisition_from_shortage` requisita AGORA.
 *
 * Os dois números vêm da visão (a regra é do banco). Sem as colunas (a 246
 * ainda não aplicada), pendente = 0 e comprável = falta − requisitado — a
 * conta que o banco anterior faz.
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
  /** Recebido em quarentena para o requisito, aguardando inspeção. */
  inspection: number;
  /**
   * 246 — PENDENTE: transferências pedidas/aprovadas sem reserva na origem
   * (`pending_transfer_qty`). Não é cobertura (a falta continua), mas não é
   * comprada de novo sem exceção governada.
   */
  pendingTransfer: number;
}

export type CoverageStatus = 'COVERED' | 'PARTIAL' | 'INBOUND' | 'SHORT';

export interface CoverageSummary extends CoverageFigures {
  covered: number;
  inbound: number;
  /** A falta BRUTA (`shortage_qty`): o pendente não a reduz. */
  shortage: number;
  /** 246 — o que o banco requisita AGORA: GREATEST(falta − requisitado − pendente, 0) (`purchasable_qty`). */
  purchasable: number;
  /** Fração coberta (0–1), só com o que JÁ está em mãos. */
  coveredRatio: number;
  status: CoverageStatus;
}

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
/** Número presente na linha (a coluna existe e veio preenchida); `null` = ausente. */
const present = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * A equação a partir dos números alocados. `purchasable`, quando vem da visão
 * (`purchasable_qty`), é o número do banco; sem ele, a mesma fórmula da visão.
 */
export function summarizeCoverage(f: Partial<CoverageFigures> & { purchasable?: number | null }): CoverageSummary {
  const required = Math.max(0, n(f.required));
  const reserved = Math.max(0, n(f.reserved));
  const consumed = Math.max(0, n(f.consumed));
  const inTransit = Math.max(0, n(f.inTransit));
  const onOrder = Math.max(0, n(f.onOrder));
  const requested = Math.max(0, n(f.requested));
  const inspection = Math.max(0, n(f.inspection));
  const pendingTransfer = Math.max(0, n(f.pendingTransfer));
  const covered = reserved + consumed;
  const inbound = inTransit + onOrder + inspection;
  const shortage = Math.max(0, required - covered - inbound);
  const fromDomain = present(f.purchasable);
  const purchasable = fromDomain !== null ? Math.max(0, fromDomain) : Math.max(0, shortage - requested - pendingTransfer);
  const status: CoverageStatus = required > 0 && covered >= required ? 'COVERED'
    : shortage === 0 ? 'INBOUND'
      : covered > 0 || inbound > 0 ? 'PARTIAL' : 'SHORT';
  return { required, reserved, consumed, inTransit, onOrder, requested, inspection, pendingTransfer, covered, inbound, shortage,
    purchasable, coveredRatio: required > 0 ? Math.min(1, covered / required) : 0, status };
}

/**
 * A parte da transferência PENDENTE que também está requisitada — só a
 * exceção de cobertura (246) chega aqui (ou dado legado anterior à guarda
 * simétrica): se a transferência também for despachada, o material chega em
 * dobro. 0 quando a requisição não passa por cima do pendente.
 */
export function pendingOverlap(c: { shortage: number; requested: number; pendingTransfer: number }): number {
  const pending = Math.max(0, n(c.pendingTransfer));
  return Math.min(pending, Math.max(0, n(c.requested) + pending - Math.max(0, n(c.shortage))));
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
  inspection_qty?: string | number | null;
  /** 246 (anexada ao fim da visão). Ausente = a visão ainda não tem a coluna: pendente 0. */
  pending_transfer_qty?: string | number | null;
  /** 246 (anexada ao fim da visão). Ausente = GREATEST(falta − requisitado, 0), a conta do banco anterior. */
  purchasable_qty?: string | number | null;
}

/** As colunas da visão que a regra (`fromViewRow`) usa — as de antes da 246. */
export const COVERAGE_VIEW_BASE_COLUMNS = 'requirement_id,project_id,activity_id,item_id,requirement_type,required_by,unit,required_qty,'
  + 'reserved_qty,consumed_qty,in_transit_qty,on_order_qty,requested_qty,inspection_qty';
/** As mesmas + as duas ANEXADAS pela 246 (`pending_transfer_qty`, `purchasable_qty`). */
export const COVERAGE_VIEW_COLUMNS = `${COVERAGE_VIEW_BASE_COLUMNS},pending_transfer_qty,purchasable_qty`;

/**
 * A visão ainda sem as colunas da 246 (migração não aplicada): o PostgREST
 * recusa o `select` com 42703 "column … does not exist". Só ESSA recusa
 * cai para as colunas anteriores; qualquer outro erro continua erro.
 */
export function isMissingCoverage246Column(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return /pending_transfer_qty|purchasable_qty/.test(message) && (error.code === '42703' || /does not exist|could not find/i.test(message));
}

/** Por quanto tempo, depois de a visão recusar as colunas da 246, a leitura vai direto às anteriores. */
export const COVERAGE_246_RETRY_MS = 60_000;
let coverage246MissingUntil = 0;

/**
 * Uma leitura da cobertura com as colunas da 246 — e, se a visão ainda não as
 * tem, a MESMA leitura com as anteriores (lembrado por `COVERAGE_246_RETRY_MS`
 * para não pagar duas idas por leitura). `fromViewRow` trata a ausência: a
 * conta do banco anterior. Nunca esconde outro erro.
 */
export async function withCoverage246Columns<R extends { error: { code?: string | null; message?: string | null } | null }>(
  run: (columns: string) => PromiseLike<R>, now: () => number = Date.now,
): Promise<R> {
  if (now() < coverage246MissingUntil) return run(COVERAGE_VIEW_BASE_COLUMNS);
  const res = await run(COVERAGE_VIEW_COLUMNS);
  if (!isMissingCoverage246Column(res.error)) return res;
  coverage246MissingUntil = now() + COVERAGE_246_RETRY_MS;
  return run(COVERAGE_VIEW_BASE_COLUMNS);
}

/** Esquece que a visão estava sem as colunas da 246 (testes; e depois de aplicar a migração). */
export function resetCoverage246Fallback(): void {
  coverage246MissingUntil = 0;
}

export function fromViewRow(r: CoverageViewRow): CoverageSummary {
  return summarizeCoverage({ required: n(r.required_qty), reserved: n(r.reserved_qty), consumed: n(r.consumed_qty),
    inTransit: n(r.in_transit_qty), onOrder: n(r.on_order_qty), requested: n(r.requested_qty), inspection: n(r.inspection_qty),
    pendingTransfer: n(r.pending_transfer_qty), purchasable: present(r.purchasable_qty) });
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

/**
 * Saldo LIVRE do item num local. `available` já desconta o que transferências
 * PEDIDAS/APROVADAS (sem reserva na origem) prometeram sair dali (`promised`):
 * o banco não segura esse saldo, mas sugerir de novo seria prometê-lo duas vezes.
 */
export interface StockAtLocation { locationId: string; locationName: string; available: number; isDestination: boolean; promised?: number }

export type StrategyOption = { strategy: SupplyStrategy; quantity: number; locationId?: string; rationale: string };

/** O que cobrir: a falta (número — quem chama já decidiu) ou a cobertura viva (a regra 246 do banco). */
export type StrategyCover = number | Pick<CoverageSummary, 'shortage'> & Partial<Pick<CoverageSummary, 'pendingTransfer' | 'requested'>>;

/**
 * Opções para cobrir a FALTA, na ordem que menos custa ao projeto: estoque
 * no próprio local, depois transferência de outro local, depois compra. Cada
 * opção diz quanto cobre e por quê — a recomendação é explicável, e agir é
 * outro ato (reservar, transferir e requisitar são funções governadas).
 *
 * Com a COBERTURA (regra 246):
 *  • a divisão é sobre `falta − pendente` — o que transferências já pedidas
 *    vão trazer não é sugerido de novo, nem comprado;
 *  • reservar/transferir só cabe no que o banco aceita: ele recusa cobrir por
 *    cima de solicitação aberta (`supply_requirement_claimed` = comprometido +
 *    requisitado), então o estoque cobre no máximo `falta − pendente − requisitado`;
 *  • COMPRAR = o resto, a mesma semântica de `purchasable_qty`: dele, o que já
 *    está requisitado está pedido; o que sobra é o que o banco requisita.
 * Com um NÚMERO, a divisão é sobre ele, sem descontos (quem chama decidiu).
 */
export function strategyOptions(requirementType: string, cover: StrategyCover, stock: StockAtLocation[]): StrategyOption[] {
  const figures = typeof cover === 'number' ? { shortage: cover, pendingTransfer: 0, requested: 0 } : cover;
  const total = Math.max(0, n(figures.shortage) - Math.max(0, n(figures.pendingTransfer)));
  if (total <= 0) return [];
  if (requirementType === 'EXTERNAL_SERVICE') {
    return [{ strategy: 'EXTERNAL_SERVICE', quantity: total, rationale: 'Serviço externo é contratado, não estocado.' }];
  }
  const requested = Math.max(0, n(figures.requested));
  /** O que o banco deixa reservar/transferir: sem cobrir por cima do já requisitado. */
  let room = Math.max(0, total - requested);
  const out: StrategyOption[] = [];
  let remaining = total;
  const take = (s: StockAtLocation, strategy: 'RESERVE_FROM_STOCK' | 'TRANSFER') => {
    const q = Math.min(room, s.available);
    if (q <= 0) return;
    out.push({ strategy, quantity: q, locationId: s.locationId,
      rationale: strategy === 'RESERVE_FROM_STOCK'
        ? `${q} disponível(is) em ${s.locationName} — reservar agora evita compra e segura o saldo para o projeto.`
        : `${q} disponível(is) em ${s.locationName} — transferir evita comprar o que a empresa já tem.` });
    room -= q;
    remaining -= q;
  };
  for (const s of stock.filter((x) => x.isDestination && x.available > 0)) {
    take(s, 'RESERVE_FROM_STOCK');
    if (remaining <= 0) return out;
  }
  for (const s of stock.filter((x) => !x.isDestination && x.available > 0).sort((a, b) => b.available - a.available)) {
    take(s, 'TRANSFER');
    if (remaining <= 0) return out;
  }
  // Sobrou estoque livre que só não entrou porque a solicitação aberta já cobre: dito, com o caminho.
  const used = total - remaining;
  const leftover = stock.reduce((acc, s) => acc + Math.max(0, s.available), 0) - used;
  out.push({ strategy: 'BUY', quantity: remaining,
    rationale: requested > 0 && room <= 0 && leftover > 0
      ? `${requested} já requisitado(s): o banco não reserva nem transfere por cima de solicitação aberta — para usar o estoque, cancele antes a solicitação.`
      : stock.length ? `Estoque disponível não cobre ${remaining}: comprar o restante.` : 'Sem estoque disponível do item: comprar.' });
  return out;
}

/** Prioridade do requisito (vocabulário do Planejamento, 231). */
export const REQUIREMENT_PRIORITY_LABEL: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

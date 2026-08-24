/**
 * Obligations Control Tower — as obrigações da carteira em cinco faixas.
 *
 * Lógica pura, sem JSX. As faixas saem do estado registrado na linha e da data
 * de vencimento; nenhuma delas é inferida por heurística de texto ou por
 * probabilidade.
 *
 * "Em risco" é a única faixa DERIVADA, e é derivada de um fato verificável:
 * a obrigação está aberta, o prazo ainda não venceu, e não há evidência
 * registrada. Não é previsão — é a constatação de que falta o insumo que o
 * aceite vai exigir.
 */

import { hasOfficialValue, isError, type Official } from './trusted';
import type { TrustedContract } from './read-model';
import type { ContractObligationRow } from '../contract-service';

export type ObligationBucket = 'overdue' | 'dueSoon' | 'atRisk' | 'onTrack' | 'completed';

export const OBLIGATION_BUCKET_LABEL: Record<ObligationBucket, string> = {
  overdue: 'Em atraso',
  dueSoon: 'Vence em breve',
  atRisk: 'Em risco',
  onTrack: 'No prazo',
  completed: 'Concluídas',
};

export type ObligationEntry = {
  readonly id: string;
  readonly bucket: ObligationBucket;
  readonly title: string;
  /** Responsável registrado na linha; `null` quando ninguém foi designado. */
  readonly ownerUserId: string | null;
  readonly dueDate: Date | null;
  /** Dias para o prazo (negativo = atrasada). `null` sem prazo registrado. */
  readonly daysToDue: number | null;
  /** Evidência esperada/registrada; `null` quando o campo está vazio. */
  readonly evidence: string | null;
  readonly hasEvidence: boolean;
  /** Contexto do contrato — a obrigação nunca aparece órfã. */
  readonly contractId: string;
  readonly contractCode: string;
  readonly contractTitle: string;
  readonly counterparty: string | null;
  readonly rank: number;
};

export type ObligationsTower = {
  readonly entries: readonly ObligationEntry[];
  readonly counts: Record<ObligationBucket, number>;
  /** Contratos cuja leitura de obrigações falhou. */
  readonly erroredContracts: readonly string[];
  /** Contratos sem NENHUMA obrigação mapeada — lacuna de controle, não saúde. */
  readonly unmappedContracts: readonly string[];
  /** Quantos contratos entraram na apuração e quantos existiam. */
  readonly coverage: { readonly counted: number; readonly total: number };
};

const DAY = 86_400_000;
const DUE_SOON_DAYS = 15;

const BUCKET_RANK: Record<ObligationBucket, number> = {
  overdue: 0, dueSoon: 1, atRisk: 2, onTrack: 3, completed: 4,
};

function daysTo(due: string | null, now: Date): number | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / DAY);
}

/**
 * A faixa de uma obrigação.
 *
 * `done` vence qualquer outra consideração: uma obrigação concluída fora do
 * prazo já foi tratada, e mantê-la em "atraso" faria a torre nunca esvaziar.
 */
export function bucketOf(
  obligation: ContractObligationRow,
  now: Date = new Date(),
): ObligationBucket {
  if (obligation.status === 'done') return 'completed';

  const days = daysTo(obligation.due_date, now);
  if (obligation.status === 'overdue') return 'overdue';
  if (days !== null && days < 0) return 'overdue';

  const hasEvidence = Boolean(obligation.evidence?.trim());
  if (days !== null && days <= DUE_SOON_DAYS) return 'dueSoon';
  // Aberta, com folga de prazo, e sem o insumo que o aceite vai exigir.
  if (!hasEvidence) return 'atRisk';
  return 'onTrack';
}

export function buildObligationsTower(
  contracts: readonly TrustedContract[],
  now: Date = new Date(),
): ObligationsTower {
  const entries: ObligationEntry[] = [];
  const errored: string[] = [];
  const unmapped: string[] = [];
  let counted = 0;

  for (const contract of contracts) {
    if (isError(contract.obligations)) { errored.push(contract.code); continue; }
    if (!hasOfficialValue(contract.obligations)) continue;
    counted += 1;

    const rows = contract.obligations.value;
    if (rows.length === 0) { unmapped.push(contract.code); continue; }

    const counterparty: string | null = hasOfficialValue(contract.counterparty)
      ? contract.counterparty.value
      : null;

    for (const row of rows) {
      const bucket = bucketOf(row, now);
      const days = daysTo(row.due_date, now);
      entries.push({
        id: row.id,
        bucket,
        title: row.title,
        ownerUserId: row.owner_user_id,
        dueDate: row.due_date ? new Date(row.due_date) : null,
        daysToDue: days,
        evidence: row.evidence?.trim() ? row.evidence.trim() : null,
        hasEvidence: Boolean(row.evidence?.trim()),
        contractId: contract.id,
        contractCode: contract.code,
        contractTitle: contract.title,
        counterparty,
        // Mais atrasada primeiro dentro da faixa; sem prazo vai para o fim.
        rank: days === null ? Number.MAX_SAFE_INTEGER : days,
      });
    }
  }

  entries.sort((a, b) => BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || a.rank - b.rank);

  const counts: Record<ObligationBucket, number> = {
    overdue: 0, dueSoon: 0, atRisk: 0, onTrack: 0, completed: 0,
  };
  for (const entry of entries) counts[entry.bucket] += 1;

  return {
    entries,
    counts,
    erroredContracts: errored,
    unmappedContracts: unmapped,
    coverage: { counted, total: contracts.length },
  };
}

/**
 * Responsáveis com carga de obrigações não concluídas.
 *
 * Devolve apenas o id — resolver nome é responsabilidade de quem tem o cadastro
 * de pessoas, e Contratos não mantém cópia disso.
 */
export function obligationOwners(
  tower: ObligationsTower,
): readonly { ownerUserId: string | null; open: number; overdue: number }[] {
  const map = new Map<string, { ownerUserId: string | null; open: number; overdue: number }>();
  for (const entry of tower.entries) {
    if (entry.bucket === 'completed') continue;
    const key = entry.ownerUserId ?? '__unassigned__';
    const current = map.get(key) ?? { ownerUserId: entry.ownerUserId, open: 0, overdue: 0 };
    current.open += 1;
    if (entry.bucket === 'overdue') current.overdue += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

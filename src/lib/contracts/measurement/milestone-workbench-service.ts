/**
 * BANCADA DO MARCO — a borda tipada de `contract_milestone_workbench`.
 *
 * Não recalcula nada e não escreve nada. A composição mora na visão (migration
 * 171), a derivação de estágio mora em `milestone-stage.ts`, e este arquivo só
 * traz linhas e normaliza tipos.
 *
 * Uma consulta, um instante. A alternativa — a tela buscar marcos, regras,
 * mapeamentos, medições e eventos em cinco chamadas — produziria cinco
 * instantes diferentes do mesmo contrato numa tela só.
 */
import { createClient } from '@/utils/supabase/client';
import {
  toWorkbenchRow,
  type MilestoneWorkbenchRawRow, type MilestoneWorkbenchRow,
} from './milestone-workbench-types';

const VIEW = 'contract_milestone_workbench';

export class MilestoneWorkbenchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MilestoneWorkbenchError';
  }
}

/**
 * Os marcos de um contrato, com direito, exigência, cronograma, medição e
 * faturamento resolvidos.
 *
 * A ordenação é por prazo e depois por título: sem `due_date` — que é o caso de
 * todo contrato cujo cronograma ainda não existe — a ordem alfabética do título
 * preserva a numeração dos eventos ("Evento 01…06"), que é a ordem contratual.
 */
export async function listMilestoneWorkbench(
  contractId: string,
): Promise<MilestoneWorkbenchRow[]> {
  const { data, error } = await createClient()
    .from(VIEW)
    .select('*')
    .eq('contract_id', contractId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('title', { ascending: true });

  if (error) {
    throw new MilestoneWorkbenchError(
      // A visão pode não existir num ambiente que ainda não aplicou a 171.
      // Dizer isso é melhor que uma lista vazia, que se lê como "sem marcos".
      error.message.includes('does not exist')
        ? 'A bancada de marcos não está disponível neste ambiente (migration 171 não aplicada).'
        : error.message,
    );
  }
  return ((data ?? []) as MilestoneWorkbenchRawRow[]).map(toWorkbenchRow);
}

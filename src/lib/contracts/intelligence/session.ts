/**
 * A decisão humana sobre uma interpretação contratual.
 *
 * Três decisões, e a diferença entre elas é o ponto:
 *
 *   · `acknowledge` — "eu vi; segue operando". Baixa a atenção sem transformar
 *     a leitura da máquina em afirmação de uma pessoa. É o degrau que faltava
 *     no modelo antigo, onde olhar um item era a mesma coisa que assinar
 *     embaixo dele.
 *   · `confirm` — a pessoa CONFIRMA a interpretação e responde por ela.
 *   · `dismiss` — a pessoa descarta a interpretação. Exige justificativa. O
 *     texto do contrato não muda: o Apex nunca reescreve verdade assinada.
 *
 * O carimbo vem de `auth.uid()` dentro da função da migration 157; não há
 * parâmetro para dizer de quem foi a decisão.
 */
import { createClient } from '@/utils/supabase/server';
import type { ContractClauseRow } from '@/lib/contracts/contract-service';

export type InterpretationDecision = 'confirm' | 'dismiss' | 'acknowledge';

export async function resolveClauseAttention(
  clauseId: string,
  decision: InterpretationDecision,
  note?: string | null,
): Promise<ContractClauseRow> {
  if (decision === 'dismiss' && !note?.trim()) {
    throw new Error('Descartar uma interpretação exige justificativa.');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('contract_clause_resolve_attention', {
    p_clause_id: clauseId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(`Erro ao registrar a decisão: ${error.message}`);
  return data as ContractClauseRow;
}

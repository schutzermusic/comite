/**
 * A decisão humana sobre uma interpretação contratual.
 *
 * ─── Cláusulas (migration 154/157) ─────────────────────────────────────────
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
 * ─── Interpretações operacionais (migration 188) ───────────────────────────
 *
 * Duas decisões — a fila de trabalho, não o acervo de texto:
 *
 *   · `confirm` (Aceitar) — promove a `automatic` e materializa o fato
 *     operacional. O Apex passa a operar por aquela regra.
 *   · `dismiss` (Descartar) — encerra a retenção sem materializar. Exige nota.
 *
 * O carimbo vem de `auth.uid()` dentro da RPC; não há parâmetro para dizer de
 * quem foi a decisão.
 */
import { createClient } from '@/utils/supabase/server';
import type { ContractClauseRow } from '@/lib/contracts/contract-service';
import type { ContractOperationalInterpretationRow } from '@/lib/contracts/intelligence/operational-interpretations';
import {
  materializeOperationalInterpretation,
  type MaterializeResult,
} from '@/lib/contracts/intelligence/materialize-operational-interpretation';

export type InterpretationDecision = 'confirm' | 'dismiss' | 'acknowledge';
export type OperationalInterpretationDecision = 'confirm' | 'dismiss';

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

export type ResolveOperationalInterpretationResult = {
  readonly interpretation: ContractOperationalInterpretationRow;
  readonly materialization: MaterializeResult | null;
};

/**
 * Aceita ou descarta uma interpretação operacional retida.
 *
 * Em `confirm`, a RPC promove o estado e em seguida o fato é materializado
 * (service role). Em `dismiss`, só a RPC — nada canônico é escrito.
 */
export async function resolveOperationalInterpretation(
  interpretationId: string,
  decision: OperationalInterpretationDecision,
  note?: string | null,
  options: { actorUserId?: string | null; documentTitle?: string | null } = {},
): Promise<ResolveOperationalInterpretationResult> {
  if (decision === 'dismiss' && !note?.trim()) {
    throw new Error('Descartar uma interpretação exige justificativa.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'contract_operational_interpretation_resolve',
    {
      p_interpretation_id: interpretationId,
      p_decision: decision,
      p_note: note?.trim() || null,
    },
  );
  if (error) throw new Error(`Erro ao registrar a decisão: ${error.message}`);

  const interpretation = data as ContractOperationalInterpretationRow;

  if (decision !== 'confirm') {
    return { interpretation, materialization: null };
  }

  const materialization = await materializeOperationalInterpretation(interpretation, {
    actorUserId: options.actorUserId ?? null,
    documentTitle: options.documentTitle ?? null,
  });

  return { interpretation, materialization };
}

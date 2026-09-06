/**
 * Caminho rápido: `after()` como DESPERTADOR, nunca como garantia.
 *
 * ─── O que ele é ───────────────────────────────────────────────────────────
 *
 * Depois que o pedido já COMETEU o trabalho durável e já respondeu, `after()`
 * dá uma batida curta na fila. O efeito é de latência: em vez de esperar até
 * dez minutos pela próxima execução do agendador, o trabalho recém-enfileirado
 * costuma rodar em segundos.
 *
 * ─── O que ele NÃO é ───────────────────────────────────────────────────────
 *
 * Não é a correção do sistema. Se ele nunca rodar — função reciclada, resposta
 * abortada, hospedagem que não honra a promessa — nada se perde: o trabalho
 * continua PENDING e o agendador o pega. Nenhum caminho deste repositório
 * depende de `after()` ter rodado.
 *
 * Por isso a falha é engolida e registrada, e não propagada: propagá-la
 * transformaria um otimizador de latência em mais uma forma de o pedido do
 * usuário falhar, depois de o trabalho já estar seguro.
 */
import { after } from 'next/server';
import { drainOnce, type DrainLimits } from './worker';

/** Lote pequeno e orçamento curto: isto acontece DEPOIS da resposta. */
const FAST_PATH_LIMITS: DrainLimits = {
  maxRouteBatch: 25,
  maxJobs: 3,
  leaseSeconds: 300,
  timeBudgetMs: 20_000,
  reapBatch: 25,
};

export function scheduleFastDrain(tag: string): void {
  after(async () => {
    try {
      const counters = await drainOnce(FAST_PATH_LIMITS, `apex-after-${tag}`);
      console.info('[apex-fast-path]', { tag, ...counters });
    } catch (error) {
      // O trabalho já está durável. Isto é otimização perdida, não trabalho
      // perdido — e a diferença precisa aparecer no log com esse nome.
      console.warn('[apex-fast-path] batida best-effort falhou', {
        tag, message: error instanceof Error ? error.message : 'erro inesperado',
      });
    }
  });
}

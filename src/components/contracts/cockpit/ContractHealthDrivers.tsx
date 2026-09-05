'use client';

/**
 * COBERTURA DO CONTRATO — as seis dimensões apuradas, SEM pontuação.
 *
 * O rótulo mudou de "Saúde do contrato" para "Cobertura do contrato" porque
 * "Saúde 5/6" era lido como uma NOTA: cinco de seis pontos de saúde, um
 * contrato quase são. O que o número sempre disse é outra coisa — quantas
 * dimensões têm dado suficiente para serem avaliadas. Um contrato com 6/6 de
 * cobertura pode estar em péssimo estado; um com 2/6 pode estar impecável e
 * apenas mal cadastrado. Chamar cobertura de saúde inverte a conclusão.
 *
 * Saúde de verdade — que pondera obrigações, finanças e risco — pertence a uma
 * fase em que essas três coisas estejam operacionalmente maduras. Até lá, a
 * interface diz o que mede.
 *
 * A MD §13 pede um score de 0 a 100. Este componente deliberadamente não o
 * emite: não existe modelo de pontuação aprovado para contratos neste
 * repositório. O único precedente determinístico — `computeHealthScore` em
 * src/lib/utils/project-utils.ts — é de PROJETOS, e seus pesos foram calibrados
 * sobre EAC/BAC e tarefas, que não têm equivalente contratual.
 *
 * Um número de 0 a 100 inventado aqui seria pior do que a ausência dele: viraria
 * base de decisão executiva, com a autoridade que só um número redondo tem, sem
 * nada por trás. Os pesos são decisão de negócio.
 *
 * O que se mostra no lugar já responde a pergunta útil — "o que está pesando
 * contra este contrato?" — e cada linha é rastreável até a tabela de origem.
 */

import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';
import type { ContractHealth, HealthDriver } from '@/lib/contracts/trust/signals';

const DIMENSION_ORDER: HealthDriver['dimension'][] = [
  'financeiro', 'obrigacoes', 'documentos', 'aprovacoes', 'vinculos', 'vigencia',
];

const DIMENSION_LABEL: Record<HealthDriver['dimension'], string> = {
  financeiro: 'Financeiro',
  obrigacoes: 'Obrigações',
  documentos: 'Documentos',
  aprovacoes: 'Aprovações',
  vinculos: 'Projeto',
  vigencia: 'Vigência',
};

export interface ContractHealthDriversProps {
  health: ContractHealth;
  className?: string;
  /** Modo compacto para o Quick Dossier. */
  compact?: boolean;
}

export function ContractHealthDrivers({ health, className, compact = false }: ContractHealthDriversProps) {
  const byDimension = new Map(health.drivers.map((d) => [d.dimension, d]));
  const adverse = health.drivers.filter((d) => d.adverse).length;
  const { assessed, total } = health.coverage;

  return (
    <section className={cn('relative', className)} aria-label="Cobertura do contrato por dimensão">
      <header className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-ig-label text-ig-fg-muted">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Cobertura do contrato
        </p>
        <p className="shrink-0 text-ig-caption text-ig-fg-muted">
          <span className="ig-tabular font-semibold text-ig-fg-strong">{assessed} de {total}</span> dimensões apuradas
        </p>
      </header>

      {/* Faixa de cobertura: mostra quanto da avaliação foi possível. */}
      <div className="mt-2 flex gap-1" role="img" aria-label={`${assessed} de ${total} dimensões apuradas`}>
        {DIMENSION_ORDER.map((dim) => {
          const driver = byDimension.get(dim);
          return (
            <span
              key={dim}
              className={cn(
                'h-1 flex-1 rounded-full',
                !driver
                  ? 'bg-ig-border-subtle'
                  : driver.adverse
                    ? 'bg-ig-warning'
                    : 'bg-ig-success',
              )}
            />
          );
        })}
      </div>

      <ul className={cn('mt-3', compact ? 'space-y-1' : 'space-y-1.5')}>
        {DIMENSION_ORDER.map((dim) => {
          const driver = byDimension.get(dim);
          return (
            <li
              key={dim}
              className="flex items-baseline gap-3 border-b border-ig-border-subtle/60 pb-1.5 last:border-0 last:pb-0"
              title={driver ? `${driver.detail} · fonte: ${driver.from.join(', ')}` : 'Dimensão não apurada'}
            >
              <span className="w-[86px] shrink-0 text-ig-body-sm text-ig-fg-muted">
                {DIMENSION_LABEL[dim]}
              </span>
              {!driver ? (
                /* Ausência é NEUTRA (§19): não apurado não é irregularidade. */
                <span className="text-ig-body-sm text-ig-fg-subtle">Não apurado</span>
              ) : (
                <>
                  <span
                    className={cn(
                      'shrink-0 text-ig-body-sm font-semibold',
                      driver.adverse ? 'text-ig-warning' : 'text-ig-success',
                    )}
                  >
                    {driver.adverse ? 'Atenção' : 'Apurado'}
                  </span>
                  {!compact && (
                    <span className="min-w-0 flex-1 truncate text-right text-ig-caption text-ig-fg-muted">
                      {driver.detail}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        O `title` guarda a justificativa longa; a frase curta que fica visível
        já impede a leitura errada — que esta seção mediria desempenho, e não
        cobertura de dado.
      */}
      <p
        className="mt-2.5 text-ig-caption text-ig-fg-subtle"
        title="Um score exigiria pesos definidos pela área de negócio; nenhum foi definido, e inventá-los aqui produziria um número sem dono."
      >
        {adverse === 0
          ? 'Nenhuma dimensão apurada está em atenção.'
          : `${adverse} dimensão(ões) em atenção.`}
        {' '}Sem índice numérico: mede-se cobertura de dado, não desempenho.
      </p>
    </section>
  );
}

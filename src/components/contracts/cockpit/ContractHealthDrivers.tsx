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
 *
 * ─── O desenho ─────────────────────────────────────────────────────────────
 *
 * O medidor tem um segmento POR DIMENSÃO, na ordem das linhas abaixo dele, e o
 * segmento não apurado fica VAZIO com contorno — cinza chapado seria lido como
 * "mediram e deu zero", que é exatamente a conclusão que este painel existe
 * para impedir. Apurado é teal; âmbar só onde alguém precisa agir.
 */

import { cn } from '@/lib/utils';
import { Radar } from 'lucide-react';
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
    <section className={cn('ig-lp', className)} aria-label="Cobertura do contrato por dimensão">
      <header className="ig-lp-head flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className="ig-lp-mark" aria-hidden>
          <Radar className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-ig-body-sm font-semibold text-ig-fg-strong">
            Cobertura do contrato
          </h3>
          <p className="mt-0.5 text-ig-caption leading-relaxed text-ig-fg-muted">
            Cobertura de dados · não mede desempenho contratual.
          </p>
        </div>
      </header>

      {/* ── A métrica e o medidor ────────────────────────────────────────
          O número tem porte de métrica e o medidor fica logo abaixo, com um
          segmento por dimensão na MESMA ordem das linhas — é o que permite
          ler "qual" e não só "quantas". */}
      <div className="ig-lp-rule px-4 py-3 sm:px-5">
        <div className="flex items-end justify-between gap-3">
          <p className="flex items-baseline gap-1.5">
            <span className="ig-tabular text-ig-h2 font-semibold leading-none text-ig-fg-strong">
              {assessed}
            </span>
            <span className="ig-tabular text-ig-body-sm text-ig-fg-muted">de {total}</span>
            <span className="text-ig-caption text-ig-fg-muted">dimensões apuradas</span>
          </p>
          {adverse > 0 && (
            <span className="ig-lp-tag shrink-0 text-ig-label font-semibold" data-tone="warning">
              {adverse} em atenção
            </span>
          )}
        </div>

        {/*
          O medidor mede COBERTURA, e só. Pintar de âmbar a dimensão apurada
          que está em atenção fazia um contrato 6/6 — cobertura completa —
          aparecer como quatro sextos de barra em alerta, que é exatamente a
          leitura de DESEMPENHO que o painel inteiro existe para negar. A
          atenção tem lugar próprio: a etiqueta acima e o trilho de cada linha.

          Segmento apurado é teal cheio; não apurado é o contorno VAZIO —
          cinza chapado leria como "mediram e deu zero".
        */}
        <div
          className="ig-lp-meter mt-2.5"
          role="img"
          aria-label={`${assessed} de ${total} dimensões apuradas`}
        >
          {DIMENSION_ORDER.map((dim) => (
            <i key={dim} data-on={byDimension.has(dim) ? 'assessed' : undefined} />
          ))}
        </div>
      </div>

      <ul className={cn('px-1.5', compact ? 'py-1' : 'py-1.5')}>
        {DIMENSION_ORDER.map((dim) => {
          const driver = byDimension.get(dim);
          const tone = !driver ? 'idle' : driver.adverse ? 'warning' : 'success';
          return (
            <li
              key={dim}
              className="ig-lp-row"
              data-tone={driver?.adverse ? 'warning' : undefined}
              title={driver ? `${driver.detail} · fonte: ${driver.from.join(', ')}` : 'Dimensão não apurada'}
            >
              <div className={cn(
                'flex items-center gap-3 rounded-[9px] px-3',
                compact ? 'py-1.5' : 'py-2',
              )}>
                <span className="w-[92px] shrink-0 text-ig-body-sm font-medium text-ig-fg-strong">
                  {DIMENSION_LABEL[dim]}
                </span>

                {/* Ausência é NEUTRA (§19): não apurado não é irregularidade. */}
                <span className="ig-lp-state w-[88px] text-ig-caption font-semibold" data-tone={tone}>
                  <i aria-hidden />
                  {!driver ? 'Não apurado' : driver.adverse ? 'Atenção' : 'Apurado'}
                </span>

                {!compact && (
                  <span className="min-w-0 flex-1 text-right text-ig-caption text-ig-fg-default">
                    {driver ? driver.detail : 'Sem dado registrado para avaliar'}
                  </span>
                )}
              </div>
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
        className="border-t border-ig-border-subtle px-4 py-2.5 text-ig-caption leading-relaxed text-ig-fg-muted sm:px-5"
        title="Um score exigiria pesos definidos pela área de negócio; nenhum foi definido, e inventá-los aqui produziria um número sem dono."
      >
        {adverse === 0
          ? 'Nenhuma dimensão apurada está em atenção.'
          : `${adverse} ${adverse === 1 ? 'dimensão apurada está' : 'dimensões apuradas estão'} em atenção.`}
        {' '}Sem índice numérico: mede-se cobertura de dado, não desempenho.
      </p>
    </section>
  );
}

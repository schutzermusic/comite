'use client';

/**
 * O TRILHO DA CADEIA — a fronteira do domínio como gramática visual.
 *
 * A pergunta "qual a relação entre marco contratual e medição operacional?"
 * vinha sendo respondida por um parágrafo acima de dois painéis lado a lado.
 * Parágrafo não se lê na décima linha de uma lista. Quatro nós se leem.
 *
 *   CONTRATUAL → EXECUÇÃO → ACEITE → FATURAMENTO
 *   Contratos    Projetos    Autoridade  Contratos/Fiscal
 *
 * Cada nó acende SOMENTE com fato da sua própria fonte, e cada nó nomeia essa
 * fonte embaixo. O primeiro nó apagado é o gargalo daquele marco — e é para
 * onde a ação da linha aponta.
 *
 * Conector tracejado = elo não percorrido. É o mesmo vocabulário do trilho
 * tracejado da esteira e do chip tracejado: ausência nunca se parece com zero.
 */

import { cn } from '@/lib/utils';
import type { ChainLink } from '@/lib/contracts/measurement/milestone-stage';

export interface ChainRailProps {
  readonly links: readonly ChainLink[];
  readonly compact?: boolean;
  readonly className?: string;
}

export function ChainRail({ links, compact = false, className }: ChainRailProps) {
  return (
    <ol
      className={cn('dossier-chain', compact && 'dossier-chain-compact', className)}
      aria-label="Cadeia do marco: contratual, execução, aceite, faturamento"
    >
      {links.map((link, index) => {
        const previous = index > 0 ? links[index - 1] : null;
        return (
          <li key={link.key} className="dossier-chain-step">
            {previous && (
              <span
                className="dossier-chain-link"
                data-reached={previous.fact ? 'true' : 'false'}
                aria-hidden
              />
            )}
            <span
              className="dossier-chain-node"
              data-fact={link.fact ? 'true' : 'false'}
              data-blocked={link.blocked ? 'true' : undefined}
              aria-hidden
            />
            {!compact && (
              <span className="dossier-chain-text">
                <span className="dossier-chain-label">{link.label}</span>
                {/*
                  A fonte, nomeada. Quando o elo não tem fato, um travessão —
                  e não uma data, um zero ou um "pendente" que pareça apuração.
                */}
                <span className="dossier-chain-source">{link.source ?? '—'}</span>
              </span>
            )}
            <span className="sr-only">
              {link.label}
              {link.blocked ? ': bloqueado' : link.fact ? `: ${link.source}` : ': não apurado'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

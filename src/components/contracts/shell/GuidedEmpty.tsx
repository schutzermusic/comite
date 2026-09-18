'use client';

/**
 * O VAZIO QUE ENSINA.
 *
 * ─── Por que `cause` é obrigatório ─────────────────────────────────────────
 *
 * "Nenhum registro encontrado" é verdadeiro e inútil: deixa o leitor decidir se
 * o produto está quebrado, se ele não tem permissão, ou se realmente não há
 * nada. As três hipóteses levam a ações diferentes, e só quem renderiza sabe
 * qual é o caso.
 *
 * Por isso `cause` é uma prop OBRIGATÓRIA e não tem valor padrão: o compilador
 * impede que um vazio genérico volte a aparecer nesta aba. Quem não souber
 * dizer a causa não deveria estar usando este componente.
 *
 * ─── A ordem dos quatro blocos ─────────────────────────────────────────────
 *
 *   ausência → CAUSA → consequência → caminho
 *
 * A consequência vem antes do botão de propósito: sem ela, a ação parece
 * opcional. "Sem etapa mapeada nenhum marco sai de Não apurado" é o que faz
 * alguém clicar.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GuidedEmptyAction {
  readonly label: string;
  readonly href?: string;
  readonly onClick?: () => void;
}

export interface GuidedEmptyProps {
  readonly title: string;
  /** POR QUE está vazio, com o dado concreto deste contrato. Obrigatório. */
  readonly cause: string;
  /** O que fica impedido enquanto assim permanecer. */
  readonly consequence?: string;
  /** A cadeia em miniatura, para ensinar o modelo: `['Exigência ✓', 'Cronograma ✗', …]`. */
  readonly chain?: readonly string[];
  readonly icon?: ReactNode;
  readonly primary?: GuidedEmptyAction;
  readonly secondary?: GuidedEmptyAction;
  readonly className?: string;
}

function Action({ action, primary }: { action: GuidedEmptyAction; primary: boolean }) {
  const className = cn('dossier-empty-action', primary && 'is-primary');
  const content = (
    <>
      {action.label}
      {action.href && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
    </>
  );
  if (action.href) return <Link href={action.href} className={className}>{content}</Link>;
  return <button type="button" className={className} onClick={action.onClick}>{content}</button>;
}

export function GuidedEmpty({
  title, cause, consequence, chain, icon, primary, secondary, className,
}: GuidedEmptyProps) {
  return (
    <div className={cn('dossier-empty', className)} role="status">
      <div className="dossier-empty-head">
        <span className="dossier-empty-icon" aria-hidden>
          {icon ?? <Info className="h-4 w-4" />}
        </span>
        <p className="dossier-empty-title">{title}</p>
      </div>

      <p className="dossier-empty-cause">{cause}</p>
      {consequence && <p className="dossier-empty-consequence">{consequence}</p>}

      {chain && chain.length > 0 && (
        /*
          A cadeia em miniatura. Não é decoração: é onde o leitor descobre que
          o elo que falta não é o desta tela, e sim o anterior.
        */
        <ol className="dossier-empty-chain" aria-label="Cadeia até o faturamento">
          {chain.map((step) => {
            const state = step.endsWith('✓') ? 'fact' : step.endsWith('✗') ? 'missing' : 'pending';
            return <li key={step} data-state={state}>{step}</li>;
          })}
        </ol>
      )}

      {(primary || secondary) && (
        <div className="dossier-empty-actions">
          {primary && <Action action={primary} primary />}
          {secondary && <Action action={secondary} primary={false} />}
        </div>
      )}
    </div>
  );
}

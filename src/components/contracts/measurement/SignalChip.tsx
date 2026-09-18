'use client';

/**
 * O CHIP DE SINAL — um só para toda a aba.
 *
 * Antes desta peça, estágio, atraso, ausência de responsável e ausência de
 * evidência eram quatro tratamentos tipográficos diferentes na mesma linha, e
 * a tela pedia ao leitor que aprendesse quatro gramáticas para ler um marco.
 *
 * Reusa `.dossier-status[data-tone]`, que já existe no tema e já tem paridade
 * claro/escuro. Nenhuma cor nova nasce aqui.
 *
 * `dashed` é vocabulário reservado: contorno tracejado significa NÃO APURADO,
 * em toda a aba, sem exceção. É como a tela distingue ausência de zero sem
 * precisar escrever a palavra.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { StageTone } from '@/lib/contracts/measurement/milestone-stage';

export interface SignalChipProps {
  readonly tone?: StageTone;
  readonly dashed?: boolean;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly title?: string;
  readonly className?: string;
}

export function SignalChip({
  tone = 'neutral', dashed = false, icon, children, title, className,
}: SignalChipProps) {
  return (
    <span
      className={cn('dossier-status', className)}
      data-tone={dashed ? 'disconnected' : tone}
      data-dashed={dashed || undefined}
      title={title}
    >
      {icon ?? <i aria-hidden />}
      {children}
    </span>
  );
}

'use client';

/**
 * A pastilha do planejamento — um desenho só para os quatro graus.
 *
 * Reusa `.dossier-status`, o mesmo chip do resto da aba. A única adição é o
 * tom `received`, que é a ÚNICA pastilha preenchida da tela: recebido é a
 * única coisa aqui que afirma caixa, e precisa ter o peso visual de uma
 * afirmação.
 */

import type { ReactNode } from 'react';
import type { StageTone } from '@/lib/contracts/measurement/milestone-stage';

export function PlanChip({
  tone, dashed, children, title,
}: {
  readonly tone: StageTone | 'received';
  readonly dashed: boolean;
  readonly children: ReactNode;
  readonly title?: string;
}) {
  return (
    <span
      className="dossier-status"
      data-tone={dashed ? 'disconnected' : tone}
      data-dashed={dashed || undefined}
      title={title}
    >
      <i aria-hidden />
      {children}
    </span>
  );
}

'use client';

/**
 * Ajuste manual de quadro.
 *
 * ─── Por que vive fora da seção de Conformidade ────────────────────────────
 *
 * Ele nasceu dentro dela, o que colocava uma FERRAMENTA de escrita no meio de
 * um bloco que só relata estado — e, pior, empurrava o Simulador para depois
 * dela, deixando a última coisa da página como um formulário de administrador
 * em vez da leitura que interessa ao board.
 *
 * Agora fecha a página: primeiro o que aconteceu (seções 1–6), depois o que
 * aconteceria (simulador), e por último a manutenção da base — que só aparece
 * para quem pode executá-la.
 */

import { SlidersHorizontal } from 'lucide-react';

import { ManualHeadcountPanel } from '../../ManualHeadcountPanel';
import { WorkforceCollapsible } from '../WorkforceCollapsible';
import type { ManualHeadcountPanelProps } from '../../ManualHeadcountPanel';

interface ManualHeadcountSectionProps {
  /** Ajuste manual de quadro — só administrador, e só quando há competência. */
  manualHeadcount: ManualHeadcountPanelProps;
}

export function ManualHeadcountSection({ manualHeadcount }: ManualHeadcountSectionProps) {
  return (
    <section id="wf-ajuste-quadro">
      {/* Recolhido como o Detalhamento, e pelo mesmo motivo: é conteúdo de
          consulta ocasional, não de leitura corrida. Aberto por padrão, um
          formulário de administrador seria a última coisa que todo mundo vê ao
          rolar a página até o fim. */}
      <WorkforceCollapsible
        title="Ajuste manual de quadro"
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-ig-fg-muted" />}
        count={manualHeadcount.competences.length}
        hint="competências sem detalhe por trabalhador no eSocial · restrito a administradores"
      >
        <ManualHeadcountPanel {...manualHeadcount} />
      </WorkforceCollapsible>
    </section>
  );
}

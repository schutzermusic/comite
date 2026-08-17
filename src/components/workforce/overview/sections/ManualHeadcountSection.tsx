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

import { ManualHeadcountPanel } from '../../ManualHeadcountPanel';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import type { ManualHeadcountPanelProps } from '../../ManualHeadcountPanel';

interface ManualHeadcountSectionProps {
  /** Ajuste manual de quadro — só administrador, e só quando há competência. */
  manualHeadcount: ManualHeadcountPanelProps;
}

export function ManualHeadcountSection({ manualHeadcount }: ManualHeadcountSectionProps) {
  return (
    <section id="wf-ajuste-quadro" className="space-y-3">
      <WorkforceSectionHeader
        title="Ajuste manual de quadro"
        subtitle="Para competências em que o eSocial não entregou o detalhe por trabalhador — restrito a administradores"
      />
      <ManualHeadcountPanel {...manualHeadcount} />
    </section>
  );
}

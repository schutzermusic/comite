'use client';

/**
 * A ESTEIRA CONTRATO → CAIXA, como cockpit.
 *
 * ─── O defeito que esta peça corrige ───────────────────────────────────────
 *
 * A versão anterior desenhava cinco caixas de peso igual. Mas a qualquer
 * momento exatamente UM estágio é o gargalo, e os quatro outros ou já são fato
 * ou nem são alcançáveis ainda. Peso igual obrigava o leitor a comparar cinco
 * coisas para descobrir a única que importa.
 *
 * Agora: o gargalo é levantado (sombra alta, borda de acento), o que está a
 * jusante recua (opacidade), e uma frase abaixo diz o que está bloqueado,
 * quanto vale e qual é o caminho.
 *
 * ─── O que continua proibido ───────────────────────────────────────────────
 *
 * RECEBIDO segue tracejado e transparente enquanto não houver conciliação com
 * o razão financeiro. Promovê-lo a card sólido — mesmo bonito, mesmo vazio —
 * faria a tela parecer saber de um recebimento que ela não tem como afirmar.
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, PlugZap, Unplug } from 'lucide-react';
import {
  findBottleneck,
  type CashStage, type CashStageKey, type CashStageState,
} from '@/lib/contracts/trust/contract-to-cash';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import { TrustedValue } from '../cockpit/TrustedValue';

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 2,
});

const STATE_CHIP: Record<CashStageState, { label: string; icon: React.ReactNode | null } | null> = {
  measured: null,
  unmeasured: { label: 'Não apurado', icon: null },
  error: { label: 'Indisponível', icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  'not-instrumented': { label: 'Não instrumentado', icon: <PlugZap className="h-3 w-3" aria-hidden /> },
  'not-integrated': { label: 'Não integrado', icon: <Unplug className="h-3 w-3" aria-hidden /> },
};

const SOURCE_LABEL: Record<CashStageKey, string> = {
  contracted: 'contracts',
  measured: 'contract_milestones',
  approved: 'contract_approvals',
  billed: 'contract_billing_events',
  received: 'razão financeiro',
};

/** Rótulo curto do estado, para a linha de diagnóstico sob cada estágio. */
const STATE_SUMMARY: Record<CashStageState, string> = {
  measured: 'apurado',
  unmeasured: 'aguarda',
  error: 'falha na leitura',
  'not-instrumented': 'sem instrumentação',
  'not-integrated': 'sem fonte',
};

export interface CashPipelineProps {
  readonly stages: readonly CashStage[];
  /** Frase de diagnóstico do gargalo, montada por quem conhece o contrato. */
  readonly bottleneckNote?: string | null;
  readonly action?: { readonly label: string; readonly onClick: () => void } | null;
  readonly className?: string;
}

export function CashPipeline({ stages, bottleneckNote, action, className }: CashPipelineProps) {
  const bottleneck = findBottleneck(stages);
  const resolved = stages.filter((s) => s.state === 'measured').length;

  return (
    <section className={cn('dossier-surface dossier-pipeline', className)}>
      <header className="dossier-section-head">
        <div>
          <h3>Contrato → Caixa</h3>
          <p>Do valor contratado ao recebimento · cada etapa preserva sua fonte.</p>
        </div>
        <div className="dossier-pipeline-summary">
          {bottleneck && (
            <span className="dossier-pipeline-bottleneck-tag">
              Gargalo: <strong>{bottleneck.stage.label}</strong>
            </span>
          )}
          <span className="ig-tabular dossier-pipeline-progress">{resolved} de {stages.length} apurados</span>
        </div>
      </header>

      <div className="dossier-section-body">
        <ol className="dossier-pipeline-track" data-testid="contract-to-cash">
          {stages.map((stage, index) => {
            const chip = STATE_CHIP[stage.state];
            const isBottleneck = bottleneck?.index === index;
            const downstream = bottleneck !== null && index > bottleneck.index;
            const previous = index > 0 ? stages[index - 1] : null;

            return (
              <li
                key={stage.key}
                className="dossier-pipeline-stage"
                data-state={stage.state}
                data-bottleneck={isBottleneck || undefined}
                data-downstream={downstream || undefined}
              >
                {previous && (
                  <span
                    className="dossier-pipeline-link"
                    data-reached={previous.state === 'measured' ? 'true' : 'false'}
                    aria-hidden
                  >
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                )}

                <p className="dossier-pipeline-label">
                  {stage.label}
                  <span className="ig-tabular dossier-pipeline-index" aria-hidden>{index + 1}/{stages.length}</span>
                </p>

                <div className="dossier-pipeline-value">
                  {hasOfficialValue(stage.amount) ? (
                    <TrustedValue value={stage.amount} format={(v) => BRL_COMPACT.format(v)} size="lg" metallic showProvenance />
                  ) : (
                    <span className="dossier-pipeline-absent">
                      {chip?.icon}
                      {chip?.label ?? 'Não apurado'}
                    </span>
                  )}
                </div>

                {/* Trilho sólido quando há proporção apurada; tracejado quando não. */}
                {stage.shareOfContracted === null ? (
                  <div
                    className="dossier-pipeline-meter is-absent"
                    role="img"
                    aria-label={`${stage.label} não apurado`}
                  />
                ) : (
                  <div className="dossier-pipeline-meter">
                    <i style={{ width: `${Math.round(stage.shareOfContracted * 100)}%` }} />
                  </div>
                )}

                <p className="dossier-pipeline-meta">
                  <span>
                    {hasOfficialValue(stage.count)
                      ? `${stage.count.value} registro(s)`
                      : 'sem registro'}
                  </span>
                  <span className="dossier-pipeline-state">{STATE_SUMMARY[stage.state]}</span>
                </p>
                <p className="dossier-pipeline-source">{SOURCE_LABEL[stage.key]}</p>

                {stage.note && (
                  <details className="dossier-pipeline-note">
                    <summary>{stage.state === 'error' ? 'Falha na consulta' : 'O que falta apurar'}</summary>
                    <p>{stage.note}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ol>

        {/*
          A frase que faz a esteira valer o espaço: o que está bloqueado, quanto
          vale, por quê, e para onde ir. Derivada — nunca escrita à mão.
        */}
        {bottleneck && bottleneckNote && (
          <div className="dossier-pipeline-callout">
            <span className="dossier-pipeline-callout-mark" aria-hidden />
            <p>{bottleneckNote}</p>
            {action && (
              <button type="button" className="dossier-empty-action is-primary" onClick={action.onClick}>
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

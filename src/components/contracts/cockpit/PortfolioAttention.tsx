'use client';

/**
 * Central de atenção da carteira (MD §12).
 *
 * Cada item nomeia o contrato, o problema, a dimensão temporal e a próxima
 * ação. O sistema não diz "2 obrigações atrasadas" — diz qual contrato, há
 * quantos dias, o que isso trava e o que fazer.
 *
 * Impacto financeiro só aparece onde o dado o sustenta.
 *
 * P2G — separação por PESO, não só por cor:
 *
 *   · crítico e atenção  → linha de ação, com exposição e CTA (é operação)
 *   · configuração       → trilho de PRONTIDÃO, uma linha por item (é cadastro)
 *   · informativo        → linha calada (é contexto)
 *
 * ─── Densidade ─────────────────────────────────────────────────────────────
 *
 * A severidade era uma cápsula outline no topo do bloco e outra em cada linha;
 * o motivo vinha em corpo inteiro; a prontidão era um card com borda, tinta e
 * cabeçalho DENTRO do card do bloco, com cada passo numa caixinha própria.
 *
 * Agora a severidade é o Signal inline do sistema — ponto tonal + rótulo, sem
 * caixa — e a prontidão é um trilho de checklist: assunto à esquerda, ação à
 * direita, explicação no `title`. O porquê continua a um passe de mouse; o que
 * ele não faz mais é gastar duas linhas de altura por item, permanentemente.
 */

import { cn } from '@/lib/utils';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Info, Settings2 } from 'lucide-react';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import type { PortfolioAttentionItem } from '@/lib/contracts/trust/command-center';
import type { AttentionSeverity, AttentionActionKey } from '@/lib/contracts/trust/attention';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const SEV: Record<AttentionSeverity, {
  label: string; icon: React.ReactNode; tone: HudSignalTone; rail: string; text: string;
}> = {
  critical: {
    label: 'Crítico', icon: <AlertOctagon aria-hidden />, tone: 'critical',
    rail: 'bg-ig-danger', text: 'text-ig-danger',
  },
  warning: {
    label: 'Atenção', icon: <AlertTriangle aria-hidden />, tone: 'warning',
    rail: 'bg-ig-warning', text: 'text-ig-warning',
  },
  setup: {
    label: 'Prontidão', icon: <Settings2 aria-hidden />, tone: 'accent',
    rail: 'bg-ig-accent', text: 'text-ig-accent',
  },
  info: {
    label: 'Monitorar', icon: <Info aria-hidden />, tone: 'info',
    rail: 'bg-ig-info', text: 'text-ig-info',
  },
};

export interface PortfolioAttentionProps {
  items: readonly PortfolioAttentionItem[];
  liveContractCount: number;
  onAction?: (contractId: string, key: AttentionActionKey) => void;
  onOpenContract?: (contractId: string) => void;
  max?: number;
  className?: string;
}

export function PortfolioAttention({
  items, liveContractCount, onAction, onOpenContract, max, className,
}: PortfolioAttentionProps) {
  if (items.length === 0) {
    return (
      <div className={cn('flex items-start gap-2 py-1', className)}>
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-success" aria-hidden />
        <div className="min-w-0">
          <p className="text-ig-caption font-semibold text-ig-fg-strong">
            Nada exige atenção na carteira operacional
          </p>
          <p className="mt-0.5 text-ig-caption text-ig-fg-subtle">
            {liveContractCount === 0
              ? 'Não há contrato operacional classificado — demonstração não gera sinal.'
              : `Dimensões apuradas ${liveContractCount === 1 ? 'do contrato operacional' : `dos ${liveContractCount} contratos operacionais`} estão regulares.`}
          </p>
        </div>
      </div>
    );
  }

  /*
    Operacional é o que exige decisão agora; configuração é o que falta
    registrar. Misturar os dois na mesma pilha faz o segundo abafar o primeiro
    — o inverso do que uma central de atenção deve fazer.
  */
  const operational = items.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  const setupItems = items.filter((i) => i.severity === 'setup');
  const infoItems = items.filter((i) => i.severity === 'info');

  const shownOperational = max ? operational.slice(0, max) : operational;
  const hiddenOperational = operational.length - shownOperational.length;

  const critical = operational.filter((i) => i.severity === 'critical').length;
  const warning = operational.length - critical;

  return (
    <div className={cn('space-y-2.5', className)}>
      {/* Cabeçalho de sinal: o "quanto" em Signals inline, sem cápsulas. */}
      {operational.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {critical > 0 && (
            <HudSignal variant="inline" size="sm" tone="critical" icon={SEV.critical.icon} label="Crítico" value={critical} />
          )}
          {warning > 0 && (
            <HudSignal variant="inline" size="sm" tone="warning" icon={SEV.warning.icon} label="Atenção" value={warning} />
          )}
        </div>
      )}

      {shownOperational.length > 0 && (
        <ul className="-mx-1 divide-y divide-ig-border-subtle">
          {shownOperational.map((item) => {
            const s = SEV[item.severity];
            const exposure = item.exposure && hasOfficialValue(item.exposure) ? item.exposure.value : null;
            const act = onAction
              ? () => onAction(item.contractId, item.actionKey)
              : onOpenContract
                ? () => onOpenContract(item.contractId)
                : undefined;
            return (
              <li key={`${item.contractId}-${item.id}`} className="relative py-2 pl-3 pr-1">
                <span className={cn('pointer-events-none absolute inset-y-2.5 left-0 w-[2px] rounded-full', s.rail)} aria-hidden />

                {/* Problema em uma linha forte, magnitude na mesma régua. */}
                <div className="flex items-baseline gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong" title={item.reason}>
                    {item.title}
                  </h4>
                  {exposure !== null && (
                    <span className={cn('ig-tabular shrink-0 text-ig-caption font-semibold', s.text)}>
                      {BRL.format(exposure)}
                    </span>
                  )}
                </div>

                {/* Referência do contrato + CTA, na mesma linha. */}
                <div className="mt-0.5 flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-muted">
                    <button
                      type="button"
                      onClick={onOpenContract ? () => onOpenContract(item.contractId) : undefined}
                      disabled={!onOpenContract}
                      className={cn(
                        'ig-code',
                        onOpenContract && 'rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                      )}
                    >
                      {item.contractCode}
                    </button>
                    <span className="mx-1.5 text-ig-fg-subtle" aria-hidden>·</span>
                    {item.counterparty}
                    {item.age && <span className="ml-1.5 text-ig-fg-subtle">· {item.age}</span>}
                  </p>
                  {act && (
                    <button
                      type="button"
                      onClick={act}
                      className="inline-flex shrink-0 items-center gap-1 rounded text-ig-caption font-semibold text-ig-accent transition-transform hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
                    >
                      {onAction ? item.actionLabel : 'Revisar'}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenOperational > 0 && (
        <p className="px-1 text-ig-caption text-ig-fg-subtle">
          + {hiddenOperational} outro(s) sinal(is) operacional(is) na carteira
        </p>
      )}

      {setupItems.length > 0 && (
        <ReadinessRail items={setupItems} onAction={onAction} onOpenContract={onOpenContract} />
      )}

      {infoItems.length > 0 && (
        <ul className="space-y-0.5 border-t border-ig-border-subtle pt-1.5">
          {infoItems.map((item) => (
            <li key={`${item.contractId}-${item.id}`} className="flex items-baseline gap-2 px-1">
              <HudSignal variant="inline" size="sm" tone="info" label={item.title} className="min-w-0 max-w-[70%]" />
              <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-subtle" title={item.reason}>
                {item.reason}
              </span>
              <span className="ig-code ig-code-quiet shrink-0">{item.contractCode}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Prontidão operacional — trilho de checklist, não card dentro de card.
 *
 * Nada aqui está irregular: são controles que ainda não foram instalados. Por
 * isso o trilho não tem tom de alarme, não tem moldura e não repete um
 * cabeçalho de severidade a cada linha. Uma linha por passo: assunto à
 * esquerda, próxima ação à direita, a justificativa no `title` — visível para
 * quem pergunta, silenciosa para quem já sabe.
 */
function ReadinessRail({
  items, onAction, onOpenContract,
}: {
  items: readonly PortfolioAttentionItem[];
  onAction?: (contractId: string, key: AttentionActionKey) => void;
  onOpenContract?: (contractId: string) => void;
}) {
  const byContract = new Map<string, PortfolioAttentionItem[]>();
  for (const item of items) {
    const list = byContract.get(item.contractId) ?? [];
    list.push(item);
    byContract.set(item.contractId, list);
  }

  return (
    <section className="border-t border-ig-border-subtle pt-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
        <HudSignal variant="inline" size="sm" tone="accent" label="Prontidão" value={items.length} />
        <span className="min-w-0 truncate text-ig-caption text-ig-fg-subtle">
          {byContract.size === 1 ? 'controle pendente — nada irregular' : `controles em ${byContract.size} contratos — nada irregular`}
        </span>
      </header>

      <div className="mt-1 space-y-1.5">
        {[...byContract.entries()].map(([contractId, list]) => (
          <div key={contractId}>
            {byContract.size > 1 && (
              <button
                type="button"
                onClick={onOpenContract ? () => onOpenContract(contractId) : undefined}
                disabled={!onOpenContract}
                className={cn(
                  'ig-code ig-code-quiet px-1',
                  onOpenContract && 'rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
              >
                {list[0].contractCode}
              </button>
            )}
            <ul>
              {list.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 rounded-md px-1 py-[3px]" title={item.reason}>
                  <span className="mt-[-2px] h-[5px] w-[5px] shrink-0 self-center rounded-full bg-[color-mix(in_oklab,var(--ig-accent)_65%,transparent)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-default">{item.title}</span>
                  {onAction ? (
                    <button
                      type="button"
                      onClick={() => onAction(item.contractId, item.actionKey)}
                      className="shrink-0 rounded text-ig-caption font-semibold text-ig-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
                    >
                      {item.actionLabel}
                    </button>
                  ) : (
                    <span className="shrink-0 text-ig-caption text-ig-fg-subtle">{item.actionLabel}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

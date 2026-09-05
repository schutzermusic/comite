'use client';

/**
 * Central de atenção da carteira (MD §12).
 *
 * Cada item nomeia o contrato, o problema, por que importa, a dimensão temporal
 * e a próxima ação. O sistema não diz "2 obrigações atrasadas" — diz qual
 * contrato, há quantos dias, o que isso trava e o que fazer.
 *
 * Impacto financeiro só aparece onde o dado o sustenta.
 *
 * P2G — separação por PESO, não só por cor. Antes, as quatro severidades
 * rendiam cards idênticos, e uma carteira recém-cadastrada virava uma coluna
 * de quatro "Configuração pendente" visualmente iguais a um contrato vencido.
 * Peso igual para coisas de urgência diferente é ruído: treina o olho a ignorar
 * a coluna inteira, inclusive o que é crítico.
 *
 * Agora:
 *   · crítico e atenção  → card próprio, com exposição e ação (é operação)
 *   · configuração       → superfície CONSOLIDADA de prontidão (é cadastro)
 *   · informativo        → linha compacta (é contexto)
 */

import { cn } from '@/lib/utils';
import { AlertOctagon, AlertTriangle, Info, ArrowRight, CheckCircle2, ShieldCheck, Settings2 } from 'lucide-react';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import type { PortfolioAttentionItem } from '@/lib/contracts/trust/command-center';
import type { AttentionSeverity, AttentionActionKey } from '@/lib/contracts/trust/attention';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const SEV: Record<AttentionSeverity, { label: string; icon: React.ReactNode; rail: string; text: string; tint: string }> = {
  critical: {
    label: 'Crítico',
    icon: <AlertOctagon className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-danger', text: 'text-ig-danger',
    tint: 'bg-[color-mix(in_oklab,var(--ig-danger)_5%,transparent)]',
  },
  warning: {
    label: 'Atenção',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-warning', text: 'text-ig-warning',
    tint: 'bg-[color-mix(in_oklab,var(--ig-warning)_5%,transparent)]',
  },
  setup: {
    label: 'Configuração pendente',
    icon: <Settings2 className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-accent', text: 'text-ig-accent',
    tint: 'bg-[color-mix(in_oklab,var(--ig-accent)_5%,transparent)]',
  },
  info: {
    label: 'Monitorar',
    icon: <Info className="h-3.5 w-3.5" aria-hidden />,
    rail: 'bg-ig-info', text: 'text-ig-info', tint: '',
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
  const shown = max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;

  const counts: Record<AttentionSeverity, number> = {
    critical: items.filter((i) => i.severity === 'critical').length,
    warning: items.filter((i) => i.severity === 'warning').length,
    setup: items.filter((i) => i.severity === 'setup').length,
    info: items.filter((i) => i.severity === 'info').length,
  };

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'rounded-[16px] border border-[color-mix(in_oklab,var(--ig-success)_26%,transparent)]',
          'bg-[color-mix(in_oklab,var(--ig-success)_5%,transparent)] px-5 py-5',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
          <CheckCircle2 className="h-4 w-4 text-ig-success" aria-hidden />
          Nada exige atenção na carteira operacional
        </p>
        <p className="mt-1.5 text-ig-body-sm leading-relaxed text-ig-fg-muted">
          {liveContractCount === 0
            ? 'Não há contrato operacional classificado. Contratos de demonstração não geram sinal — um alerta sobre um fixture faria alguém agir sobre algo que não existe.'
            : `As dimensões apuradas ${liveContractCount === 1 ? 'do contrato operacional' : `dos ${liveContractCount} contratos operacionais`} estão regulares.`}
        </p>
      </div>
    );
  }

  /*
    Operacional é o que exige decisão agora; configuração é o que falta
    registrar. Misturar os dois na mesma pilha faz o segundo abafar o primeiro
    — que é exatamente o inverso do que uma central de atenção deve fazer.
  */
  const operational = items.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  const setupItems = items.filter((i) => i.severity === 'setup');
  const infoItems = items.filter((i) => i.severity === 'info');

  const shownOperational = max ? operational.slice(0, max) : operational;
  const hiddenOperational = operational.length - shownOperational.length;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Cabeçalho com a contagem por severidade — o "quanto" antes do "o quê". */}
      <div className="flex flex-wrap items-center gap-2">
        {(['critical', 'warning', 'setup', 'info'] as AttentionSeverity[]).map((sev) => {
          const n = counts[sev];
          if (n === 0) return null;
          const s = SEV[sev];
          return (
            <span
              key={sev}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_55%,transparent)] py-1 pl-1 pr-2.5"
            >
              <span className={cn('h-3.5 w-[2px] rounded-full', s.rail)} aria-hidden />
              <span className={cn('text-ig-caption font-semibold', s.text)}>{s.label}</span>
              <span className="ig-tabular text-ig-caption font-bold text-ig-fg-strong">{n}</span>
            </span>
          );
        })}
      </div>

      {shownOperational.map((item) => {
        const s = SEV[item.severity];
        return (
          <article
            key={`${item.contractId}-${item.id}`}
            className={cn(
              /*
                Linha, não cartão. "Requer ação" numa carteira com dez sinais
                desenhava dez caixas de 16px de raio empilhadas — dez molduras
                para dizer dez frases. O trilho tonal à esquerda segue sendo o
                portador da severidade.
              */
              'relative border-b border-ig-border-subtle py-3 pl-4 pr-2 transition-colors last:border-b-0',
              s.tint,
              'hover:bg-ig-bg-raised/40',
            )}
          >
            <span className={cn('pointer-events-none absolute inset-y-0 left-0 w-[3px]', s.rail)} aria-hidden />

            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className={cn('flex items-center gap-1.5 text-ig-label font-semibold', s.text)}>
                {s.icon}
                {s.label}
              </span>
              <button
                type="button"
                onClick={onOpenContract ? () => onOpenContract(item.contractId) : undefined}
                disabled={!onOpenContract}
                className={cn(
                  'font-mono text-ig-caption font-semibold text-ig-fg-muted',
                  onOpenContract && 'hover:text-ig-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] rounded',
                )}
              >
                {item.contractCode}
              </button>
              <span className="truncate text-ig-caption text-ig-fg-muted">{item.counterparty}</span>
              {item.age && (
                <span className="ml-auto shrink-0 text-ig-caption text-ig-fg-muted">{item.age}</span>
              )}
            </header>

            <h4 className="mt-2 text-[15px] font-semibold leading-snug text-ig-fg-strong">{item.title}</h4>
            <p className="mt-1 text-ig-body-sm leading-relaxed text-ig-fg-muted">{item.reason}</p>

            {item.exposure && hasOfficialValue(item.exposure) && (
              <p className="mt-2.5 flex items-baseline gap-2">
                <span className="text-ig-caption text-ig-fg-muted">Exposição</span>
                <span className={cn('ig-tabular text-ig-h2', s.text)}>
                  {BRL.format(item.exposure.value)}
                </span>
              </p>
            )}

            {onAction && (
              <button
                type="button"
                onClick={() => onAction(item.contractId, item.actionKey)}
                className={cn(
                  'mt-3 inline-flex items-center gap-1.5 rounded-[8px] border border-ig-border-subtle px-3 py-1.5',
                  'text-ig-caption font-medium text-ig-fg-strong transition-all',
                  'hover:border-ig-border-focus hover:bg-[color-mix(in_oklab,var(--ig-accent)_8%,transparent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
              >
                {item.actionLabel}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </article>
        );
      })}

      {hiddenOperational > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-ig-caption text-ig-fg-subtle">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          + {hiddenOperational} outro(s) sinal(is) operacional(is) na carteira
        </p>
      )}

      {setupItems.length > 0 && (
        <SetupReadinessSurface items={setupItems} onAction={onAction} onOpenContract={onOpenContract} />
      )}

      {infoItems.length > 0 && (
        <ul className="space-y-1">
          {infoItems.map((item) => (
            <li
              key={`${item.contractId}-${item.id}`}
              className="flex items-start gap-2 rounded-[10px] border border-ig-border-subtle bg-ig-panel/40 px-3 py-2"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-info" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-ig-body-sm text-ig-fg-strong">{item.title}</span>
                <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">{item.reason}</span>
              </span>
              <span className="shrink-0 font-mono text-ig-caption text-ig-fg-subtle">{item.contractCode}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Prontidão operacional — o que falta REGISTRAR, num lugar só.
 *
 * Deliberadamente sem tom de alarme: nada aqui está irregular. São passos de
 * cadastro que ainda não aconteceram, e um contrato pode viver sem vários
 * deles. Agrupar por contrato — e não repetir o cabeçalho "Configuração
 * pendente" a cada linha — devolve à coluna a leitura que a repetição tirava.
 */
function SetupReadinessSurface({
  items,
  onAction,
  onOpenContract,
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
    <section className="rounded-[16px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-accent)_4%,transparent)] px-4 py-3.5">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="flex items-center gap-1.5 text-ig-label font-semibold text-ig-accent">
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          Prontidão operacional
        </span>
        <span className="ig-tabular text-ig-caption font-semibold text-ig-fg-strong">{items.length}</span>
        <span className="text-ig-caption text-ig-fg-muted">
          {byContract.size === 1 ? 'passo de cadastro pendente' : `passos em ${byContract.size} contratos`}
        </span>
      </header>

      <p className="mt-1 text-ig-caption text-ig-fg-muted">
        Nada aqui está irregular — são registros que ainda não foram feitos.
      </p>

      <div className="mt-3 space-y-2.5">
        {[...byContract.entries()].map(([contractId, list]) => (
          <div key={contractId}>
            <button
              type="button"
              onClick={onOpenContract ? () => onOpenContract(contractId) : undefined}
              disabled={!onOpenContract}
              className={cn(
                'font-mono text-ig-caption font-semibold text-ig-fg-muted',
                onOpenContract && 'rounded hover:text-ig-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
              )}
            >
              {list[0].contractCode}
            </button>
            <span className="ml-2 text-ig-caption text-ig-fg-subtle">{list[0].counterparty}</span>

            <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {list.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-[10px] border border-ig-border-subtle bg-ig-panel/45 px-3 py-2"
                >
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ig-accent/70" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ig-body-sm font-medium leading-snug text-ig-fg-strong">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-ig-caption leading-relaxed text-ig-fg-muted">
                      {item.reason}
                    </span>
                    {onAction && (
                      <button
                        type="button"
                        onClick={() => onAction(item.contractId, item.actionKey)}
                        className="mt-1.5 inline-flex items-center gap-1 text-ig-caption font-medium text-ig-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] rounded"
                      >
                        {item.actionLabel}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

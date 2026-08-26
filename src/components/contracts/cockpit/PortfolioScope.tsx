'use client';

/**
 * Indicador e seletor de escopo da carteira.
 *
 * Existe porque a base contém quatro contratos e apenas UM é operacional. Sem
 * este componente a interface deixaria o usuário supor que o que vê é a
 * carteira da empresa — foi exatamente o que aconteceu até aqui, com a
 * Executive Band somando R$ 1,5M dos quais R$ 1,46M vinham de linhas que
 * ninguém validou.
 *
 * A escolha é declarar, não ocultar (MD §64): contratos de demonstração
 * continuam visíveis e alcançáveis, com a classificação explícita. O default é
 * a carteira oficial porque a pergunta normal do usuário é sobre a carteira real.
 *
 * P2G-final — o SELETOR saiu do cabeçalho principal.
 *
 * "Ao vivo / Demonstração / Não classificados / Todos" é vocabulário de quem
 * construiu o sistema, não de quem opera contratos: `data_class` é uma decisão
 * de arquitetura de dados, e um gestor abrindo a tela para ver a carteira da
 * empresa não deveria precisar entender essa taxonomia antes de ler o primeiro
 * número. A área nobre do cabeçalho passou a ser só operação.
 *
 * O que NÃO mudou: a filtragem por origem, o default de carteira oficial, e a
 * regra de que só `live` compõe métrica oficial. O seletor continua existindo —
 * como controle avançado, revelado sob demanda e só quando há de fato registro
 * fora da carteira oficial. Ocultar a existência desses registros seria voltar
 * ao problema que este arquivo nasceu para resolver; o que se ocultou foi o
 * CONTROLE, não o fato.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CircleDot, FlaskConical, HelpCircle, Layers, ChevronDown } from 'lucide-react';
import type { ContractDataClass } from '@/lib/contracts/trust/trusted';

export type PortfolioScopeKey = 'live' | 'demo' | 'unclassified' | 'all';

export const PORTFOLIO_SCOPES: {
  key: PortfolioScopeKey;
  label: string;
  icon: React.ReactNode;
  hint: string;
}[] = [
  { key: 'live', label: 'Ao vivo', icon: <CircleDot className="h-3.5 w-3.5" aria-hidden />, hint: 'Contratos operacionais validados — os únicos que compõem métrica oficial.' },
  { key: 'demo', label: 'Demonstração', icon: <FlaskConical className="h-3.5 w-3.5" aria-hidden />, hint: 'Fixtures de desenvolvimento e demonstração.' },
  { key: 'unclassified', label: 'Não classificados', icon: <HelpCircle className="h-3.5 w-3.5" aria-hidden />, hint: 'Origem ainda não validada. Não entram em métrica oficial.' },
  { key: 'all', label: 'Todos', icon: <Layers className="h-3.5 w-3.5" aria-hidden />, hint: 'Tudo que existe na base, independente da origem.' },
];

/** Um contrato pertence ao escopo? `all` aceita qualquer origem. */
export function matchesScope(dataClass: ContractDataClass, scope: PortfolioScopeKey): boolean {
  return scope === 'all' || dataClass === scope;
}

export interface PortfolioScopeBarProps {
  scope: PortfolioScopeKey;
  onScopeChange: (scope: PortfolioScopeKey) => void;
  counts: { live: number; demo: number; unclassified: number; total: number };
  className?: string;
}

export function PortfolioScopeBar({ scope, onScopeChange, counts, className }: PortfolioScopeBarProps) {
  const countOf = (key: PortfolioScopeKey) => (key === 'all' ? counts.total : counts[key]);

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Escopo da carteira">
        {PORTFOLIO_SCOPES.map((item) => {
          const active = scope === item.key;
          const n = countOf(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onScopeChange(item.key)}
              aria-pressed={active}
              title={item.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 transition-all',
                'text-ig-caption font-medium',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                active
                  ? 'border-ig-accent/55 bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)] text-ig-accent'
                  : 'border-ig-border-subtle text-ig-fg-muted hover:border-ig-border-focus hover:text-ig-fg-strong',
                n === 0 && !active && 'opacity-55',
              )}
            >
              <span className={active ? 'text-ig-accent' : 'text-ig-fg-subtle'}>{item.icon}</span>
              {item.label}
              <span className="ig-tabular font-semibold">{n}</span>
            </button>
          );
        })}
      </div>

      {/*
        A frase de composição fica sempre visível, mesmo fora do escopo "ao
        vivo": é ela que impede o usuário de confundir o recorte que está vendo
        com a carteira da empresa.
      */}
      <p className="text-ig-caption text-ig-fg-subtle">
        <span className="ig-tabular font-semibold text-ig-fg-muted">{counts.live}</span> ao vivo
        <span className="mx-1.5" aria-hidden>·</span>
        <span className="ig-tabular font-semibold text-ig-fg-muted">{counts.demo}</span> demonstração
        <span className="mx-1.5" aria-hidden>·</span>
        <span className="ig-tabular font-semibold text-ig-fg-muted">{counts.unclassified}</span> não classificados
      </p>
    </div>
  );
}

/**
 * Selo de origem para uma linha da carteira.
 *
 * `live` não recebe selo: marcar o normal transforma o selo em ruído e faz o
 * olho parar de enxergá-lo justamente quando ele importa.
 */
export function DataClassBadge({ dataClass, className }: { dataClass: ContractDataClass; className?: string }) {
  if (dataClass === 'live') return null;

  const isDemo = dataClass === 'demo';
  return (
    <span
      title={isDemo
        ? 'Contrato de demonstração — não compõe métrica oficial da carteira.'
        : 'Origem ainda não validada — não compõe métrica oficial da carteira.'}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[6px] border px-1.5 py-px text-[11px] font-semibold',
        isDemo
          ? 'border-[color-mix(in_oklab,var(--ig-warning)_38%,transparent)] text-ig-warning'
          : 'border-ig-border-strong text-ig-fg-subtle',
        className,
      )}
    >
      {isDemo ? <FlaskConical className="h-3 w-3" aria-hidden /> : <HelpCircle className="h-3 w-3" aria-hidden />}
      {isDemo ? 'Demonstração' : 'Não classificado'}
    </span>
  );
}

/**
 * Aviso contextual de origem — a porta discreta para o controle avançado.
 *
 * Só aparece quando existe registro fora da carteira oficial. Numa base
 * inteiramente operacional — que é o estado desejado — a interface não gasta
 * uma linha sequer com taxonomia de dados.
 */
export function PortfolioScopeNotice({
  scope,
  onScopeChange,
  counts,
  className,
}: PortfolioScopeBarProps) {
  const outside = counts.demo + counts.unclassified;
  const [open, setOpen] = useState(false);

  // Nada fora da oficial e nenhum filtro aplicado: não há o que dizer.
  if (outside === 0 && scope === 'live') return null;

  const scopeLabel = PORTFOLIO_SCOPES.find((s) => s.key === scope)?.label ?? '';

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      {scope !== 'live' ? (
        /*
          Filtro fora do padrão fica EXPLÍCITO e com saída à mão: um usuário que
          esqueceu o recorte ligado leria números que não são os da empresa.
        */
        <span className="inline-flex items-center gap-2 rounded-[8px] border border-ig-warning/45 bg-[color-mix(in_oklab,var(--ig-warning)_9%,transparent)] px-2.5 py-1">
          <FlaskConical className="h-3.5 w-3.5 text-ig-warning" aria-hidden />
          <span className="text-ig-caption text-ig-fg-strong">
            Exibindo <strong>{scopeLabel}</strong> — fora da carteira oficial
          </span>
          <button
            type="button"
            onClick={() => onScopeChange('live')}
            className="rounded text-ig-caption font-semibold text-ig-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
          >
            voltar à carteira oficial
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded text-ig-caption text-ig-fg-subtle transition-colors hover:text-ig-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          {outside} registro(s) fora da carteira oficial
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      )}

      {open && scope === 'live' && (
        <PortfolioScopeBar scope={scope} onScopeChange={onScopeChange} counts={counts} />
      )}
    </div>
  );
}

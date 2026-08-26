'use client';

/**
 * Hero da carteira — a superfície executiva do Command Center (MD §11).
 *
 * Uma mensagem primária: quanto está exposto. Execução responde em segunda voz,
 * faturado/backlog em terceira, e a composição da carteira fica declarada no
 * rodapé para que ninguém confunda o recorte com a realidade da empresa.
 *
 * Com um único contrato ao vivo, o hero mostra um contrato — não completa o
 * espaço com demonstração.
 */

import { cn } from '@/lib/utils';
import { Landmark, TrendingUp, Receipt, Activity } from 'lucide-react';
import { HudProgressBar } from '@/components/hud';
import { TrustedValue, TrustedCoverage } from './TrustedValue';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import { officialProvenance } from '@/lib/contracts/trust/format';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

export interface PortfolioHeroProps {
  stats: TrustedPortfolioStats;
  /** Dimensões de saúde apuradas na carteira, sobre o total possível. */
  healthCoverage: { assessed: number; total: number };
  className?: string;
}

export function PortfolioHero({ stats, healthCoverage, className }: PortfolioHeroProps) {
  const outsideOfficial = stats.scope.demo + stats.scope.unclassified;
  const pct = hasOfficialValue(stats.billedPct) ? Math.round(stats.billedPct.value * 100) : null;
  const single = stats.contractCount === 1;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-ig-border-focus/40',
        'bg-[linear-gradient(150deg,color-mix(in_oklab,var(--ig-bg-panel)_95%,transparent)_0%,color-mix(in_oklab,var(--ig-bg-raised)_55%,transparent)_58%,transparent_100%)]',
        'px-6 py-6 shadow-[var(--ig-shadow-e3)]',
        className,
      )}
      aria-label="Exposição da carteira oficial"
    >
      {/* Trilho de acento e brilho superior — profundidade sem neon (MD §73). */}
      <span
        className="pointer-events-none absolute inset-y-6 left-0 w-px bg-ig-accent shadow-[0_0_18px_color-mix(in_oklab,var(--ig-accent)_75%,transparent)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--ig-accent)_60%,transparent),transparent)]"
        aria-hidden
      />

      {/*
        Composição assimétrica em TRÊS partes: exposição domina, cobertura de
        apuração ocupa o miolo, faturado/backlog fecham.

        O miolo existia vazio — a coluna da esquerda tinha `1.35fr` e conteúdo
        curto, deixando um rasgo branco no meio da melhor área da página. O que
        entrou ali não é enfeite nem gráfico de ocasião: é a cobertura de saúde,
        que É dado apurado (5/6 dimensões) e responde "o quanto do que importa
        neste contrato já pôde ser avaliado?". Nenhuma série foi desenhada onde
        não há registro — com um contrato e zero faturamento, um gráfico de
        execução seria linha reta em cima do eixo, decoração vendida como
        informação.
      */}
      <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.7fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.16em] text-ig-fg-muted">
            <Landmark className="h-3.5 w-3.5 text-ig-accent" aria-hidden />
            Exposição contratada
          </p>
          <div className="mt-2">
            <TrustedValue
              value={stats.totalValue}
              format={(v) => BRL.format(v)}
              size="hero"
              metallic
              missingLabel="Carteira não apurada"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-ig-body-sm text-ig-fg-muted">
              {stats.contractCount === 0
                ? 'nenhum contrato operacional'
                : `${stats.contractCount} ${single ? 'contrato operacional' : 'contratos operacionais'}`}
            </p>
            <TrustedCoverage value={stats.totalValue} />
          </div>
        </div>

        <CoverageMeter assessed={healthCoverage.assessed} total={healthCoverage.total} />

        <div className="grid grid-cols-2 gap-3">
          <HeroCell
            icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
            label="Faturado"
            value={stats.billedValue}
            accent="success"
          />
          <HeroCell
            icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />}
            label="Backlog"
            value={stats.remainingValue}
            accent="warning"
          />
        </div>
      </div>

      {/*
        Execução financeira.

        A barra só pinta com apuração — 0% seria lido como "nada executado".
        E a AUSÊNCIA ocupa uma linha, não um bloco: antes, "não apurada"
        consumia rótulo, trilho tracejado de largura inteira e linha de
        proveniência — cinco alturas de texto para dizer que não há dado, mais
        massa visual que a própria métrica apurada ao lado. Quando não há
        medição, o herói não deve gastar sua melhor área anunciando isso.
      */}
      {pct === null ? (
        /*
          Linha compacta, porém LEGÍVEL.

          A versão anterior era toda `text-fg-subtle` sobre vidro e sumia — uma
          informação que o usuário precisa encontrar quando procura, ainda que
          não deva competir com a métrica herói. A hierarquia agora vem do
          tamanho (que continua o menor da faixa) e de um trilho lateral, não
          de apagar o texto até o limite da legibilidade.
        */
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-l-2 border-ig-border-strong pl-2.5 text-ig-caption">
          <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
            Execução financeira
          </span>
          <span className="font-semibold text-ig-fg-strong">
            {isError(stats.billedPct) ? 'dados indisponíveis' : 'não apurada'}
          </span>
          <span className="text-ig-fg-muted">· {officialProvenance(stats.billedValue)}</span>
        </p>
      ) : (
        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
              Execução financeira
            </span>
            <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">{pct}%</span>
          </div>
          <HudProgressBar value={pct} size="md" showLabel={false} variant="success" />
        </div>
      )}

      {/*
        Rodapé de composição — SÓ quando há o que declarar.

        A linha "N ao vivo · N demonstração · N não classificados" existe para
        impedir que alguém confunda o recorte com a realidade da empresa. Numa
        base inteiramente oficial ela não impede confusão nenhuma: repete que
        tudo é oficial usando o vocabulário interno de `data_class`, na área
        mais nobre da tela, para um gestor que não precisa conhecer essa
        taxonomia. Quando existe registro fora da carteira oficial, a
        declaração volta — porque aí ela de fato protege uma leitura.
      */}
      {outsideOfficial > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ig-border-subtle pt-3.5">
          <span className="text-ig-caption text-ig-fg-subtle">
            Exibindo a carteira oficial ·{' '}
            <span className="ig-tabular font-semibold text-ig-fg-muted">{outsideOfficial}</span>{' '}
            registro(s) de outra origem fora desta soma
          </span>
        </div>
      )}
    </section>
  );
}

function HeroCell({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: Official<number>;
  accent: 'success' | 'warning';
}) {
  const measured = hasOfficialValue(value);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[14px] border px-4 py-3.5',
        measured
          ? 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_60%,transparent)]'
          : 'border-dashed border-ig-border-subtle',
      )}
    >
      {measured && (
        <span
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-px',
            accent === 'success'
              ? 'bg-[linear-gradient(90deg,transparent,var(--ig-success),transparent)]'
              : 'bg-[linear-gradient(90deg,transparent,var(--ig-warning),transparent)]',
          )}
          aria-hidden
        />
      )}
      <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.12em] text-ig-fg-muted">
        <span className="text-ig-fg-subtle">{icon}</span>
        {label}
      </p>
      <div className="mt-1">
        <TrustedValue value={value} format={(v) => BRL.format(v)} size="lg" />
      </div>
      <TrustedCoverage value={value} className="mt-0.5 block" />
    </div>
  );
}

/**
 * Cobertura de apuração da saúde da carteira.
 *
 * Segmentos, não porcentagem: `5/6` é uma contagem de DIMENSÕES avaliadas, e
 * transformá-la em "83%" sugeriria uma nota de saúde — que é outra coisa
 * inteiramente. O que se lê aqui é quanto do diagnóstico foi possível fazer,
 * não quão saudável o contrato está.
 */
function CoverageMeter({ assessed, total }: { assessed: number; total: number }) {
  const missing = Math.max(0, total - assessed);
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
        <Activity className="h-3.5 w-3.5 text-ig-fg-subtle" aria-hidden />
        Saúde apurada
      </p>
      <p className="ig-tabular mt-2 text-ig-kpi-md leading-none text-ig-fg-strong">
        {assessed}<span className="text-ig-h3 font-medium text-ig-fg-subtle">/{total}</span>
      </p>
      {/*
        Segmentos até 12 dimensões; acima disso, trilho contínuo.
        Com uma carteira grande o total cresce de 6 em 6 e os segmentos ficam
        finos demais para serem contados — viram textura, não medida. O trilho
        contínuo continua honesto porque o número acima permanece sendo a
        leitura principal; a barra é só a proporção.
      */}
      <div
        className="mt-2"
        role="img"
        aria-label={`${assessed} de ${total} dimensões de saúde apuradas`}
      >
        {total <= 12 ? (
          <div className="flex gap-1">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  i < assessed ? 'bg-ig-accent' : 'border border-dashed border-ig-border-strong',
                )}
                aria-hidden
              />
            ))}
          </div>
        ) : (
          <div className="h-1.5 w-full overflow-hidden rounded-full border border-dashed border-ig-border-strong" aria-hidden>
            <div
              className="h-full rounded-full bg-ig-accent"
              style={{ width: `${total > 0 ? Math.round((assessed / total) * 100) : 0}%` }}
            />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-ig-caption text-ig-fg-subtle">
        {missing === 0 ? 'todas as dimensões avaliadas' : `${missing} sem dado para avaliar`}
      </p>
    </div>
  );
}

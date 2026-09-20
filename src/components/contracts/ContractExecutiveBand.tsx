'use client';

/**
 * Executive KPI band — the single command strip AND the primary filtering
 * system of the Contratos control room. The former "Filtros de governança"
 * panel was removed: every cell except the hero and "Valor faturado" is a
 * single-select filter toggle over the whole portfolio (click to filter,
 * click again to clear, click another cell to replace).
 *
 *  Tier 1 (financial): Exposição total (hero, with execution progress + SLA
 *  footnote) · Valor faturado · Saldo a faturar.
 *  Tier 2 (operational alerts): A vencer · Alto risco · Docs faltantes ·
 *  Revisão jurídica.
 *  Tier 3 (governance gaps): Sem projeto · Sem faturamento · Obrigações
 *  atrasadas.
 *
 * ─── Proveniência (P0.3) ───────────────────────────────────────────────────
 *
 * A band consome `TrustedPortfolioStats`, não números crus. Cada célula
 * resolve seu próprio estado: valor apurado imprime o número; ausência imprime
 * "—" ou "Não apurado"; falha de leitura imprime "indisponível" com tom de
 * perigo. Nenhuma célula pode mais exibir um valor fabricado — o tipo não
 * carrega valor sintético até aqui.
 *
 * O layout é o mesmo de antes de propósito: esta fase corrige a VERDADE do
 * conteúdo, não o desenho.
 */

import { cn } from '@/lib/utils';
import { HudSignal } from '@/components/hud';
import { HudProgressBar } from '@/components/hud';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import {
  officialCurrencyCompact, officialCount, officialPercent, officialProgress,
  officialProvenance,
} from '@/lib/contracts/trust/format';
import { hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import {
  Archive,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileSearch,
  Receipt,
  Scale,
  ShieldAlert,
  Workflow,
} from 'lucide-react';

/**
 * A band agora recebe o agregado confiável. `ContractExecutiveStats` (números
 * crus) deixou de existir: aceitar `number` seria aceitar de volta o caminho
 * em que ausência e ficção chegam formatadas como medição.
 */
export type ContractExecutiveStats = TrustedPortfolioStats;

export interface ContractExecutiveBandProps {
  stats: ContractExecutiveStats;
  contractCount: number;
  /** Single-select: the currently active KPI filter key, or null. */
  activeFilter: string | null;
  onToggleFilter: (key: string) => void;
  className?: string;
  /**
   * Omite a célula de exposição/execução.
   *
   * Na Visão Geral o `PortfolioHero` logo acima já responde exposição, execução,
   * faturado e backlog. Repetir a mesma resposta duas vezes na mesma tela não
   * acrescenta leitura — o que a faixa contribui ali são os OITO sinais
   * operacionais, que também são os filtros da carteira.
   */
  hideExposure?: boolean;
  /**
   * Faixa de APOIO, não centro da página.
   *
   * Na Visão Geral esta banda vive recolhida sob "Indicadores e filtros": ela é
   * a ferramenta de recorte da carteira, e quando aberta competia com os sinais
   * operacionais — oito células com número em 20px, borda de seção e um
   * subtítulo próprio, logo abaixo da torre de controle.
   *
   * `compact` tira a moldura da seção, encolhe os números uma marcha e adensa
   * a grade para oito colunas. Continua clicável e continua dizendo a mesma
   * coisa; só para de gritar.
   */
  compact?: boolean;
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ig-fg-strong',
  success: 'text-ig-success',
  warning: 'text-ig-warning',
  danger: 'text-ig-danger',
  info: 'text-ig-accent',
};

/*
  Coluna, não cartão (§4 do gate).
  Cada célula tinha borda, gradiente diagonal próprio e sombra interna: oito
  indicadores viravam oito retângulos flutuantes, com oito linhas de base
  diferentes — e comparar "a vencer" com "alto risco" exigia pular de caixa em
  caixa em vez de varrer uma coluna. Sem moldura, os rótulos alinham entre si e
  os valores também; o divisor da grade faz a separação.
*/
const CELL_SURFACE = 'relative min-w-0';

/**
 * Estado visual da célula — quatro, não dois.
 *
 * `tone` sozinho não distinguia SAUDÁVEL de NÃO APURADO: os dois chegavam como
 * `default`, e "nenhum contrato a vencer" (uma boa notícia medida) ficava com
 * exatamente a mesma aparência de "não consegui apurar". São leituras opostas.
 *
 * `measured` resolve isso sem tocar em nenhum número: tom neutro COM apuração
 * é saúde; tom neutro SEM apuração é desconhecido.
 */
type CellState = 'critical' | 'warning' | 'info' | 'healthy' | 'unknown';

const STATE_DOT: Record<CellState, string> = {
  critical: 'bg-ig-danger shadow-[0_0_0_3px_color-mix(in_oklab,var(--ig-danger)_16%,transparent)]',
  warning: 'bg-ig-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--ig-warning)_16%,transparent)]',
  info: 'bg-ig-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--ig-accent)_16%,transparent)]',
  healthy: 'bg-ig-success/70',
  unknown: 'bg-ig-border-strong',
};

const STATE_VALUE: Record<CellState, string> = {
  critical: 'text-ig-danger',
  warning: 'text-ig-warning',
  info: 'text-ig-accent',
  healthy: 'text-ig-fg-strong',
  unknown: 'text-ig-fg-subtle',
};

function cellState(tone: Tone, measured: boolean): CellState {
  if (tone === 'danger') return 'critical';
  if (tone === 'warning') return 'warning';
  if (tone === 'info') return 'info';
  if (tone === 'success') return 'healthy';
  return measured ? 'healthy' : 'unknown';
}

function MetricCell({
  icon,
  label,
  value,
  sub,
  tone = 'default',
  size = 'md',
  compact = false,
  measured = true,
  onClick,
  active,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  /** 'lg' = financial tier, 'md' = operational alert tier. */
  size?: 'md' | 'lg';
  compact?: boolean;
  /** Se o indicador tem apuração por trás. Separa saúde de desconhecido. */
  measured?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  if (compact) {
    return (
      <CompactMetricCell
        icon={icon} label={label} value={value} sub={sub}
        state={cellState(tone, measured)} onClick={onClick} active={active}
      />
    );
  }
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      title={onClick ? (active ? 'Remover filtro deste sinal' : 'Filtrar carteira por este sinal') : undefined}
      className={cn(
        CELL_SURFACE,
        'group -mx-1 rounded-md px-1 py-0.5 text-left transition-colors duration-150',
        compact ? 'md:pl-3' : 'md:pl-5',
        onClick && [
          'cursor-pointer hover:bg-ig-bg-panel-hover',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
        ],
        // O filtro ativo se marca por tinta de acento — não por elevação, que
        // faria um indicador filtrado parecer flutuar sobre os irmãos.
        active && 'bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]',
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px bg-ig-accent transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className={cn('flex items-center gap-1.5', active ? 'text-ig-accent' : 'text-ig-fg-muted')}>
        {icon && <span className={cn('shrink-0', active ? 'text-ig-accent' : 'text-ig-fg-subtle')}>{icon}</span>}
        {/* Caixa de sentença: resto do §14, que a varredura por `tracking-` não pegou. */}
        <span className="truncate text-ig-caption text-ig-fg-muted">{label}</span>
        {/* Non-color active indication (a11y): explicit "filtro" tag, not just tint */}
        {active && <HudSignal variant="inline" size="sm" tone="accent" label="filtro" className="ml-auto shrink-0" />}
      </div>
      <p
        className={cn(
          'ig-tabular mt-1 truncate leading-tight',
          compact ? 'text-ig-body' : size === 'lg' ? 'text-xl' : 'text-lg',
          active ? 'font-bold' : 'font-semibold',
          TONE_TEXT[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className={cn('mt-0.5 truncate text-[11px]', active ? 'text-ig-fg-strong' : 'text-ig-fg-muted')}>{sub}</p>}
    </Comp>
  );
}

/**
 * Célula compacta do sumário executivo.
 *
 * Ponto de estado à esquerda, rótulo em cima, número embaixo, apoio em micro.
 * Sem moldura: quem agrupa é o cabeçalho do grupo e o fio da grade. O filtro
 * ativo acende tinta de acento e um trilho à esquerda — não uma borda.
 */
function CompactMetricCell({
  icon, label, value, sub, state, onClick, active,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  state: CellState;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      title={onClick ? (active ? 'Remover filtro deste sinal' : 'Filtrar carteira por este sinal') : undefined}
      className={cn(
        'group relative min-w-0 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150',
        onClick && [
          'cursor-pointer hover:bg-[color-mix(in_oklab,var(--ig-bg-raised)_60%,transparent)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        ],
        active && 'bg-[color-mix(in_oklab,var(--ig-accent)_12%,transparent)]',
      )}
    >
      {active && (
        <span className="pointer-events-none absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-ig-accent" aria-hidden />
      )}

      <span className="flex items-center gap-1.5">
        <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full', STATE_DOT[state])} aria-hidden />
        <span className={cn('min-w-0 truncate text-ig-caption', active ? 'text-ig-accent' : 'text-ig-fg-muted')}>
          {label}
        </span>
        {icon && (
          <span className="ml-auto shrink-0 text-ig-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 [&_svg]:h-3 [&_svg]:w-3">
            {icon}
          </span>
        )}
      </span>

      <span className={cn('ig-tabular mt-1 block truncate text-ig-h3 leading-none', active ? 'font-bold text-ig-accent' : STATE_VALUE[state])}>
        {value}
      </span>

      {sub && <span className="mt-1 block truncate text-[10.5px] leading-tight text-ig-fg-subtle">{sub}</span>}
    </Comp>
  );
}

/**
 * Grupo do sumário compacto. Fora de `compact` é transparente: os mesmos
 * filhos caem na grade plana de sempre, sem cabeçalho e sem wrapper.
 */
function Group({
  compact, label, cols, children,
}: {
  compact: boolean; label: string; cols: string; children: React.ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <section>
      <GroupHead label={label} />
      <div className={cn('-mx-1 grid gap-x-1 gap-y-1', cols)}>{children}</div>
    </section>
  );
}

/** Cabeceira de grupo do sumário: rótulo micro e um fio que o estende. */
function GroupHead({ label }: { label: string }) {
  return (
    <header className="mb-1 flex items-center gap-2">
      <h4 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</h4>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--ig-border-subtle),transparent)]" aria-hidden />
    </header>
  );
}

export function ContractExecutiveBand({
  stats,
  contractCount,
  activeFilter,
  onToggleFilter,
  className,
  hideExposure = false,
  compact = false,
}: ContractExecutiveBandProps) {
  const isActive = (key: string) => activeFilter === key;

  return (
    <section
      aria-label="Resumo executivo da carteira oficial — clique em um indicador para filtrar"
      className={cn(
        // Superfície de seção (L2): borda de 1px e tinta, sem sombra e sem
        // gradiente. Os trilhos de glow nas laterais eram decoração pura.
        //
        // Em `compact` nem isso: dentro de um disclosure a moldura seria a
        // terceira caixa aninhada, e o disclosure já delimita a área.
        //
        // Em `compact` a band NÃO desenha superfície nem cabeçalho: ela vive
        // dentro de um `OverviewBlock`, que já é o vidro e já carrega o título,
        // a contagem e o chevron. Desenhar os dois aqui produziria vidro dentro
        // de vidro e dois títulos para a mesma coisa.
        compact ? '' : 'ig-section overflow-hidden px-4 py-3',
        className,
      )}
    >

      {/*
        A band SEMPRE descreve a carteira oficial, independentemente do recorte
        escolhido na tela — e as abas operacionais descrevem o recorte. Sem este
        rótulo, "obrigações atrasadas 0" da band e "em atraso 2" da torre
        aparecem na mesma tela lendo como contradição, quando na verdade são
        duas perguntas diferentes.
      */}
      {!compact && (
        <p className="pb-2 text-ig-caption font-semibold text-ig-fg-muted">
          Carteira oficial · origem validada
        </p>
      )}

      <div
        className={cn(
          compact
            /*
              Três GRUPOS empilhados, não oito células soltas numa fita.
              A fita de oito colunas punha "Valor faturado" e "Obrigações
              atrasadas" lado a lado, com o mesmo peso — dinheiro e pendência
              operacional lidos como se fossem a mesma categoria.
            */
            ? 'relative space-y-3'
            : 'relative grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4 md:divide-x md:divide-ig-border-subtle',
        )}
      >
        {/* Tier 1 — hero: exposição + execução */}
        {!hideExposure && (
        <div className={cn(CELL_SURFACE, 'col-span-2 md:pr-5')}>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-ig-label font-semibold text-ig-fg-muted">Exposição total</p>
              <p className="ig-tabular mt-0.5 truncate text-ig-kpi-md leading-tight text-ig-fg-strong">
                {officialCurrencyCompact(stats.totalValue)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-ig-label font-semibold text-ig-fg-muted">Execução</p>
              <p className="ig-tabular mt-0.5 text-lg font-semibold leading-tight text-ig-fg-strong">{officialPercent(stats.billedPct)}</p>
            </div>
          </div>
          {/* Sem execução apurada a barra não desenha: 0% mentiria por omissão. */}
          <HudProgressBar value={officialProgress(stats.billedPct) ?? 0} size="sm" variant={hasOfficialValue(stats.billedPct) ? 'success' : 'default'} className="mt-2.5" />
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-ig-fg-muted">
            <span className="truncate">
              {contractCount} contrato{contractCount === 1 ? '' : 's'} · faturado {officialCurrencyCompact(stats.billedValue)}
            </span>
            {/*
              O SLA médio saía de uma heurística (`18 + risco/n`) apresentada
              como medição. Sem `contract_approvals` real não há SLA, e a band
              passa a dizer isso em vez de inventar um número.
            */}
            <span className="ig-tabular shrink-0" title={officialProvenance(stats.contractsWithoutProject)}>
              {contractCount === 0 ? 'carteira vazia' : 'proveniência por célula'}
            </span>
          </div>
        </div>
        )}

        <Group compact={compact} label="Financeiro" cols="grid-cols-2">
        <MetricCell compact={compact}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Valor faturado"
          measured={hasOfficialValue(stats.billedValue)}
          value={officialCurrencyCompact(stats.billedValue)}
          sub={hasOfficialValue(stats.billedPct) ? `${officialPercent(stats.billedPct)} executado` : officialProvenance(stats.billedValue)}
          tone={isError(stats.billedValue) ? 'danger' : hasOfficialValue(stats.billedValue) ? 'success' : 'default'}
          size="lg"
        />
        <MetricCell compact={compact}
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Saldo a faturar"
          measured={hasOfficialValue(stats.remainingValue)}
          value={officialCurrencyCompact(stats.remainingValue)}
          sub={hasOfficialValue(stats.backlogPct) ? `${officialPercent(stats.backlogPct)} da exposição` : officialProvenance(stats.remainingValue)}
          tone={isError(stats.remainingValue) ? 'danger' : hasOfficialValue(stats.remainingValue) ? 'warning' : 'default'}
          size="lg"
          onClick={() => onToggleFilter('saldo_a_faturar')}
          active={isActive('saldo_a_faturar')}
        />
        </Group>

        {/* Tier 2 — sinais operacionais (todos filtram a carteira) */}
        <Group compact={compact} label="Sinais operacionais" cols="grid-cols-2 lg:grid-cols-4">
        <MetricCell compact={compact}
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Contratos a vencer"
          measured={hasOfficialValue(stats.expiring90)}
          value={officialCount(stats.expiring90)}
          sub={hasOfficialValue(stats.expiring90)
            ? (stats.expiring90.value ? `${officialCount(stats.within30)} em ≤30 dias` : 'nenhum em 90 dias')
            : officialProvenance(stats.expiring90)}
          tone={isError(stats.expiring90) ? 'danger' : hasOfficialValue(stats.expiring90) && stats.expiring90.value ? 'warning' : 'default'}
          onClick={() => onToggleFilter('a_vencer')}
          active={isActive('a_vencer')}
        />
        <MetricCell compact={compact}
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
          label="Alto risco"
          measured={hasOfficialValue(stats.highRisk)}
          value={officialCount(stats.highRisk)}
          sub={hasOfficialValue(stats.highRisk) && stats.highRisk.value ? officialCurrencyCompact(stats.highRiskExposure) : 'sob controle'}
          tone={hasOfficialValue(stats.highRisk) && stats.highRisk.value ? 'danger' : 'default'}
          onClick={() => onToggleFilter('alto_risco')}
          active={isActive('alto_risco')}
        />
        <MetricCell compact={compact}
          icon={<Archive className="h-3.5 w-3.5" />}
          label="Docs faltantes"
          measured={hasOfficialValue(stats.pendingDocuments)}
          value={officialCount(stats.pendingDocuments)}
          sub={hasOfficialValue(stats.pendingDocuments)
            ? (stats.pendingDocuments.value ? `${officialCount(stats.contractsWithPendingDocs)} contrato(s)` : 'documentação completa')
            : officialProvenance(stats.pendingDocuments)}
          tone={isError(stats.pendingDocuments) ? 'danger' : hasOfficialValue(stats.pendingDocuments) && stats.pendingDocuments.value ? 'warning' : 'default'}
          onClick={() => onToggleFilter('docs_pendentes')}
          active={isActive('docs_pendentes')}
        />
        <MetricCell compact={compact}
          icon={<Scale className="h-3.5 w-3.5" />}
          label="Revisão jurídica"
          measured={hasOfficialValue(stats.contractsInLegalReview)}
          value={officialCount(stats.contractsInLegalReview)}
          sub={hasOfficialValue(stats.contractsInLegalReview)
            ? (stats.contractsInLegalReview.value ? 'aguardando parecer' : 'sem pendências')
            : officialProvenance(stats.contractsInLegalReview)}
          tone={isError(stats.contractsInLegalReview) ? 'danger' : hasOfficialValue(stats.contractsInLegalReview) && stats.contractsInLegalReview.value ? 'warning' : 'default'}
          onClick={() => onToggleFilter('revisao_juridica')}
          active={isActive('revisao_juridica')}
        />
        </Group>

        {/* Tier 3 — lacunas de governança (absorve os antigos quick filters) */}
        <Group compact={compact} label="Lacunas de governança" cols="grid-cols-2 lg:grid-cols-4">
        <MetricCell compact={compact}
          icon={<Workflow className="h-3.5 w-3.5" />}
          label="Sem projeto"
          measured={hasOfficialValue(stats.contractsWithoutProject)}
          value={officialCount(stats.contractsWithoutProject)}
          sub={hasOfficialValue(stats.contractsWithoutProject)
            ? (stats.contractsWithoutProject.value ? 'sem vínculo de projeto' : 'todos vinculados')
            : officialProvenance(stats.contractsWithoutProject)}
          tone={isError(stats.contractsWithoutProject) ? 'danger' : hasOfficialValue(stats.contractsWithoutProject) && stats.contractsWithoutProject.value ? 'warning' : 'default'}
          onClick={() => onToggleFilter('sem_projeto')}
          active={isActive('sem_projeto')}
        />
        <MetricCell compact={compact}
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="Sem faturamento"
          measured={hasOfficialValue(stats.contractsWithoutBilling)}
          value={officialCount(stats.contractsWithoutBilling)}
          sub={hasOfficialValue(stats.contractsWithoutBilling)
            ? (stats.contractsWithoutBilling.value ? 'sem evento registrado' : 'carteira faturando')
            : officialProvenance(stats.contractsWithoutBilling)}
          tone={isError(stats.contractsWithoutBilling) ? 'danger' : hasOfficialValue(stats.contractsWithoutBilling) && stats.contractsWithoutBilling.value ? 'warning' : 'default'}
          onClick={() => onToggleFilter('sem_faturamento')}
          active={isActive('sem_faturamento')}
        />
        {/*
          "Sem análise IA" descrevia a TECNOLOGIA ausente; "Leitura documental
          pendente" descreve o RESULTADO ausente, que é o que interessa a quem
          opera a carteira. O contador é exatamente o mesmo campo
          (`contractsWithoutAi`), a mesma consulta e o mesmo filtro `sem_ia` —
          nenhum dado mudou, só parou de anunciar o motor.
        */}
        <MetricCell compact={compact}
          icon={<FileSearch className="h-3.5 w-3.5" />}
          label="Leitura documental pendente"
          measured={hasOfficialValue(stats.contractsWithoutAi)}
          value={officialCount(stats.contractsWithoutAi)}
          sub={hasOfficialValue(stats.contractsWithoutAi)
            ? (stats.contractsWithoutAi.value ? 'sem leitura registrada' : 'todos com leitura')
            : officialProvenance(stats.contractsWithoutAi)}
          tone={isError(stats.contractsWithoutAi) ? 'danger' : hasOfficialValue(stats.contractsWithoutAi) && stats.contractsWithoutAi.value ? 'info' : 'default'}
          onClick={() => onToggleFilter('sem_ia')}
          active={isActive('sem_ia')}
        />
        <MetricCell compact={compact}
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          label="Obrigações atrasadas"
          measured={hasOfficialValue(stats.overdueObligations)}
          value={officialCount(stats.overdueObligations)}
          sub={hasOfficialValue(stats.overdueObligations)
            ? (stats.overdueObligations.value ? `${officialCount(stats.contractsWithOverdue)} contrato(s)` : 'em dia')
            : officialProvenance(stats.overdueObligations)}
          tone={isError(stats.overdueObligations) ? 'danger' : hasOfficialValue(stats.overdueObligations) && stats.overdueObligations.value ? 'danger' : 'default'}
          onClick={() => onToggleFilter('obrigacoes_atrasadas')}
          active={isActive('obrigacoes_atrasadas')}
        />
        </Group>
      </div>
    </section>
  );
}

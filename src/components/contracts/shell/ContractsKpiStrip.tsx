'use client';

/**
 * A tira de indicadores de UMA área da carteira.
 *
 * Substitui `PortfolioKpiCards`, que tinha oito métricas fixas repetidas acima
 * de sete áreas. Aqui o conjunto vem de `buildSectionKpis`, que é por área; o
 * componente não sabe nem decide QUAIS são os indicadores — só como um
 * `Official<number>` vira pixel.
 *
 * ─── O único ponto onde ausência vira pixel ───────────────────────────────
 *
 * Um valor `missing` vira "—" com a linha de apoio dizendo o motivo; `error`
 * vira "—" com "indisponível". Nenhum dos dois vira `0`, e nenhum dos dois
 * herda o tom de sucesso ou de alarme do indicador — um alarme sobre uma
 * leitura que falhou é pior que nenhum alarme.
 *
 * ─── Mesmo sistema, sotaque por área ──────────────────────────────────────
 *
 * Sete tiras com o mesmo desenho e rótulos trocados leem como sete cópias da
 * mesma coisa, e o olho passa a pular a primeira dobra por reconhecimento. O
 * `accent` do indicador — que é decidido pela ÁREA, em `section-kpis.ts` —
 * escolhe aqui três coisas, e nenhuma delas altera o sistema visual:
 *
 *   · o VOCABULÁRIO DE ÍCONES: relógio e calendário em Renovações, cifrão e
 *     recibo em Faturamentos, escudo em Aprovações, documento em Documentos;
 *   · a COR DO NÚMERO: domínios de estado (SLA, severidade, governança)
 *     tingem o valor com o tom, porque ali o número É um status; domínios
 *     monetários mantêm o valor metálico, porque dinheiro não é status;
 *   · o que a MICRO-BARRA mede, com o denominador escrito ao lado dela.
 */

import {
  AlarmClock, Activity, AlertOctagon, AlertTriangle, BadgeCheck, CalendarClock,
  CalendarX2, CircleDollarSign, ClipboardCheck, Clock, FileCheck2, FilePlus2,
  FileSignature, FileStack, FileWarning, Gavel, History, Landmark, Layers,
  ListChecks, Receipt, Scale, ShieldAlert, ShieldCheck, ShieldX, Timer,
  TrendingUp, Unlink, Wallet,
} from 'lucide-react';
import { HudKpiStrip, type KpiItem } from '@/components/hud';
import { cn } from '@/lib/utils';
import { hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import type { ContractKpi, ContractKpiAccent } from '@/lib/contracts/trust/section-kpis';
import type { SectionId } from '@/lib/contracts/portfolio-sections';

export interface ContractsKpiStripProps {
  readonly kpis: readonly ContractKpi[];
  readonly className?: string;
  /** Navegação para outra área — a mesma que a sidebar usa. */
  readonly onNavigate?: (section: SectionId) => void;
  /** Liga/desliga o recorte da Executive Band. */
  readonly onFilter?: (filterId: string) => void;
  readonly activeFilterId?: string | null;
}

/** O formato de valor de cada tipo de KPI, no vocabulário do `HudKpiStrip`. */
const FORMAT: Record<ContractKpi['format'], KpiItem['format']> = {
  count: 'auto',
  currency: 'compactCurrency',
  percent: 'percent',
};

/**
 * O ícone de cada indicador, por id.
 *
 * Por ID e não por acento: dentro de Renovações, "a vencer em 30 dias" e
 * "renovações vencidas" são leituras de tempo diferentes, e dar o mesmo
 * relógio às duas desperdiça o único elemento que distingue as células antes
 * de o olho chegar ao rótulo.
 */
const ICON: Record<string, React.ReactNode> = {
  // Visão Geral — identidade e exposição da carteira
  'overview-active': <FileSignature aria-hidden />,
  'overview-decision': <Gavel aria-hidden />,
  'overview-eligible': <Wallet aria-hidden />,
  'overview-renewals': <CalendarClock aria-hidden />,
  'overview-coverage': <Activity aria-hidden />,

  // Contratos — inventário
  'contracts-total': <FileStack aria-hidden />,
  'contracts-exposure': <Landmark aria-hidden />,
  'contracts-signed': <BadgeCheck aria-hidden />,
  'contracts-high-risk': <ShieldAlert aria-hidden />,
  'contracts-no-project': <Unlink aria-hidden />,
  'contracts-no-billing': <Receipt aria-hidden />,

  // Renovações — tempo e janela
  'renewals-30': <AlarmClock aria-hidden />,
  'renewals-60': <Clock aria-hidden />,
  'renewals-90': <CalendarClock aria-hidden />,
  'renewals-value': <Landmark aria-hidden />,
  'renewals-expired': <CalendarX2 aria-hidden />,
  'renewals-pending': <Gavel aria-hidden />,

  // Obrigações — SLA e estado
  'obligations-overdue': <AlertOctagon aria-hidden />,
  'obligations-due': <Timer aria-hidden />,
  'obligations-on-track': <ListChecks aria-hidden />,
  'obligations-unknown': <History aria-hidden />,
  'obligations-no-evidence': <FileWarning aria-hidden />,
  'obligations-closed': <ClipboardCheck aria-hidden />,

  // Faturamentos — dinheiro e progressão
  'billing-contracted': <Landmark aria-hidden />,
  'billing-measured': <Scale aria-hidden />,
  'billing-approved': <BadgeCheck aria-hidden />,
  'billing-billed': <Receipt aria-hidden />,
  'billing-backlog': <TrendingUp aria-hidden />,
  'billing-eligible-count': <CircleDollarSign aria-hidden />,

  // Aprovações — decisão e alçada
  'approvals-governed': <ShieldCheck aria-hidden />,
  'approvals-pending-config': <AlertTriangle aria-hidden />,
  'approvals-awaiting': <Gavel aria-hidden />,
  'approvals-overdue': <ShieldX aria-hidden />,
  'approvals-on-time': <BadgeCheck aria-hidden />,
  'approvals-contracts': <FileSignature aria-hidden />,

  // Riscos & Cláusulas — exposição e severidade
  'risks-linked': <ShieldAlert aria-hidden />,
  'risks-high-contracts': <AlertOctagon aria-hidden />,
  'risks-clauses': <Layers aria-hidden />,
  'risks-penalties': <Gavel aria-hidden />,
  'risks-attention': <AlertTriangle aria-hidden />,
  'risks-exposure': <Landmark aria-hidden />,

  // Documentos — cobertura e versão
  'documents-valid': <FileCheck2 aria-hidden />,
  'documents-pending': <FileWarning aria-hidden />,
  'documents-superseded': <History aria-hidden />,
  'documents-without-primary': <FilePlus2 aria-hidden />,
  'documents-awaiting-approval': <ShieldCheck aria-hidden />,
  'documents-coverage': <Activity aria-hidden />,
};

/**
 * Domínios em que o NÚMERO É UM ESTADO, e por isso herda o tom.
 *
 * Em Obrigações, "3 em atraso" é uma condição, e a cor é parte do que o número
 * diz. Em Faturamentos, "R$ 3,2 mi faturado" é uma quantia: tingi-la de verde
 * afirmaria que o valor é bom, julgamento que o módulo não tem como fazer.
 */
const TINTS_VALUE: ReadonlySet<ContractKpiAccent> = new Set<ContractKpiAccent>([
  'sla', 'severity', 'governance',
]);

/** A cor da micro-barra por domínio. Sempre token, nunca cor solta. */
const BAR_TONE: Record<ContractKpiAccent, string> = {
  time: 'var(--dossier-accent)',
  sla: 'var(--dossier-attention-ink)',
  money: 'var(--dossier-positive-ink)',
  governance: 'var(--dossier-accent)',
  severity: 'var(--dossier-critical-ink)',
  coverage: 'var(--dossier-accent)',
  portfolio: 'var(--dossier-accent)',
};

export function ContractsKpiStrip({
  kpis, className, onNavigate, onFilter, activeFilterId,
}: ContractsKpiStripProps) {
  const items: KpiItem[] = kpis.map((kpi) => {
    const present = hasOfficialValue(kpi.value);
    const absentHint = isError(kpi.value)
      ? 'indisponível'
      : !present
        ? (kpi.value.trust === 'missing' && kpi.value.note) || 'não apurado'
        : undefined;

    const value = present
      // `percent` do HudKpi espera 0–100; a fração canônica vive em 0–1.
      ? (kpi.format === 'percent' ? Math.round(kpi.value.value * 1000) / 10 : kpi.value.value)
      : '—';


    const action = kpi.action;
    const isFilter = action?.kind === 'filter';
    const clickable =
      (action?.kind === 'section' && onNavigate) || (isFilter && onFilter);

    return {
      id: kpi.id,
      label: kpi.label,
      value,
      format: present ? FORMAT[kpi.format] : 'raw',
      /*
        SEM `suffix: '%'`. O formato `percent` do HudKpi já passa por
        `Intl.NumberFormat({ style: 'percent' })`, que escreve o sinal — o
        sufixo somava um segundo e a célula exibia "100% %".
      */
      icon: ICON[kpi.id],
      // Ausência nunca herda tom: um "—" vermelho alarma sobre o que não se sabe.
      variant: present ? (kpi.tone ?? 'default') : 'default',
      tintValue: present && TINTS_VALUE.has(kpi.accent),
      deltaLabel: absentHint ?? kpi.hint,
      // A barra só existe com valor E denominador apurados.
      footer: present && typeof kpi.share === 'number'
        ? <ShareMeter share={kpi.share} label={kpi.shareLabel} accent={kpi.accent} />
        : undefined,
      active: isFilter ? activeFilterId === action.filterId : false,
      onClick: clickable
        ? () => {
            if (action?.kind === 'section') onNavigate?.(action.section);
            else if (action?.kind === 'filter') onFilter?.(action.filterId);
          }
        : undefined,
    };
  });

  return (
    <HudKpiStrip
      kpis={items}
      columns={columnsFor(items.length)}
      size="md"
      className={className}
    />
  );
}

/**
 * Quantas colunas para N indicadores.
 *
 * A regra é que NENHUMA linha fique órfã. Seis em quatro colunas deixam duas
 * na segunda linha; cinco em quatro deixam UMA, sozinha ao lado de um vão do
 * tamanho de três células — que foi o que a Visão Geral passou a mostrar
 * quando a exposição duplicada saiu do conjunto. Seis repartem em três (duas
 * linhas cheias) e cinco cabem em uma linha só.
 */
function columnsFor(n: number): 2 | 3 | 4 | 5 | 6 {
  if (n === 6) return 3;
  if (n === 5) return 5;
  if (n === 4) return 4;
  if (n === 3) return 3;
  return 2;
}

/**
 * A micro-barra da célula: a parcela, e o nome do todo.
 *
 * O denominador fica ESCRITO ao lado. Uma barra sem denominador obriga o leitor
 * a supor sobre o que ela é uma fração — e em sete páginas com sete
 * denominadores diferentes, a suposição erra na maioria das vezes.
 */
function ShareMeter({
  share, label, accent,
}: { share: number; label?: string; accent: ContractKpiAccent }) {
  const pct = Math.round(share * 100);
  /*
    As DUAS BORDAS do arredondamento, e por que as duas importam.

    R$ 143 mil sobre R$ 50 mi é 0,29%, que arredonda para "0% do contratado" —
    ao lado de uma barra visivelmente preenchida e de um valor de R$ 143 mil.
    O rótulo passava a contradizer as outras duas leituras da mesma célula, e a
    que o olho acredita é a que está escrita: "nada foi faturado".

    Na outra ponta, 99,6% vira "100%", que afirma completude onde ainda falta
    saldo. Nas duas pontas o texto muda de forma, não de número.
  */
  const text = pct === 0 && share > 0 ? '<1%'
    : pct === 100 && share < 1 ? '>99%'
      : `${pct}%`;
  return (
    <div className="flex items-center gap-2" title={label ? `${text} ${label}` : text}>
      <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-ig-border-subtle">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          // Fração apurada e minúscula ainda é visível: 0 de largura some, e
          // sumir é o que uma fração não apurada faz — a distinção se perderia.
          style={{ width: `${Math.max(pct, share > 0 ? 2 : 0)}%`, background: BAR_TONE[accent] }}
        />
      </span>
      <span className={cn('ig-tabular shrink-0 text-[10px] text-ig-fg-subtle')}>
        {text}{label ? ` ${label}` : ''}
      </span>
    </div>
  );
}

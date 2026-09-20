'use client';

/**
 * CONTRATO → CAIXA — quanto do valor contratado está virando dinheiro.
 *
 * ─── As duas leituras, e por que são duas ──────────────────────────────────
 *
 * 1. A CADEIA. Cinco estágios — contratado, medido, aprovado, faturado,
 *    recebido — desenhados como barras que partem da mesma origem, de modo que
 *    a queda entre um e o seguinte seja a coisa que o olho encontra primeiro.
 *    É a leitura que existe sempre, porque não depende de data nenhuma.
 *
 * 2. O ACUMULADO. Quando os eventos de faturamento têm data, a área do
 *    FATURADO acumulado aparece acima da cadeia. Ela responde a pergunta que a
 *    cadeia não responde: isto está acelerando ou parou? Uma série só, porque
 *    só o faturamento tem data própria — `cash-timeline.ts` explica os outros
 *    quatro, e por que "recebido" em especial não pode virar linha aqui.
 *
 * ─── O que esta superfície nunca faz ───────────────────────────────────────
 *
 * · Não trata medido como aprovado, aprovado como faturado, nem faturado como
 *   recebido. São quatro afirmações de quatro autoridades diferentes, e a
 *   igualdade entre elas é o erro que este módulo mais persegue.
 * · Não desenha barra para estágio não apurado. "Não integrado" (recebido, sem
 *   razão financeiro) e "não instrumentado" (medido, sem bancada) têm cada um
 *   o seu rótulo, no lugar do número — nunca R$ 0.
 * · Não inventa mês. A curva começa no primeiro mês com evento datado; antes
 *   disso não há linha, porque não há registro, e uma linha no zero afirmaria
 *   que o faturamento era zero.
 */

import { useMemo, useState } from 'react';
import { ArrowDownRight, Unplug, PlugZap, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import type { CashStage, CashStageState } from '@/lib/contracts/trust/contract-to-cash';
import type { CashTimeline } from '@/lib/contracts/analytics/cash-timeline';
import { ChartHead, ChartCoverage, money, moneyFull, TONE_FILL, type ChartTone } from './ChartPrimitives';

export interface PortfolioCashChartProps {
  readonly stages: readonly CashStage[];
  readonly timeline: CashTimeline;
  /** Abre a área de Faturamentos a partir de um estágio da cadeia. */
  readonly onOpenBilling?: () => void;
  readonly className?: string;
}

/** Cada estágio carrega o seu tom. Recebido é o único "positivo": é caixa. */
const STAGE_TONE: Record<CashStage['key'], ChartTone> = {
  contracted: 'neutral',
  measured: 'accent',
  approved: 'accent',
  billed: 'attention',
  received: 'positive',
};

const STATE_CHIP: Record<CashStageState, { label: string; icon: React.ReactNode } | null> = {
  measured: null,
  unmeasured: { label: 'Não apurado', icon: null },
  error: { label: 'Indisponível', icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  'not-instrumented': { label: 'Não instrumentado', icon: <PlugZap className="h-3 w-3" aria-hidden /> },
  'not-integrated': { label: 'Não integrado', icon: <Unplug className="h-3 w-3" aria-hidden /> },
};

const SOURCE: Record<CashStage['key'], string> = {
  contracted: 'cabeçalho do instrumento',
  measured: 'medição operacional / marcos',
  approved: 'rota de aprovação',
  billed: 'eventos de faturamento realizados',
  received: 'razão financeiro',
};

export function PortfolioCashChart({
  stages, timeline, onOpenBilling, className,
}: PortfolioCashChartProps) {
  const base = stages.find((s) => s.key === 'contracted');
  const max = base && hasOfficialValue(base.amount) ? base.amount.value : null;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChartHead
        question="Quanto do valor contratado está virando caixa?"
        source="Cada elo tem autoridade própria: medir não é aprovar, faturar não é receber."
      />

      {timeline.points && <CashCurve timeline={timeline} />}

      <ol className="ig-cash-chain">
        {stages.map((stage, index) => {
          const prev = index > 0 ? stages[index - 1] : null;
          const drop =
            prev && hasOfficialValue(prev.amount) && hasOfficialValue(stage.amount)
              ? prev.amount.value - stage.amount.value
              : null;
          const chip = STATE_CHIP[stage.state];
          const present = hasOfficialValue(stage.amount);
          const width = present && max !== null && max > 0
            ? Math.max(Math.min((stage.amount.value / max) * 100, 100), 1.5)
            : null;

          return (
            <li key={stage.key} className="ig-cash-link">
              <div className="ig-cash-link-head">
                <span className="ig-cash-link-label">{stage.label}</span>
                {present ? (
                  <span
                    className="ig-tabular ig-cash-link-value"
                    title={`${moneyFull(stage.amount.value)} · fonte: ${SOURCE[stage.key]}`}
                  >
                    {money(stage.amount.value)}
                  </span>
                ) : (
                  <span
                    className={cn('ig-cash-link-absent', isError(stage.amount) && 'is-error')}
                    title={stage.note ?? undefined}
                  >
                    {chip?.icon}
                    {chip?.label ?? 'Não apurado'}
                  </span>
                )}
              </div>

              {width === null ? (
                <div
                  className="ig-chart-bar is-absent"
                  role="img"
                  aria-label={`${stage.label}: ${chip?.label ?? 'não apurado'}`}
                />
              ) : (
                <div className="ig-chart-bar">
                  <span style={{ width: `${width}%`, background: TONE_FILL[STAGE_TONE[stage.key]] }} />
                </div>
              )}

              <div className="ig-cash-link-foot">
                <span>{SOURCE[stage.key]}</span>
                {drop !== null && drop > 0 && (
                  <span
                    className="ig-cash-drop"
                    title={`${moneyFull(drop)} não avançou de "${prev!.label}" para "${stage.label}".`}
                  >
                    <ArrowDownRight className="h-3 w-3" aria-hidden />
                    <span className="ig-tabular">{money(drop)}</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <ChartCoverage>
        {describeCoverage(stages, timeline)}
        {onOpenBilling && (
          <>
            {' '}
            <button type="button" className="ig-chart-link" onClick={onOpenBilling}>
              abrir Faturamentos →
            </button>
          </>
        )}
      </ChartCoverage>
    </div>
  );
}

function describeCoverage(stages: readonly CashStage[], timeline: CashTimeline): string {
  const absent = stages.filter((s) => !hasOfficialValue(s.amount));
  const parts: string[] = [];
  if (absent.length > 0) {
    parts.push(`${absent.length} de ${stages.length} elos sem valor apurado (${absent.map((s) => s.label.toLowerCase()).join(', ')}).`);
  } else {
    parts.push('Todos os elos da cadeia foram apurados.');
  }
  if (timeline.undatedBilledCount > 0) {
    parts.push(`${timeline.undatedBilledCount} evento(s) faturado(s) sem data ficam fora da curva.`);
  }
  return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// A curva acumulada
// ═══════════════════════════════════════════════════════════════════════════

const W = 720;
const H = 132;
const PAD = { top: 10, right: 8, bottom: 20, left: 8 };

function CashCurve({ timeline }: { timeline: CashTimeline }) {
  const points = timeline.points!;
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const seriesMax = Math.max(...points.map((p) => p.billed), 1);
    const ceiling = timeline.contractedCeiling;
    /*
      A ESCALA é a da série, não a do teto.

      Escalar pelo contratado achatava a curva contra o eixo sempre que a
      carteira estivesse no começo da execução — que é justamente quando a
      inclinação do faturamento é a informação que importa. O teto só governa a
      escala quando cabe perto dela; acima disso vira uma nota de rodapé na
      legenda, onde o número continua legível sem esmagar o desenho.
    */
    const ceilingFits = ceiling !== null && ceiling <= seriesMax * 1.6;
    const top = ceilingFits ? Math.max(seriesMax, ceiling) : seriesMax;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
    const billedPath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.billed).toFixed(1)}`)
      .join(' ');

    return {
      top, x, innerH,
      billedPath,
      billedArea: `${billedPath} L${x(points.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`,
      ceilingY: ceilingFits ? y(ceiling!) : null,
      ceilingOffScale: ceiling !== null && !ceilingFits,
    };
  }, [points, timeline.contractedCeiling]);

  const active = hover !== null ? points[hover] : points[points.length - 1];

  return (
    <div className="ig-cash-curve">
      <div className="ig-cash-curve-head">
        <span className="ig-cash-curve-title">Acumulado no tempo</span>
        <span className="ig-cash-curve-readout ig-tabular">
          {active.label} · faturado {money(active.billed)} acumulado
          {` · ${active.billedCount} evento(s)`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="ig-cash-curve-svg"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Acumulado de faturamento de ${points[0].label} a ${points[points.length - 1].label}`}
      >
        <defs>
          <linearGradient id="ig-cash-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dossier-attention-ink)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--dossier-attention-ink)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grade: três fios, o suficiente para dar escala sem virar papel milimetrado. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.left} x2={W - PAD.right}
            y1={PAD.top + geometry.innerH * f} y2={PAD.top + geometry.innerH * f}
            stroke="var(--dossier-border-subtle)" strokeWidth="1"
          />
        ))}

        {/*
          O CONTRATADO é teto, não série: linha tracejada horizontal. Desenhá-lo
          como curva exigiria ratear a assinatura pelos meses, que é um critério
          inventado aqui e não uma verdade do contrato.
        */}
        {geometry.ceilingY !== null && geometry.ceilingY >= PAD.top && (
          <line
            x1={PAD.left} x2={W - PAD.right} y1={geometry.ceilingY} y2={geometry.ceilingY}
            stroke="var(--dossier-border-strong)" strokeWidth="1" strokeDasharray="4 4"
          />
        )}

        <path d={geometry.billedArea} fill="url(#ig-cash-fill)" />
        <path d={geometry.billedPath} fill="none" stroke="var(--dossier-attention-ink)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {hover !== null && (
          <line
            x1={geometry.x(hover)} x2={geometry.x(hover)} y1={PAD.top} y2={PAD.top + geometry.innerH}
            stroke="var(--dossier-accent)" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Alvos de leitura: uma faixa por mês, invisível, para hover e foco. */}
        {points.map((p, i) => (
          <rect
            key={p.month}
            x={geometry.x(i) - (W / points.length) / 2}
            y={0}
            width={W / points.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>
              {`${p.label} · faturado acumulado ${moneyFull(p.billed)} em ${p.billedCount} evento(s)`}
            </title>
          </rect>
        ))}
      </svg>

      <div className="ig-cash-curve-axis">
        {points.map((p, i) => (
          // Em janelas longas, um rótulo a cada N meses — nunca rótulo girado.
          <span key={p.month} data-dim={points.length > 8 && i % 2 === 1 ? '' : undefined}>
            {points.length > 8 && i % 2 === 1 ? '' : p.label}
          </span>
        ))}
      </div>

      <ul className="ig-chart-legend">
        <li><i style={{ background: 'var(--dossier-attention-ink)' }} aria-hidden />Faturado acumulado</li>
        {timeline.contractedCeiling !== null && (
          <li>
            <i className="is-rule" aria-hidden />
            {geometry.ceilingOffScale
              // Fora de escala: o número fica, a linha sai. Desenhá-la achataria
              // a curva inteira contra o eixo e o gráfico deixaria de informar.
              ? `Contratado ${money(timeline.contractedCeiling)} — fora da escala`
              : `Contratado (${money(timeline.contractedCeiling)})`}
          </li>
        )}
        {/*
          RECEBIDO não aparece nesta curva, e a ausência é dita. `paid_at` é
          carimbo deste módulo sobre o evento, não confirmação de caixa: a
          cadeia abaixo declara o estágio "não integrado", e duas superfícies
          da mesma tela não podem afirmar coisas diferentes sobre o mesmo fato.
        */}
        <li>
          <i style={{ background: 'none', border: '1px dashed var(--dossier-border-strong)' }} aria-hidden />
          Recebido — depende do razão financeiro
        </li>
      </ul>
    </div>
  );
}

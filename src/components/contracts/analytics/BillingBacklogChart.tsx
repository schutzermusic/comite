'use client';

/**
 * BACKLOG DE RECEITA — o que impede o valor contratado de virar faturável.
 *
 * Uma régua segmentada, não um gráfico de pizza. A pergunta é sobre PROPORÇÃO
 * de um todo conhecido e sobre a ORDEM dos obstáculos — e ordem é exatamente o
 * que uma pizza destrói. A régua mantém a cadeia legível da esquerda (o mais
 * cedo, o mais travado) para a direita (faturado).
 *
 * ─── O que cada segmento significa é dito sem hover ───────────────────────
 *
 * A legenda abaixo da régua traz rótulo, BRL e percentual para os seis
 * segmentos, sempre. O hover acrescenta o valor exato e a explicação do que
 * destrava aquele estágio — mas nada do que é necessário para ler o gráfico
 * depende dele.
 *
 * ─── Ausência ─────────────────────────────────────────────────────────────
 *
 * Um segmento cujos marcos não têm valor registrado entra na régua como trilho
 * tracejado de largura fixa, e a legenda diz quantos marcos são. Ele não some
 * (o trabalho existe) e não ganha área proporcional (o valor não se sabe).
 */

import { cn } from '@/lib/utils';
import { Receipt } from 'lucide-react';
import {
  BACKLOG_STAGE_HINT,
  type BacklogStageKey, type BillingBacklog,
} from '@/lib/contracts/analytics/billing-backlog';
import { ChartHead, ChartCoverage, ChartAbsent, money, moneyFull, pct, TONE_FILL, type ChartTone } from './ChartPrimitives';

export interface BillingBacklogChartProps {
  readonly backlog: BillingBacklog | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Abre Faturamentos já filtrado pelo estágio clicado. */
  readonly onOpenStage?: (stage: BacklogStageKey) => void;
  readonly className?: string;
}

/**
 * O tom sobe conforme o obstáculo se aproxima do caixa. Faturado é positivo;
 * o gatilho não apurado é neutro de propósito — é lacuna de instrumentação,
 * não incidente, e pintá-lo de vermelho pediria urgência que não existe.
 */
const TONE: Record<BacklogStageKey, ChartTone> = {
  trigger_unassessed: 'neutral',
  awaiting_measurement: 'accent',
  awaiting_evidence: 'attention',
  awaiting_acceptance: 'attention',
  eligible: 'positive',
  billed: 'positive',
};

export function BillingBacklogChart({
  backlog, loading, error, onOpenStage, className,
}: BillingBacklogChartProps) {
  if (error) {
    return (
      <div className={className}>
        <ChartHead question="O que impede o valor contratado de virar receita?" source="Bancada de marcos contratuais." />
        <ChartAbsent
          title="Bancada de marcos indisponível"
          detail={error}
        />
      </div>
    );
  }

  if (loading || backlog === null) {
    return (
      <div className={className}>
        <ChartHead question="O que impede o valor contratado de virar receita?" source="Bancada de marcos contratuais." />
        <ChartAbsent
          title="Lendo os marcos contratuais…"
          detail="O direito previsto no instrumento existe desde a assinatura — a repartição aparece assim que a bancada responder."
        />
      </div>
    );
  }

  if (backlog.totalMilestones === 0) {
    return (
      <div className={className}>
        <ChartHead question="O que impede o valor contratado de virar receita?" source="Bancada de marcos contratuais." />
        <ChartAbsent
          title="Nenhum marco contratual neste recorte"
          detail="Sem marco instrumentado não há direito a repartir. Isto é lacuna de configuração, não ausência de receita."
        />
      </div>
    );
  }

  const { segments, base } = backlog;
  const blocked = segments
    .filter((s) => s.key !== 'eligible' && s.key !== 'billed')
    .map((s) => s.amount)
    .filter((v): v is number => v !== null);
  const blockedTotal = blocked.length > 0 ? blocked.reduce((a, b) => a + b, 0) : null;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChartHead
        question="O que impede o valor contratado de virar receita?"
        source="Direito previsto no instrumento, repartido pelo estágio operacional de cada marco."
        aside={
          <span className="ig-chart-aside ig-tabular" title="Soma do direito dos marcos que ainda não podem ser faturados.">
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            {blockedTotal === null ? 'bloqueado não apurado' : `${money(blockedTotal)} bloqueado`}
          </span>
        }
      />

      <div className="ig-backlog-rail" role="img" aria-label="Repartição do direito contratual por estágio operacional">
        {segments.map((segment) => {
          const known = segment.amount !== null && base !== null && base > 0;
          const width = known ? Math.max((segment.amount! / base!) * 100, 1.5) : null;
          if (segment.count === 0 && !known) return null;
          return (
            <i
              key={segment.key}
              data-absent={known ? undefined : ''}
              style={known
                ? { width: `${width}%`, background: TONE_FILL[TONE[segment.key]] }
                : { width: '6%' }}
              title={`${segment.label}: ${moneyFull(segment.amount)} · ${segment.count} marco(s)`}
            />
          );
        })}
      </div>

      <ul className="ig-backlog-legend">
        {segments.map((segment) => {
          const clickable = Boolean(onOpenStage) && segment.count > 0;
          const Row: React.ElementType = clickable ? 'button' : 'div';
          return (
            <li key={segment.key}>
              <Row
                type={clickable ? 'button' : undefined}
                onClick={clickable ? () => onOpenStage?.(segment.key) : undefined}
                className={cn('ig-backlog-row', clickable && 'is-clickable')}
                title={BACKLOG_STAGE_HINT[segment.key]}
              >
                <i
                  aria-hidden
                  style={segment.amount === null
                    ? { background: 'none', border: '1px dashed var(--dossier-border-strong)' }
                    : { background: TONE_FILL[TONE[segment.key]] }}
                />
                <span className="ig-backlog-row-label">{segment.label}</span>
                <span className="ig-backlog-row-count ig-tabular">{segment.count}</span>
                {/*
                  "—" e "Não apurado" são coisas diferentes, e a distinção é a
                  razão de ser desta tela: o traço diz que o estágio está VAZIO
                  (fato apurado: nenhum marco ali), "Não apurado" diz que há
                  marcos e o valor deles não foi registrado. Escrever o mesmo
                  nos dois casos apagaria justamente o trabalho pendente.
                */}
                <span className={cn('ig-backlog-row-money ig-tabular', segment.amount === null && 'is-absent')}>
                  {segment.count === 0 ? '—' : money(segment.amount)}
                </span>
                <span className="ig-backlog-row-pct ig-tabular">{pct(segment.share)}</span>
              </Row>
            </li>
          );
        })}
      </ul>

      <ChartCoverage>
        {`${backlog.coverage.counted} de ${backlog.coverage.total} marcos com direito apurado.`}
        {backlog.unpricedCount > 0
          && ` ${backlog.unpricedCount} sem valor registrado contam no estágio e ficam fora da soma.`}
        {backlog.cancelledCount > 0 && ` ${backlog.cancelledCount} cancelado(s) fora da repartição.`}
      </ChartCoverage>
    </div>
  );
}

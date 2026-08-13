'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart as PieIcon, UserMinus, CalendarDays } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HudEmptyState } from '@/components/hud';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import type { AreaTurnoverPoint, AbsenteeismMonthlyPoint } from '@/lib/workforce/period';

echarts.use([PieChart, BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

/**
 * DISTRIBUIÇÃO POR ÁREA
 * =====================
 * Onde a rotatividade e o absenteísmo se concentram — a leitura que o cockpit
 * não tinha: turnover agregado não diz onde agir, participação por área diz.
 */

/** Paleta categórica do sistema — ordem fixa para a mesma área manter a mesma cor. */
const AREA_PALETTE = [
  '#10B981', '#38BDF8', '#A78BFA', '#F59E0B',
  '#F472B6', '#22D3EE', '#FB923C', '#94A3B8',
];

function useColors(isLight: boolean) {
  return {
    muted: isLight ? 'rgba(51,65,85,0.72)' : 'rgba(242,245,247,0.60)',
    strong: isLight ? '#0f172a' : '#F2F5F7',
    axis: isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)',
    split: isLight ? 'rgba(15,118,110,0.10)' : 'rgba(170,200,190,0.06)',
    tooltipBg: isLight ? '#ffffff' : '#141B24',
    tooltipBorder: isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)',
  };
}

interface TurnoverByAreaPanelProps {
  turnoverByArea: AreaTurnoverPoint[];
  absenteeismMonthly: AbsenteeismMonthlyPoint[];
  className?: string;
}

export function TurnoverByAreaPanel({
  turnoverByArea,
  absenteeismMonthly,
  className,
}: TurnoverByAreaPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const c = useColors(isLight);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    turnoverByArea.forEach((a, i) => map.set(a.area, AREA_PALETTE[i % AREA_PALETTE.length]));
    return map;
  }, [turnoverByArea]);

  // ── Donut: participação nos desligamentos ──
  const donutOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
      textStyle: { color: c.strong, fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number; color: string }) =>
        `<div style="font-weight:600;color:${c.strong}">${p.name}</div>` +
        `<div style="color:${c.muted}">Desligamentos: <b style="color:${c.strong}">${p.value}</b> (${p.percent.toFixed(1)}%)</div>`,
    },
    legend: {
      show: true, bottom: 0, type: 'scroll',
      textStyle: { color: c.muted, fontSize: 10 },
      itemWidth: 9, itemHeight: 9, itemGap: 12,
    },
    series: [{
      type: 'pie',
      radius: ['52%', '76%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderWidth: 2, borderColor: isLight ? '#ffffff' : '#0F1815' },
      label: { show: false },
      emphasis: {
        scaleSize: 6,
        label: {
          show: true, formatter: '{d}%', fontSize: 15, fontWeight: 700, color: c.strong,
        },
      },
      data: turnoverByArea.map((a) => ({
        name: a.area,
        value: a.dismissals,
        itemStyle: { color: colorOf.get(a.area) },
      })),
    }],
  }), [turnoverByArea, colorOf, c, isLight]);

  // ── Barras horizontais: turnover % por área ──
  const barOption = useMemo(() => {
    const sorted = [...turnoverByArea].sort((a, b) => a.turnoverPct - b.turnoverPct);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { name: string; value: number; dataIndex: number }[]) => {
          const p = params[0];
          const row = sorted[p.dataIndex];
          return `<div style="font-weight:600;color:${c.strong}">${p.name}</div>` +
            `<div style="color:${c.muted}">Turnover: <b style="color:${c.strong}">${p.value.toFixed(2)}%</b></div>` +
            `<div style="color:${c.muted}">Desligamentos: <b style="color:${c.strong}">${row.dismissals}</b> de ${row.headcount}</div>`;
        },
      },
      grid: { left: '2%', right: '12%', top: '4%', bottom: '4%', containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      yAxis: {
        type: 'category', data: sorted.map((d) => d.area),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: c.axis, fontSize: 10 },
      },
      series: [{
        type: 'bar',
        barMaxWidth: 16,
        data: sorted.map((d) => ({
          value: d.turnoverPct,
          itemStyle: { color: colorOf.get(d.area), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right', color: c.muted, fontSize: 10,
          formatter: ({ value }: { value: number }) => `${value.toFixed(2)}%`,
        },
      }],
    };
  }, [turnoverByArea, colorOf, c]);

  // ── Barras empilhadas: absenteísmo mensal por área ──
  const stackedOption = useMemo(() => {
    const areas = [...new Set(absenteeismMonthly.flatMap((m) => m.areas.map((a) => a.area)))];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          const total = params.reduce((s, p) => s + (p.value ?? 0), 0);
          let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:4px">${params[0].axisValue} — ${total} dias</div>`;
          [...params].reverse().forEach((p) => {
            if (!p.value) return;
            html += `<div style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:2px;background:${p.color};display:inline-block"></span><span style="color:${c.muted};flex:1">${p.seriesName}</span><b style="color:${c.strong}">${p.value}</b></div>`;
          });
          return html;
        },
      },
      legend: {
        show: true, bottom: 0, type: 'scroll',
        textStyle: { color: c.muted, fontSize: 10 }, itemWidth: 9, itemHeight: 9, itemGap: 12,
      },
      grid: { left: '2%', right: '2%', top: '8%', bottom: '16%', containLabel: true },
      xAxis: {
        type: 'category', data: absenteeismMonthly.map((m) => m.period),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: c.axis, fontSize: 9 },
      },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      series: areas.map((area, i) => ({
        name: area,
        type: 'bar',
        stack: 'faltas',
        barMaxWidth: 26,
        itemStyle: {
          color: colorOf.get(area) ?? AREA_PALETTE[i % AREA_PALETTE.length],
          borderRadius: i === areas.length - 1 ? [3, 3, 0, 0] : 0,
        },
        data: absenteeismMonthly.map((m) => m.areas.find((a) => a.area === area)?.days ?? 0),
      })),
    };
  }, [absenteeismMonthly, colorOf, c]);

  // ── Chips de leitura rápida ──
  const top = turnoverByArea[0];
  const totalDismissals = turnoverByArea.reduce((s, a) => s + a.dismissals, 0);
  /**
   * Com uma única área registrando saídas, um donut vira uma fatia de 100% e o
   * ranking vira uma barra sozinha — forma que sugere concentração onde só há
   * ausência de dado. Abaixo desse limiar mostramos o porquê, não o gráfico.
   */
  const hasTurnoverSignal =
    totalDismissals >= 3 && turnoverByArea.filter((a) => a.dismissals > 0).length >= 2;
  const worstAbsence = absenteeismMonthly.reduce<AbsenteeismMonthlyPoint | null>(
    (acc, m) => (!acc || m.totalDays > acc.totalDays ? m : acc),
    null,
  );

  const chips = [
    {
      icon: UserMinus,
      label: 'Área com mais saídas',
      value: top ? `${top.area} · ${top.sharePct.toFixed(0)}%` : '–',
      color: top && top.sharePct >= 50 ? 'text-ig-danger' : 'text-ig-warning',
    },
    {
      icon: PieIcon,
      label: 'Desligamentos no período',
      value: String(totalDismissals),
      color: 'text-ig-fg-default',
    },
    {
      icon: CalendarDays,
      label: 'Pico de faltas',
      value: worstAbsence ? `${worstAbsence.period} · ${worstAbsence.totalDays}d` : '–',
      color: 'text-ig-info',
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {chips.map((ch) => {
          const Icon = ch.icon;
          return (
            <div key={ch.label} className="flex items-center gap-2.5 rounded-xl border border-ig-border-subtle bg-ig-panel p-3">
              <div className="rounded-lg bg-ig-panel-hover p-1.5">
                <Icon className={cn('h-3.5 w-3.5', ch.color)} />
              </div>
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-semibold ig-tabular', ch.color)}>{ch.value}</p>
                <p className="truncate text-[10px] text-ig-fg-muted">{ch.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {hasTurnoverSignal ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OrionCard variant="elevated">
            <div className="mb-3 flex items-center gap-2">
              <PieIcon className="h-3.5 w-3.5 text-ig-accent" />
              <span className="text-xs font-semibold text-ig-fg-strong">Desligamentos por Área</span>
            </div>
            <div className="h-[230px]">
              <ReactEChartsCore echarts={echarts} option={donutOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
            </div>
          </OrionCard>

          <OrionCard variant="elevated">
            <div className="mb-3 flex items-center gap-2">
              <UserMinus className="h-3.5 w-3.5 text-ig-warning" />
              <span className="text-xs font-semibold text-ig-fg-strong">Turnover por Área (%)</span>
            </div>
            <div className="h-[230px]">
              <ReactEChartsCore echarts={echarts} option={barOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
            </div>
          </OrionCard>
        </div>
      ) : (
        <OrionCard variant="elevated">
          <div className="mb-3 flex items-center gap-2">
            <PieIcon className="h-3.5 w-3.5 text-ig-accent" />
            <span className="text-xs font-semibold text-ig-fg-strong">Distribuição de Desligamentos</span>
          </div>
          <HudEmptyState
            compact
            icon="alert"
            title="Sinal de rotatividade insuficiente no período"
            description={
              'A folha importada traz o valor por centro de custo, mas não o headcount por área. ' +
              'A distribuição de desligamentos e o turnover por área passam a ser calculados quando ' +
              'os eventos S-2200/S-2299 do eSocial forem transmitidos ou o cadastro de Pessoas for vinculado aos centros de custo.'
            }
          />
        </OrionCard>
      )}

      <OrionCard variant="elevated">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 text-ig-info" />
          <span className="text-xs font-semibold text-ig-fg-strong">Absenteísmo por Área × Mês (dias)</span>
        </div>
        <div className="h-[240px]">
          <ReactEChartsCore echarts={echarts} option={stackedOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </OrionCard>
    </div>
  );
}

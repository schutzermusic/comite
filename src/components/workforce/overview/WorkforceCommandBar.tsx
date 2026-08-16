'use client';

/**
 * Barra de comando do cockpit — período, comparação e recorte num lugar só.
 *
 * Reusa `FinanceFilterBar` com os domínios próprios desligados
 * (`showPeriod={false} showScenario={false}`) e tudo passando por `extra`, que
 * é exatamente como a Projeção Financeira monta a dela. A barra já é genérica:
 * as duas props de domínio são opcionais e o conteúdo real vem de fora.
 *
 * NOTA DE ACOPLAMENTO: este é o único ponto do módulo Pessoas & Custos que
 * importa de `@/components/finance/shared`. Duplicar as 312 linhas da barra
 * para evitar o import entre módulos não compraria nada e garantiria que as
 * duas versões divergissem — o contrato de vidro (`ig-glass`, `data-elev`,
 * `data-sweep`) e as larguras dos chips são o que mantém os filtros alinhados
 * entre as telas. Se um dia essas primitivas subirem para
 * `components/shared/filters`, só este arquivo muda.
 */

import { CalendarRange, GitCompareArrows, Palette, Users } from 'lucide-react';
import {
  FinanceFilterBar,
  FinanceFilterSegment,
  FILTER_CHIP_LABEL,
  FILTER_CHIP_SHELL,
} from '@/components/finance/shared';
import { WorkforcePeriodFilter } from '@/components/workforce/WorkforcePeriodFilter';
import { WorkforceUnitFilter } from './WorkforceUnitFilter';
import { comparisonModeAvailable } from '@/lib/workforce/overview/comparison';
import {
  COMPARISON_OPTIONS,
  type ComparisonMode,
  type HeadcountSourceFilter,
  type WorkforceOverviewFilters,
  type WorkforceReportTheme,
  type WorkforceUnit,
} from '@/lib/workforce/overview/types';
import type { WorkforceMonthlyRecord, WorkforcePeriodSelection } from '@/lib/workforce/period';

interface WorkforceCommandBarProps {
  period: WorkforcePeriodSelection;
  onPeriodChange: (next: WorkforcePeriodSelection) => void;
  comparison: ComparisonMode;
  onComparisonChange: (next: ComparisonMode) => void;
  filters: WorkforceOverviewFilters;
  onFiltersChange: (next: WorkforceOverviewFilters) => void;
  units: WorkforceUnit[];
  /** Série completa — define os meses do intervalo e as bases disponíveis. */
  series: WorkforceMonthlyRecord[];
  reportTheme: WorkforceReportTheme;
  onReportThemeChange: (next: WorkforceReportTheme) => void;
  exportSlot?: React.ReactNode;
}

const SOURCE_OPTIONS: { value: HeadcountSourceFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'esocial', label: 'eSocial' },
  { value: 'manual', label: 'Manual' },
];

export function WorkforceCommandBar({
  period,
  onPeriodChange,
  comparison,
  onComparisonChange,
  filters,
  onFiltersChange,
  units,
  series,
  reportTheme,
  onReportThemeChange,
  exportSlot,
}: WorkforceCommandBarProps) {
  /**
   * Modo sem base é oferecido desabilitado, com o motivo visível.
   *
   * Some-lo seria mais limpo e pior: a opção reaparecendo ao trocar de período
   * lê como bug. Desabilitada com explicação, ela ensina a relação entre o
   * período escolhido e a comparação possível.
   */
  const comparisonOptions = COMPARISON_OPTIONS.map((opt) => {
    const available = comparisonModeAvailable(period, series, opt.value);
    return {
      ...opt,
      disabled: !available,
      disabledReason:
        opt.value === 'same-period-last-year'
          ? 'O ano anterior não tem competência apurada neste período'
          : 'O período selecionado não tem janela anterior na série',
    };
  });

  const activeComparison = comparisonOptions.find((o) => o.value === comparison);
  const effectiveComparison: ComparisonMode =
    activeComparison && activeComparison.disabled ? 'none' : comparison;

  return (
    <FinanceFilterBar
      showPeriod={false}
      showScenario={false}
      sticky={false}
      rightSlot={exportSlot}
      extra={
        <>
          <div className="w-full sm:w-auto sm:shrink-0">
            <div className={FILTER_CHIP_SHELL}>
              <span className={FILTER_CHIP_LABEL}>
                <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                Período
              </span>
              <WorkforcePeriodFilter
                value={period}
                onChange={onPeriodChange}
                series={series}
                variant="bare"
              />
            </div>
          </div>

          <FinanceFilterSegment<ComparisonMode>
            icon={<GitCompareArrows className="h-3.5 w-3.5" />}
            label="Comparar"
            value={effectiveComparison}
            options={comparisonOptions}
            onChange={onComparisonChange}
          />

          <WorkforceUnitFilter
            units={units}
            selected={filters.unitIds}
            onChange={(unitIds) => onFiltersChange({ ...filters, unitIds })}
          />

          <FinanceFilterSegment<HeadcountSourceFilter>
            icon={<Users className="h-3.5 w-3.5" />}
            label="Fonte do quadro"
            value={filters.headcountSource}
            options={SOURCE_OPTIONS}
            onChange={(headcountSource) => onFiltersChange({ ...filters, headcountSource })}
          />

          <FinanceFilterSegment<WorkforceReportTheme>
            icon={<Palette className="h-3.5 w-3.5" />}
            label="Tema do relatório"
            value={reportTheme}
            options={[
              { value: 'dark', label: 'Escuro' },
              { value: 'light', label: 'Claro' },
            ]}
            onChange={onReportThemeChange}
          />
        </>
      }
    />
  );
}

'use client';

import { cn } from '@/lib/utils';
import { PAYROLL_STATUS_LABEL } from '@/lib/workforce/compliance';
import type { PayrollClosingStatus } from '@/lib/types/payroll-closing';
import type { MonthlyIndicatorMatrix } from '@/lib/workforce/period';

/**
 * MATRIZ MENSAL DE INDICADORES
 * ============================
 * Fecha a leitura dos gráficos: cada competência em uma linha, com os mesmos
 * indicadores do cockpit e — na última coluna — o estado do envio da folha e
 * das guias daquele mês. Um indicador só é confiável se a competência fechou.
 *
 * ─── Cor marca desvio, não normalidade ─────────────────────────────────────
 *
 * É a regra do cockpit, e `toneFor` abaixo é a sua expressão: uma célula só
 * ganha cor quando cruza um limiar. As colunas de admissões e desligamentos
 * vinham pintadas de verde e vermelho em TODA linha, independentemente do
 * valor — o que dava à tabela inteira um banho de cor que não distinguia nada
 * e destoava dos demais painéis. Num gráfico a cor identifica a SÉRIE; numa
 * tabela o cabeçalho da coluna já faz isso.
 *
 * A moldura também é a do cockpit (`WorkforceChartCard`), e não um cartão com
 * ícone de acento: painel de dado não tem cromo próprio nesta página.
 */

interface CompetenceCompliance {
  payrollStatus: PayrollClosingStatus | 'missing';
  /** 0–100, do snapshot de compliance da competência. */
  score: number;
}

interface WorkforceIndicatorMatrixProps {
  matrix: MonthlyIndicatorMatrix;
  /** Estado de envio por competência (YYYY-MM). Ausente = sem lote. */
  compliance?: Record<string, CompetenceCompliance>;
  className?: string;
}

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    notation: v >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: v >= 1_000_000 ? 2 : 0,
  }).format(v);

const int = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

/** Escala tonal: neutro no saudável, âmbar na atenção, vermelho no risco. */
function toneFor(value: number | null, warn: number, danger: number) {
  if (value === null) return 'text-ig-fg-subtle';
  if (value >= danger) return 'text-ig-danger';
  if (value >= warn) return 'text-ig-warning';
  return 'text-ig-fg-default';
}

/** Indicador não apurado na competência — base ausente, não valor zero. */
const NA = '—';
const pct = (v: number | null, digits = 2) => (v === null ? NA : `${v.toFixed(digits)}%`);
const money = (v: number | null) => (v === null ? NA : brl(v));

function ComplianceCell({ state }: { state?: CompetenceCompliance }) {
  if (!state) {
    return <span className="text-[10.5px] text-ig-fg-subtle">sem lote</span>;
  }
  const tone =
    state.score >= 85 ? 'var(--ig-success)' : state.score >= 60 ? 'var(--ig-warning)' : 'var(--ig-danger)';
  return (
    <span className="inline-flex items-center gap-1.5" title={PAYROLL_STATUS_LABEL[state.payrollStatus]}>
      <span className="h-8 w-1 shrink-0 rounded-full bg-ig-border-subtle">
        <span
          className="block w-full rounded-full"
          style={{ height: `${Math.max(state.score, 4)}%`, background: tone }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold tabular-nums" style={{ color: tone }}>
          {state.score}%
        </span>
        <span className="block truncate text-[9.5px] text-ig-fg-muted">
          {PAYROLL_STATUS_LABEL[state.payrollStatus]}
        </span>
      </span>
    </span>
  );
}

export function WorkforceIndicatorMatrix({
  matrix,
  compliance,
  className,
}: WorkforceIndicatorMatrixProps) {
  const { rows, total } = matrix;

  const headCls = 'px-3 py-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-muted whitespace-nowrap';
  const cellCls = 'px-3 py-2 text-[11.5px] tabular-nums whitespace-nowrap';

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ig-border-subtle',
        'bg-gradient-to-br from-ig-panel to-ig-bg-raised/30',
        className,
      )}
    >
      <div className="border-b border-ig-border-subtle/60 px-4 py-3">
        <h3 className="truncate text-[12.5px] font-semibold tracking-tight text-ig-fg-strong">
          Matriz mensal de indicadores
        </h3>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ig-fg-muted">
          Indicadores por competência e o estado do envio da folha e das guias
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="border-b border-ig-border-subtle bg-ig-bg-raised/50">
              <th className={cn(headCls, 'text-left')}>Competência</th>
              <th className={cn(headCls, 'text-right')}>Headcount</th>
              <th className={cn(headCls, 'text-right')}>Adm.</th>
              <th className={cn(headCls, 'text-right')}>Deslig.</th>
              <th className={cn(headCls, 'text-right')}>Turnover</th>
              <th className={cn(headCls, 'text-right')}>Absenteísmo</th>
              <th className={cn(headCls, 'text-right')}>H. Extras</th>
              <th className={cn(headCls, 'text-right')}>Custo Pessoal</th>
              <th className={cn(headCls, 'text-right')}>% Receita</th>
              <th className={cn(headCls, 'text-right')}>Receita/Colab</th>
              <th className={cn(headCls, 'text-left')}>Folha & Guias</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.competenceMonth}
                className="border-b border-ig-border-subtle/50 transition-colors hover:bg-ig-panel-hover"
              >
                <td className={cn(cellCls, 'text-left font-semibold text-ig-fg-strong')}>{r.period}</td>
                <td className={cn(cellCls, 'text-right text-ig-fg-default')}>{int(r.headcount)}</td>
                <td className={cn(cellCls, 'text-right text-ig-fg-default')}>{int(r.admissions)}</td>
                <td className={cn(cellCls, 'text-right text-ig-fg-default')}>{int(r.dismissals)}</td>
                <td className={cn(cellCls, 'text-right', toneFor(r.turnoverPct, 2, 3))}>
                  {pct(r.turnoverPct)}
                </td>
                <td className={cn(cellCls, 'text-right', toneFor(r.absenteeismPct, 4, 5))}>
                  {pct(r.absenteeismPct)}
                </td>
                <td className={cn(cellCls, 'text-right', toneFor(r.overtimePct, 10, 12))}>
                  {r.overtimePct.toFixed(1)}%
                </td>
                <td className={cn(cellCls, 'text-right text-ig-fg-default')}>{brl(r.payroll)}</td>
                <td className={cn(cellCls, 'text-right', toneFor(r.payrollAsRevenuePct, 30, 35))}>
                  {pct(r.payrollAsRevenuePct, 1)}
                </td>
                <td className={cn(cellCls, 'text-right text-ig-fg-default')}>{money(r.revenuePerEmployee)}</td>
                <td className={cn(cellCls, 'text-left')}>
                  <ComplianceCell state={compliance?.[r.competenceMonth]} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ig-border-focus/40 bg-ig-bg-raised/40">
              <td className={cn(cellCls, 'text-left text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-muted')}>
                Período
              </td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{int(total.headcount)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{int(total.admissions)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{int(total.dismissals)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{pct(total.turnoverPct)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{pct(total.absenteeismPct)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{total.overtimePct.toFixed(1)}%</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{brl(total.payroll)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{pct(total.payrollAsRevenuePct, 1)}</td>
              <td className={cn(cellCls, 'text-right font-bold text-ig-fg-strong')}>{money(total.revenuePerEmployee)}</td>
              <td className={cn(cellCls, 'text-left text-[9.5px] text-ig-fg-subtle')}>
                médias no período
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

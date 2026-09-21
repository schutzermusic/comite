'use client';

/**
 * NÍVEL C — O LEDGER MENSAL.
 *
 * A tabela detalhada do mês: contrato/OS, cliente, projeto, marco contratual,
 * valor previsto, data prevista, estado, medição, aprovação, NF, prazo de
 * pagamento, vencimento esperado, valor faturado e data de pagamento.
 *
 * ─── As colunas que esta tabela RECUSA preencher com palpite ──────────────
 *
 *   · VENCIMENTO ESPERADO só existe quando Finanças criou o recebível. Ele
 *     NÃO é derivado de `payment_terms`, que é texto livre do instrumento
 *     ("30 dias após o aceite"). Derivar dali produziria uma data de
 *     recebimento que ninguém pactuou, com cara de compromisso.
 *
 *   · DADOS BANCÁRIOS / FUNDING não têm fonte autoritativa neste domínio. A
 *     coluna não existe — uma coluna vazia permanente ensina que o dado
 *     "ainda não foi preenchido", quando na verdade ele não tem de onde vir.
 *     O que existe é a CONCILIAÇÃO bancária, que é fato de Finanças, e é ela
 *     que aparece.
 *
 *   · DATA DE PAGAMENTO vem da liquidação registrada. Ausência é ausência.
 */

import { useMemo, useState } from 'react';
import { ArrowUpDown, CalendarClock, AlertTriangle } from 'lucide-react';
import type { BillingMonthPlanRow } from '@/lib/contracts/billing/planning/month-plan-types';
import {
  deriveBillingPlanState, deriveDelays, wasReprogrammed, isScheduleAnchored,
  BILLING_PLAN_STATE_LABEL, BILLING_PLAN_STATE_TONE, DELAY_LABEL, DELAY_MEANING,
  PLANNED_DATE_BASIS_LABEL,
} from '@/lib/contracts/billing/planning/monthly-planning';
import { money, date, ABSENT, chipTone } from './plan-format';
import { PlanChip } from './PlanChip';

interface Props {
  readonly rows: readonly BillingMonthPlanRow[];
  readonly asOf: Date;
  readonly contractLabel: (contractId: string) => string;
  readonly clientLabel: (contractId: string) => string;
  readonly onOpenMilestone?: (row: BillingMonthPlanRow) => void;
}

type SortKey = 'date' | 'amount' | 'client';

export function BillingMonthLedger({
  rows, asOf, contractLabel, clientLabel, onOpenMilestone,
}: Props) {
  const [sort, setSort] = useState<SortKey>('date');

  const decorated = useMemo(() => rows.map((row) => ({
    row,
    state: deriveBillingPlanState(row),
    delays: deriveDelays(row, asOf),
  })), [rows, asOf]);

  const sorted = useMemo(() => [...decorated].sort((a, b) => {
    if (sort === 'amount') return (b.row.plannedAmount ?? 0) - (a.row.plannedAmount ?? 0);
    if (sort === 'client') return clientLabel(a.row.contractId).localeCompare(clientLabel(b.row.contractId));
    // Sem data vai para o fim: são os que não têm mês, e ordená-los primeiro
    // esconderia o que o mês de fato prevê.
    const da = a.row.plannedBillingDate ?? '9999-12-31';
    const db = b.row.plannedBillingDate ?? '9999-12-31';
    return da.localeCompare(db);
  }), [decorated, sort, clientLabel]);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-ig-caption text-ig-fg-muted">
        Nenhum marco contratual previsto para este recorte.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="dossier-meta">Ordenar por</span>
        {(['date', 'amount', 'client'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="portfolio-action"
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
          >
            <ArrowUpDown className="h-3 w-3" aria-hidden />
            {key === 'date' ? 'Data prevista' : key === 'amount' ? 'Valor previsto' : 'Cliente'}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-ig-border-subtle">
        <table className="ig-ledger">
          <caption className="sr-only">
            Ledger mensal de faturamento por marco contratual
          </caption>
          <thead>
            <tr>
              <th scope="col">Contrato / OS</th>
              <th scope="col">Cliente</th>
              <th scope="col">Projeto</th>
              <th scope="col">Marco contratual</th>
              <th scope="col" className="is-num">Valor previsto</th>
              <th scope="col">Data prevista</th>
              <th scope="col">Estado</th>
              <th scope="col">Medição</th>
              <th scope="col">Aprovação</th>
              <th scope="col">NF</th>
              <th scope="col">Prazo de pagamento</th>
              <th scope="col">Vencimento esperado</th>
              <th scope="col" className="is-num">Valor faturado</th>
              <th scope="col">Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, state, delays }) => {
              const chip = chipTone(BILLING_PLAN_STATE_TONE[state]);
              return (
                <tr
                  key={row.milestoneId}
                  onClick={onOpenMilestone ? () => onOpenMilestone(row) : undefined}
                  style={onOpenMilestone ? { cursor: 'pointer' } : undefined}
                >
                  <td>{row.contractNumber ?? contractLabel(row.contractId)}</td>
                  <td>{clientLabel(row.contractId)}</td>
                  <td className={row.projectId ? '' : 'is-absent'}>
                    {row.projectId ?? 'Não vinculado'}
                  </td>
                  <td>
                    <span className="font-medium">{row.title}</span>
                    {delays.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {delays.map((d) => (
                          <PlanChip
                            key={d}
                            tone={d === 'SCHEDULE_MILESTONE_OVERDUE' ? 'critical' : 'attention'}
                            dashed={false}
                            title={DELAY_MEANING[d]}
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {DELAY_LABEL[d]}
                          </PlanChip>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={`is-num ${row.plannedAmount === null ? 'is-absent' : ''}`}>
                    {money(row.plannedAmount, row.currency)}
                  </td>
                  <td className={row.plannedBillingDate ? '' : 'is-absent'}>
                    <span
                      title={PLANNED_DATE_BASIS_LABEL[row.plannedBillingDateBasis]}
                      className={isScheduleAnchored(row) ? 'font-medium' : ''}
                    >
                      {date(row.plannedBillingDate)}
                    </span>
                    {/*
                      "Reprogramada" ao lado da data é o que impede a leitura de
                      que o mês sempre foi aquele. A data anterior está no
                      diário e aparece no título.
                    */}
                    {wasReprogrammed(row) && (
                      <span
                        className="dossier-meta flex items-center gap-1"
                        title={`Data anterior: ${date(row.lastPreviousPlannedFinish)} · ${row.reprogrammingCount} reprogramação(ões)`}
                      >
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        Reprogramada
                      </span>
                    )}
                    {!isScheduleAnchored(row) && row.plannedBillingDate && (
                      <span className="dossier-meta">Fora do cronograma governado</span>
                    )}
                  </td>
                  <td>
                    <PlanChip tone={chip.tone} dashed={chip.dashed}>
                      {BILLING_PLAN_STATE_LABEL[state]}
                    </PlanChip>
                  </td>
                  <td className={row.measurementStatus ? '' : 'is-absent'}>
                    {row.measurementStatus ?? 'Sem medição'}
                  </td>
                  <td className={row.measurementAcceptedAt ? '' : 'is-absent'}>
                    {row.measurementAcceptedAt
                      ? `Aceita em ${date(row.measurementAcceptedAt)}`
                      : row.customerAcceptanceRequired === true
                        ? 'Exigida, não registrada'
                        : 'Não apurada'}
                  </td>
                  <td className={row.fiscalDocumentNumber ? '' : 'is-absent'}>
                    {row.fiscalDocumentNumber
                      ? `${row.fiscalDocumentNumber}${row.fiscalAuthorizedAt ? ` · ${date(row.fiscalAuthorizedAt)}` : ''}`
                      : 'Sem NF'}
                  </td>
                  <td className={row.paymentTermText ? '' : 'is-absent'}>
                    {row.paymentTermText ?? 'Não registrado'}
                  </td>
                  <td className={row.receivableFirstDueDate ? '' : 'is-absent'}>
                    {row.receivableFirstDueDate
                      ? date(row.receivableFirstDueDate)
                      // Sem recebível não há vencimento. Calcular um a partir
                      // do prazo em texto livre seria inventar compromisso.
                      : 'Sem recebível'}
                  </td>
                  <td className={`is-num ${row.billingEligibleAmount === null ? 'is-absent' : ''}`}>
                    {row.billingEventId === null
                      ? 'Não faturado'
                      : money(row.billingEligibleAmount, row.currency)}
                  </td>
                  <td className={row.receivableLastPaymentDate ? '' : 'is-absent'}>
                    {row.receivableLastPaymentDate
                      ? `${date(row.receivableLastPaymentDate)}${(row.reconciledSettlementCount ?? 0) > 0 ? ' · conciliado' : ''}`
                      : ABSENT}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="dossier-meta">
        Vencimento esperado vem do recebível de Finanças — nunca do prazo de pagamento em
        texto livre do contrato. Dados bancários não têm fonte autoritativa neste domínio e
        por isso não têm coluna.
      </p>
    </div>
  );
}

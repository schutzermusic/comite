/**
 * Leitura editorial do cockpit — a narrativa compartilhada pelos três destinos.
 *
 * O PDF, o deck e o PowerPoint contam a MESMA história, com as mesmas
 * manchetes, porque todos leem daqui. Escrever a prosa três vezes garante três
 * versões: a primeira correta, a segunda desatualizada e a terceira herdada de
 * um copy-paste.
 *
 * ─── Regra ─────────────────────────────────────────────────────────────────
 *
 * NENHUMA regra de negócio nova entra neste arquivo. Ele só LÊ o modelo e
 * escolhe palavras. Se um número precisa ser calculado, ele é calculado em
 * `model.ts` a partir dos seletores — caso contrário o relatório passaria a
 * afirmar coisas que a tela não afirma.
 *
 * Corolário direto: indicador `unmeasured` nunca vira card. Um insight sobre
 * algo que ninguém mediu é exatamente o tipo de frase que o módulo existe para
 * não produzir.
 */

import { wfCurrency, wfInt, wfPct, wfSignedPct } from './theme';
import type { Measured, WorkforceOverviewModel } from '../types';

export type WorkforceInsightKind = 'signal' | 'alert' | 'watch' | 'gap';

export interface WorkforceInsightCard {
  kind: WorkforceInsightKind;
  title: string;
  detail: string;
  /** Número de destaque, quando existe um. */
  value?: string;
}

export interface WorkforceInsights {
  /** A frase de abertura — a mesma da tela. */
  headline: string;
  /** Veredito curto do período, para capa e slide de fecho. */
  verdict: string;
  cards: WorkforceInsightCard[];
  /** O que NÃO foi apurado, para a seção de método. */
  gaps: string[];
}

const val = <T>(m: Measured<T>): T | null => (m.measured ? m.value : null);

export function buildWorkforceInsights(model: WorkforceOverviewModel): WorkforceInsights {
  const { executive, efficiency, dynamics, costStructure, concentration, compliance, scope, meta } =
    model;

  const cards: WorkforceInsightCard[] = [];
  const gaps: string[] = [];

  if (!scope.hasData) {
    return {
      headline: executive.headline,
      verdict: 'Não há competência apurada no período selecionado.',
      cards: [],
      gaps: [
        'Nenhuma folha aprovada e nenhum evento do eSocial foram apurados para as competências do período.',
      ],
    };
  }

  // ── Risco de folha ───────────────────────────────────────────────────────
  const riskScore = val(executive.risk.score);
  const payrollGrowth = val(executive.risk.payrollGrowth);
  const revenueGrowth = val(executive.risk.revenueGrowth);

  if (riskScore !== null && payrollGrowth !== null && revenueGrowth !== null) {
    const gap = payrollGrowth - revenueGrowth;
    if (gap > 2) {
      cards.push({
        kind: 'alert',
        title: 'Folha crescendo acima da receita',
        detail: `A folha variou ${wfSignedPct(payrollGrowth)} contra ${wfSignedPct(revenueGrowth)} da receita no período — pressão direta sobre a margem.`,
        value: `${riskScore}/100`,
      });
    } else {
      cards.push({
        kind: 'signal',
        title: 'Folha alinhada à receita',
        detail: `Folha ${wfSignedPct(payrollGrowth)} e receita ${wfSignedPct(revenueGrowth)} — o crescimento do custo de pessoal acompanha o faturamento.`,
        value: `${riskScore}/100`,
      });
    }
  } else {
    gaps.push(
      'O risco de folha compara o crescimento da folha com o da receita. Sem receita lançada no contas a receber para as competências do período, o diagnóstico não é apurável.',
    );
  }

  // ── Folha sobre receita ──────────────────────────────────────────────────
  const ratio = val(efficiency.payrollAsRevenuePct);
  if (ratio !== null) {
    if (ratio >= efficiency.threshold) {
      cards.push({
        kind: 'alert',
        title: 'Folha acima do limite sobre a receita',
        detail: `${wfPct(ratio)} da receita está comprometida com a folha, contra o limite de política de ${efficiency.threshold}%.`,
        value: wfPct(ratio),
      });
    } else {
      cards.push({
        kind: 'signal',
        title: 'Folha dentro do limite',
        detail: `${wfPct(ratio)} da receita comprometida com a folha, abaixo do limite de ${efficiency.threshold}%.`,
        value: wfPct(ratio),
      });
    }
  }

  // ── Concentração ─────────────────────────────────────────────────────────
  const top3 = val(concentration.top3);
  const sorted = [...concentration.data.costCenters].sort((a, b) => b.payrollValue - a.payrollValue);
  if (top3 !== null && sorted.length > 0) {
    cards.push({
      kind: top3 > 80 ? 'alert' : top3 > 70 ? 'watch' : 'signal',
      title: 'Concentração da folha',
      detail: `Os três maiores centros respondem por ${wfPct(top3)} da folha; o maior é ${sorted[0].name}, com ${wfCurrency(sorted[0].payrollValue)}.`,
      value: wfPct(top3),
    });
  }

  if (concentration.abnormal.length > 0) {
    const names = concentration.abnormal.slice(0, 3).map((c) => c.name).join(', ');
    cards.push({
      kind: 'watch',
      title: 'Variações atípicas a investigar',
      detail: `${wfInt(concentration.abnormal.length)} centro(s) de custo com crescimento fora do padrão: ${names}${concentration.abnormal.length > 3 ? '…' : ''}.`,
      value: wfInt(concentration.abnormal.length),
    });
  }

  // ── Dinâmica do quadro ───────────────────────────────────────────────────
  const turnover = val(dynamics.latestTurnoverPct);
  if (turnover !== null && turnover > 2) {
    cards.push({
      kind: turnover > 3 ? 'alert' : 'watch',
      title: 'Rotatividade elevada',
      detail: `Turnover de ${wfPct(turnover, 2)} na competência — acima do patamar em que a reposição passa a competir com a entrega.`,
      value: wfPct(turnover, 2),
    });
  }

  const overtime = val(dynamics.latestOvertimePct);
  if (overtime !== null && overtime > 12) {
    cards.push({
      kind: 'watch',
      title: 'Pressão de horas extras',
      detail: `Horas extras representam ${wfPct(overtime)} da massa salarial — sinal de quadro dimensionado abaixo da demanda.`,
      value: wfPct(overtime),
    });
  } else if (overtime === null) {
    gaps.push(
      'As horas extras dependem da tabela de rubricas do eSocial (S-1010) classificando a folha; sem ela a verba não é identificável.',
    );
  }

  const absenteeism = val(dynamics.maxAbsenteeismPct);
  if (absenteeism !== null && absenteeism > 4) {
    cards.push({
      kind: absenteeism > 5 ? 'alert' : 'watch',
      title: 'Absenteísmo concentrado',
      detail: `A lotação mais afetada registra ${wfPct(absenteeism)} de ausência sobre os dias úteis do período.`,
      value: wfPct(absenteeism),
    });
  }

  const movementNet = dynamics.movement.reduce((sum, d) => sum + d.net, 0);
  if (dynamics.movement.length > 0 && movementNet !== 0) {
    cards.push({
      kind: 'signal',
      title: movementNet > 0 ? 'Quadro em expansão' : 'Quadro em redução',
      detail: `Saldo de ${movementNet > 0 ? '+' : ''}${wfInt(movementNet)} colaborador(es) entre admissões e desligamentos declarados no período.`,
      value: `${movementNet > 0 ? '+' : ''}${wfInt(movementNet)}`,
    });
  }

  // ── Conformidade ─────────────────────────────────────────────────────────
  const score = compliance.snapshot.score;
  if (score < 85) {
    cards.push({
      kind: score < 60 ? 'alert' : 'watch',
      title: 'Ciclo da competência em aberto',
      detail: `A conformidade de ${compliance.currentCompetenceLabel} está em ${score}/100${
        compliance.snapshot.nextDue ? `; próxima obrigação: ${compliance.snapshot.nextDue.label}` : ''
      }.`,
      value: `${score}/100`,
    });
  }

  // ── Composição ───────────────────────────────────────────────────────────
  if (!costStructure.directPct.measured) {
    gaps.push(
      'A composição da folha (salário, benefícios e encargos) exige rubricas classificadas pelo S-1010; sem isso as verbas não são separáveis.',
    );
  }

  // ── Alcance do recorte ───────────────────────────────────────────────────
  for (const d of scope.degradations) gaps.push(d.humanLabel);

  if (!meta.comparison.label.measured) {
    gaps.push(
      'O período selecionado não tem linha de base na série apurada, então as variações não são calculáveis.',
    );
  }

  // ── Veredito ─────────────────────────────────────────────────────────────
  const alerts = cards.filter((c) => c.kind === 'alert').length;
  const watches = cards.filter((c) => c.kind === 'watch').length;
  const verdict =
    alerts > 0
      ? `${alerts} ponto(s) de atenção crítica no período${watches > 0 ? ` e ${watches} em observação` : ''}.`
      : watches > 0
        ? `Sem alertas críticos; ${watches} ponto(s) em observação.`
        : 'Os indicadores apurados estão dentro dos limites de política.';

  return {
    headline: executive.headline,
    verdict,
    // Seis é o que cabe numa página sem virar lista; a ordem já põe alerta
    // antes de observação.
    cards: [...cards].sort((a, b) => rank(a.kind) - rank(b.kind)).slice(0, 6),
    gaps,
  };
}

function rank(kind: WorkforceInsightKind): number {
  return kind === 'alert' ? 0 : kind === 'watch' ? 1 : kind === 'signal' ? 2 : 3;
}

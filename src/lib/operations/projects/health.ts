/**
 * SAÚDE DO PROJETO — derivada, explicada, nunca digitada.
 *
 * O nível sai de contagens de fatos canônicos (cronograma, OS, medição,
 * risco) com regra escrita, e volta SEMPRE com os motivos. Uma bolinha verde
 * sem motivo é decoração; um "crítico" sem motivo é alarme falso.
 */

export type HealthLevel = 'healthy' | 'attention' | 'critical' | 'unknown';

export interface HealthSignals {
  openActivities: number;
  criticalActivities: number;
  overdueActivities: number;
  blockedActivities: number;
  serviceOrdersBlocked: number;
  measurementsInCorrection: number;
  measurementsOverdue: number;
  criticalRisks: number;
  highRisks: number;
  risksWithoutOwner: number;
}

export interface HealthReason { tone: 'danger' | 'warning'; text: string }

export function deriveProjectHealth(s: HealthSignals, hasSchedule: boolean): { level: HealthLevel; reasons: HealthReason[] } {
  const reasons: HealthReason[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (s.blockedActivities) reasons.push({ tone: 'danger', text: plural(s.blockedActivities, 'atividade bloqueada', 'atividades bloqueadas') });
  if (s.overdueActivities) reasons.push({ tone: s.overdueActivities > 3 ? 'danger' : 'warning',
    text: plural(s.overdueActivities, 'atividade vencida', 'atividades vencidas') });
  if (s.serviceOrdersBlocked) reasons.push({ tone: 'danger', text: plural(s.serviceOrdersBlocked, 'OS com bloqueio', 'OS com bloqueio') });
  if (s.criticalRisks) reasons.push({ tone: 'danger', text: plural(s.criticalRisks, 'risco crítico aberto', 'riscos críticos abertos') });
  if (s.highRisks) reasons.push({ tone: 'warning', text: plural(s.highRisks, 'risco alto aberto', 'riscos altos abertos') });
  if (s.risksWithoutOwner) reasons.push({ tone: 'warning', text: plural(s.risksWithoutOwner, 'risco material sem dono', 'riscos materiais sem dono') });
  if (s.measurementsInCorrection) reasons.push({ tone: 'warning',
    text: plural(s.measurementsInCorrection, 'medição devolvida para correção', 'medições devolvidas para correção') });
  if (s.measurementsOverdue) reasons.push({ tone: 'warning',
    text: plural(s.measurementsOverdue, 'medição com evidência vencida', 'medições com evidência vencida') });

  if (!hasSchedule && reasons.length === 0) return { level: 'unknown', reasons: [] };
  const danger = reasons.filter((r) => r.tone === 'danger').length;
  const level: HealthLevel = danger > 0 ? 'critical' : reasons.length > 0 ? 'attention' : 'healthy';
  return { level, reasons: reasons.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1)) };
}

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  healthy: 'Em dia', attention: 'Atenção', critical: 'Crítico', unknown: 'Sem cronograma',
};

export interface ProgressItem { is_summary: boolean; status: string; percent_complete: number | null;
  duration_minutes?: number | null }

/**
 * PROGRESSO FÍSICO — média do percentual das FOLHAS do cronograma, ponderada
 * pela duração quando há duração (sem duração, peso 1). Linha-resumo não
 * entra: ela já é o agregado das filhas, e contá-la duplicaria o avanço.
 */
export function physicalProgress(items: ProgressItem[]): { percent: number | null; done: number; total: number } {
  const leaves = items.filter((i) => !i.is_summary && i.status !== 'cancelled');
  if (!leaves.length) return { percent: null, done: 0, total: 0 };
  let weight = 0; let acc = 0;
  for (const i of leaves) {
    const w = i.duration_minutes && i.duration_minutes > 0 ? i.duration_minutes : 1;
    const pct = i.status === 'completed' ? 100 : Math.max(0, Math.min(100, Number(i.percent_complete ?? 0)));
    weight += w; acc += w * pct;
  }
  return { percent: Math.round((acc / weight) * 10) / 10, done: leaves.filter((i) => i.status === 'completed').length, total: leaves.length };
}

/**
 * DECISÕES — a liberação de faturamento por dentro (server-only).
 *
 * O evento de faturamento é o objeto; a decisão é a etapa do motor que libera
 * a emissão. Aqui só se LÊ o evento, o contrato e a medição de origem — pelo
 * service role, com `organization_id` da sessão, para o evento que
 * `decision_access_for_viewer` já liberou. A cadeia é curta de propósito:
 * Medição → Faturamento, os dois vínculos que o registro guarda.
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/detail-billing.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';
import { date as fmtDate, money } from '@/components/ax/format';
import { RELEASE_LABEL } from '@/lib/contracts/billing/contract-to-cash-display';
import { billingNode, measurementNode } from './detail-procurement';
import type { ChainNode, Fact } from './types';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export interface BillingEventDetail { facts: Fact[]; chain: ChainNode[] }

export async function billingEventDetail(org: string, eventId: string): Promise<BillingEventDetail | null> {
  const sb = platformServiceClient();
  const { data: ev, error } = await sb.from('contract_billing_events')
    .select('id,contract_id,title,amount,currency,due_date,release_state,source_measurement_id,release_note')
    .eq('organization_id', org).eq('id', eventId).maybeSingle<Row>();
  if (error) throw new Error('Não foi possível ler o evento de faturamento.');
  if (!ev) return null;
  const [contractR, measurementR] = await Promise.all([
    ev.contract_id ? sb.from('contracts').select('id,title,contract_number,counterparty_name')
      .eq('organization_id', org).eq('id', String(ev.contract_id)).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
    ev.source_measurement_id ? sb.from('project_measurements').select('id,expected_at,status,measurement_period_start,measurement_period_end')
      .eq('organization_id', org).eq('id', String(ev.source_measurement_id)).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
  ]);
  const contract = contractR.data as Row | null;
  const measurement = measurementR.data as Row | null;
  const currency = str(ev.currency) ?? 'BRL';
  const release = str(ev.release_state);

  const facts: Fact[] = [];
  if (contract) {
    facts.push({ label: 'Contrato', value: [str(contract.contract_number), str(contract.title)].filter(Boolean).join(' · ') || 'Contrato', source: 'contracts' });
    if (contract.counterparty_name) facts.push({ label: 'Contraparte', value: String(contract.counterparty_name), source: 'contracts' });
  }
  if (ev.title) facts.push({ label: 'Evento', value: String(ev.title), source: 'contract_billing_events' });
  facts.push({ label: 'Valor', value: money(num(ev.amount), currency), source: 'contract_billing_events' });
  if (ev.due_date) facts.push({ label: 'Vencimento', value: fmtDate(String(ev.due_date)), source: 'contract_billing_events' });
  if (release) facts.push({ label: 'Liberação', value: RELEASE_LABEL[release as keyof typeof RELEASE_LABEL] ?? release, source: 'contract_billing_events' });
  if (measurement) {
    const period = measurement.measurement_period_start && measurement.measurement_period_end
      ? `${fmtDate(String(measurement.measurement_period_start))} a ${fmtDate(String(measurement.measurement_period_end))}` : null;
    if (period) facts.push({ label: 'Medição de origem', value: `Período ${period}`, source: 'project_measurements' });
  }

  const chain: ChainNode[] = [
    measurement ? measurementNode({ expectedAt: str(measurement.expected_at), status: str(measurement.status) })
      : { label: 'Medição', detail: 'sem vínculo registrado', missing: true },
    billingNode({ id: String(ev.id), title: str(ev.title), dueDate: str(ev.due_date), amount: num(ev.amount), currency, releaseState: release }),
  ];
  return { facts, chain };
}

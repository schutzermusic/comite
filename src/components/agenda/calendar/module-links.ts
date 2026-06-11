'use client';

/**
 * Data sources for "Vincular a módulo": option lists for the pickers and
 * label/href resolution for linked chips. All loads are best-effort — a
 * module whose data the user cannot read (RLS) simply yields no options.
 */

import { createClient } from '@/utils/supabase/client';
import { getProjectsAsync } from '@/lib/services/projects';
import { listContracts } from '@/lib/contracts/contract-service';
import { listRisks } from '@/lib/services/risks';
import { listDeliberations } from '@/lib/services/deliberations';
import type { CalendarEvent, RelatedModule, Task } from '@/lib/types/agenda';

export interface ModuleOption {
  id: string;
  label: string;
}

/** Field name on Task/CalendarEvent inputs for each module. */
export const MODULE_FIELD: Record<RelatedModule, string> = {
  project: 'relatedProjectId',
  contract: 'relatedContractId',
  risk: 'relatedRiskId',
  deliberation: 'relatedDeliberationId',
  committee: 'relatedCommitteeId',
  finance: 'relatedFinanceItemId',
  payroll: 'relatedPayrollBatchId',
};

export function moduleHref(module: RelatedModule, id: string): string {
  switch (module) {
    case 'project':
      return `/projetos/${id}`;
    case 'contract':
      return `/contratos/${id}`;
    case 'risk':
      return '/riscos';
    case 'deliberation':
      return '/deliberacoes';
    case 'committee':
      return `/comites/${id}`;
    case 'finance':
      return '/financeiro';
    case 'payroll':
      return '/workforce-cost/fechamento-folha';
  }
}

export async function loadModuleOptions(module: RelatedModule): Promise<ModuleOption[]> {
  try {
    switch (module) {
      case 'project': {
        const projects = await getProjectsAsync();
        return projects.map((p) => ({ id: p.id, label: p.codigo ? `${p.codigo} — ${p.nome}` : p.nome }));
      }
      case 'contract': {
        const contracts = await listContracts();
        return contracts.map((c) => ({ id: c.id, label: c.title }));
      }
      case 'risk': {
        const risks = await listRisks();
        return risks.map((r) => ({ id: r.id, label: r.title }));
      }
      case 'deliberation': {
        const items = await listDeliberations();
        return items.map((d) => ({ id: d.id, label: d.title }));
      }
      case 'committee': {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('committees')
          .select('id, name')
          .eq('status', 'active')
          .order('name');
        if (error) return [];
        return (data ?? []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name }));
      }
      case 'finance': {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('ledger_entry')
          .select('id, description, entry_date')
          .order('entry_date', { ascending: false })
          .limit(60);
        if (error) return [];
        return (data ?? []).map((l: { id: string; description: string; entry_date: string }) => ({
          id: l.id,
          label: `${l.entry_date} — ${l.description}`,
        }));
      }
      case 'payroll': {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('payroll_closing_batches')
          .select('id, competence_month, status')
          .order('competence_month', { ascending: false })
          .limit(36);
        if (error) return [];
        return (data ?? []).map((b: { id: string; competence_month: string }) => ({
          id: b.id,
          label: `Fechamento ${b.competence_month}`,
        }));
      }
    }
  } catch {
    return [];
  }
}

/** Resolves the display label of a single linked item (chip in drawers). */
export async function fetchLinkLabel(module: RelatedModule, id: string): Promise<string | null> {
  const supabase = createClient();
  try {
    switch (module) {
      case 'project': {
        const { data } = await supabase.from('projects').select('project').eq('id', id).maybeSingle();
        const p = data?.project as { nome?: string; codigo?: string } | undefined;
        return p?.nome ?? id;
      }
      case 'contract': {
        const { data } = await supabase.from('contracts').select('title').eq('id', id).maybeSingle();
        return (data?.title as string) ?? null;
      }
      case 'risk': {
        const { data } = await supabase.from('risks').select('title').eq('id', id).maybeSingle();
        return (data?.title as string) ?? null;
      }
      case 'deliberation': {
        const { data } = await supabase.from('deliberations').select('title').eq('id', id).maybeSingle();
        return (data?.title as string) ?? null;
      }
      case 'committee': {
        const { data } = await supabase.from('committees').select('name').eq('id', id).maybeSingle();
        return (data?.name as string) ?? null;
      }
      case 'finance': {
        const { data } = await supabase.from('ledger_entry').select('description').eq('id', id).maybeSingle();
        return (data?.description as string) ?? null;
      }
      case 'payroll': {
        const { data } = await supabase
          .from('payroll_closing_batches')
          .select('competence_month')
          .eq('id', id)
          .maybeSingle();
        return data ? `Fechamento ${data.competence_month}` : null;
      }
    }
  } catch {
    return null;
  }
}

/** Extracts {module → id} from a task/event for the linked-chips section. */
export function extractLinks(entity: Task | CalendarEvent): Array<{ module: RelatedModule; id: string }> {
  const out: Array<{ module: RelatedModule; id: string }> = [];
  if (entity.relatedProjectId) out.push({ module: 'project', id: entity.relatedProjectId });
  if (entity.relatedContractId) out.push({ module: 'contract', id: entity.relatedContractId });
  if (entity.relatedRiskId) out.push({ module: 'risk', id: entity.relatedRiskId });
  if (entity.relatedDeliberationId) out.push({ module: 'deliberation', id: entity.relatedDeliberationId });
  if (entity.relatedCommitteeId) out.push({ module: 'committee', id: entity.relatedCommitteeId });
  if (entity.relatedFinanceItemId) out.push({ module: 'finance', id: entity.relatedFinanceItemId });
  if (entity.relatedPayrollBatchId) out.push({ module: 'payroll', id: entity.relatedPayrollBatchId });
  return out;
}

/** Shape shared by the create/edit forms for the module-link section. */
export type RelatedLinks = {
  relatedProjectId?: string | null;
  relatedContractId?: string | null;
  relatedRiskId?: string | null;
  relatedDeliberationId?: string | null;
  relatedCommitteeId?: string | null;
  relatedFinanceItemId?: string | null;
  relatedPayrollBatchId?: string | null;
};

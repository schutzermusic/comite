/**
 * Alçada de leitura do Projeto 360 — perguntada ao MESMO resolvedor que a RLS
 * usa. Cada seção aparece, some ou diz "restrito" conforme a resposta; nenhuma
 * é buscada para depois ser escondida.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/projects/access.ts não pode ser importado no navegador');
}

import { hasOptionalPermission, type OperationsSession } from '../session';
import type { ProjectAccess } from './read-model';

export function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function projectAccess(session: OperationsSession): Promise<ProjectAccess> {
  const [measurementsView, projectsView, risks, operations, contracts, allocations] = await Promise.all([
    hasOptionalPermission(session, 'projects.measurements.view'),
    hasOptionalPermission(session, 'projects.view'),
    hasOptionalPermission(session, 'risks.view'),
    hasOptionalPermission(session, 'operations.view'),
    hasOptionalPermission(session, 'contracts.view'),
    hasOptionalPermission(session, 'people.allocations_view'),
  ]);
  // Mesma decisão que mascara os valores do evento de medição no cronograma (183).
  const { data: financials } = await session.supabase.rpc('current_user_can_view_project_financials');
  return {
    measurements: measurementsView || projectsView,
    risks,
    financials: financials === true,
    commercial: operations || contracts,
    team: allocations || projectsView,
  };
}

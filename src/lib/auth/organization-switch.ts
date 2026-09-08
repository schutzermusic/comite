'use client';

import { createClient } from '@/utils/supabase/client';

/**
 * Fase 7.5 — a troca de organização, do lado do navegador.
 *
 * ─── Por que a navegação é DURA ───────────────────────────────────────────
 *
 * Trocar de organização troca a fronteira de inquilino inteira. O que precisa
 * desaparecer não é só a lista na tela: é todo estado em memória que nasceu no
 * inquilino anterior — resultados já buscados, IDs selecionados, cache de rota
 * do Next, componentes montados segurando linhas do tenant A.
 *
 * Este produto não usa react-query, então não há um `queryClient.clear()` para
 * chamar; o cache é a própria memória dos componentes mais o Router Cache do
 * Next. `router.refresh()` revalida o servidor mas PRESERVA o estado de cliente
 * — exatamente o que não pode sobreviver aqui.
 *
 * `window.location.assign` descarta o processo de renderização inteiro. É a
 * única invalidação que não depende de lembrar de invalidar cada lugar — e a
 * §17 pede precisamente uma garantia que não dependa de enumeração.
 *
 * O destino é a raiz do módulo, e não a rota atual: uma rota de detalhe carrega
 * o ID de um registro do inquilino anterior, e abri-la depois da troca daria
 * um 404 no melhor caso.
 */
export const ORGANIZATION_SWITCH_FALLBACK = '/dashboard';

export type SwitchFailure =
  | 'ORGANIZATION_NOT_FOUND'
  | 'MEMBERSHIP_NOT_ACTIVE'
  | 'ORGANIZATION_SUSPENDED'
  | 'ORGANIZATION_ARCHIVED'
  | 'NOT_AUTHENTICATED'
  | 'UNKNOWN';

export function classifySwitchFailure(message: string | undefined): SwitchFailure {
  const codes: SwitchFailure[] = [
    'ORGANIZATION_NOT_FOUND', 'MEMBERSHIP_NOT_ACTIVE',
    'ORGANIZATION_SUSPENDED', 'ORGANIZATION_ARCHIVED', 'NOT_AUTHENTICATED',
  ];
  return codes.find((c) => message?.includes(c)) ?? 'UNKNOWN';
}

export const SWITCH_FAILURE_MESSAGE: Record<SwitchFailure, string> = {
  /*
    "Não encontrada" cobre também "você não é membro" — de propósito. Distinguir
    as duas contaria, a quem tem um UUID na mão, que aquela organização existe
    noutro grupo (§4.3). A RPC converge as duas respostas; a tela não pode
    divergi-las de novo.
  */
  ORGANIZATION_NOT_FOUND: 'Organização não encontrada ou sem acesso.',
  MEMBERSHIP_NOT_ACTIVE: 'Seu vínculo com esta organização não está ativo.',
  ORGANIZATION_SUSPENDED: 'Esta organização está suspensa.',
  ORGANIZATION_ARCHIVED: 'Esta organização está arquivada.',
  NOT_AUTHENTICATED: 'Sessão expirada. Entre novamente.',
  UNKNOWN: 'Não foi possível trocar de organização.',
};

/** Operational browser state must not survive a tenant boundary change. */
export function clearTenantLocalPersistence(): void {
  if (typeof window === 'undefined') return;
  const exactKeys = new Set([
    'insight_projects',
    'insight_projects_v2_b',
    'deliberation_drafts',
    'insight-investor-report-packs-v1',
    'insight:payroll-cc-mappings:org-insight-001',
    'insight-ponto-fila-v1',
  ]);
  const scopedPrefixes = [
    'insight_projects:',
    'insight_projects_v2_b:',
    'insight:payroll-cc-mappings:',
    'deliberation_drafts:',
    'insight-investor-report-packs-v1:',
  ];
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key && (exactKeys.has(key) || scopedPrefixes.some((prefix) => key.startsWith(prefix)))) {
      window.localStorage.removeItem(key);
    }
  }
}

export async function switchOrganization(
  organizationId: string,
  destination: string = ORGANIZATION_SWITCH_FALLBACK,
): Promise<{ ok: true } | { ok: false; failure: SwitchFailure; message: string }> {
  const supabase = createClient();
  const { error } = await supabase.rpc('organization_switch', {
    p_organization_id: organizationId,
  });

  if (error) {
    const failure = classifySwitchFailure(error.message);
    return { ok: false, failure, message: SWITCH_FAILURE_MESSAGE[failure] };
  }

  if (typeof window !== 'undefined') {
    clearTenantLocalPersistence();
    window.location.assign(destination);
  }
  return { ok: true };
}

/**
 * Leitura do CONTEXTO de uma proposta no servidor (PT + PC).
 *
 * Toda leitura passa pelo cliente autenticado da sessão (RLS). `select('*')`
 * é deliberado: com a 217 a linha traz `context_id`; sem ela, a mesma
 * consulta continua válida e o agrupamento cai na derivação canônica de
 * `proposal-context.ts` — a tela nunca quebra por ordem de deploy.
 */
if (typeof window !== 'undefined') {
  throw new Error('proposal-context-server.ts não pode ser importado no navegador');
}

import type { CommercialSession } from './server-session';
import { baseProposalNumber, contextKeys, type ContextProposal } from './proposal-context';

export type ProposalRecord = ContextProposal & {
  owner_user_id?: string | null;
};

/** Candidatos ao mesmo contexto: mesmo cliente (a regra exige), ou mesmo `context_id`. */
async function candidates(session: CommercialSession, proposal: ProposalRecord): Promise<ProposalRecord[]> {
  const { data } = await session.supabase.from('commercial_proposals').select('*')
    .eq('organization_id', session.organizationId)
    .eq('counterparty_name', proposal.counterparty_name)
    .limit(200);
  const rows = (data ?? []) as unknown as ProposalRecord[];
  if (proposal.context_id) {
    const { data: explicit } = await session.supabase.from('commercial_proposals').select('*')
      .eq('organization_id', session.organizationId)
      .eq('context_id', proposal.context_id);
    for (const row of (explicit ?? []) as unknown as ProposalRecord[]) {
      if (!rows.some((r) => r.id === row.id)) rows.push(row);
    }
  }
  if (!rows.some((r) => r.id === proposal.id)) rows.push(proposal);
  return rows;
}

/** Os documentos do contexto desta proposta — ela inclusa. */
export async function loadContextMembers(session: CommercialSession, proposal: ProposalRecord): Promise<ProposalRecord[]> {
  const rows = await candidates(session, proposal);
  const keys = contextKeys(rows);
  const key = keys.get(proposal.id);
  return rows.filter((r) => keys.get(r.id) === key);
}

export async function loadProposal(session: CommercialSession, id: string): Promise<ProposalRecord | null> {
  const { data } = await session.supabase.from('commercial_proposals').select('*')
    .eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  return (data as unknown as ProposalRecord | null) ?? null;
}

/**
 * Ao criar um documento sem contexto explícito: existe o par dele (mesmo
 * cliente, mesmo número-base, tipo oposto, ainda sozinho)? Então entra lá —
 * é a mesma regra da derivação, e evita que banco e tela discordem.
 */
export async function findContextPartner(
  session: CommercialSession, payload: { proposal_number?: unknown; kind?: unknown; counterparty_name?: unknown },
): Promise<string | null> {
  const kind = String(payload.kind ?? '');
  if (kind !== 'TECHNICAL' && kind !== 'COMMERCIAL') return null;
  const counterparty = String(payload.counterparty_name ?? '').trim();
  const base = baseProposalNumber(String(payload.proposal_number ?? ''));
  if (!counterparty || !base) return null;
  const { data } = await session.supabase.from('commercial_proposals').select('*')
    .eq('organization_id', session.organizationId).eq('counterparty_name', counterparty).limit(200);
  const rows = (data ?? []) as unknown as ProposalRecord[];
  const opposite = kind === 'TECHNICAL' ? 'COMMERCIAL' : 'TECHNICAL';
  const partners = rows.filter((r) => r.kind === opposite && baseProposalNumber(r.proposal_number) === base);
  if (partners.length !== 1) return null;
  const keys = contextKeys(rows);
  const alone = rows.filter((r) => keys.get(r.id) === keys.get(partners[0].id)).length === 1;
  const sameKind = rows.some((r) => r.kind === kind && baseProposalNumber(r.proposal_number) === base);
  return alone && !sameKind ? partners[0].id : null;
}

/** A função governada da 217 ainda não existe neste banco? */
export function isMissingFunction(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return /Could not find the function|PGRST202|does not exist/i.test(message)
    && /commercial_proposal_context_/.test(message);
}

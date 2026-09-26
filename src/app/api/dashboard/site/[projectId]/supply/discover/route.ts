/**
 * APEX BUSCA FORNECEDORES NA INTERNET — `POST /api/dashboard/site/[projectId]/supply/discover`
 * corpo `{ requirementId }` → `SupplierDiscoveryResponse`.
 *
 * Como as outras rotas do local: toda pessoa autenticada com organização
 * ativa recebe 200, e o motivo de uma recusa vai no corpo (`ok: false` +
 * `reason` + `message`, com `error` repetindo a mensagem). Alçada:
 * `procurement.source` OU `procurement.request`. Busca desligada nesta
 * instalação → `ai_unavailable` com o motivo (é o que o QA responde).
 *
 * Nada é gravado além da linha de auditoria de uma busca que chegou ao
 * provedor: os candidatos voltam à tela, não verificados, e só viram cadastro
 * pela rota governada de fornecedores. Cada busca é cobrada: o mesmo material
 * reaproveita a busca recente da organização, e há teto em 24 h por pessoa e
 * por organização (acima dele, `error` com "Aguarde…"). Toda a regra mora em
 * `src/lib/supply/supplier-discovery.ts`.
 */
import { NextResponse } from 'next/server';
import { isSessionError, requireCommercialSession } from '@/lib/commercial/server-session';
import { discoverSuppliers, DISCOVERY_MESSAGE } from '@/lib/supply/supplier-discovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A tarefa tem 120 s de teto no gateway; a margem é da leitura e da auditoria.
export const maxDuration = 150;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const { projectId } = await context.params;

  let body: unknown = null;
  try { body = await request.json(); } catch { body = null; }
  const requirementId = body && typeof body === 'object' ? (body as { requirementId?: unknown }).requirementId : undefined;
  if (typeof requirementId !== 'string') {
    const message = DISCOVERY_MESSAGE.invalid;
    return NextResponse.json({ ok: false, reason: 'invalid', message, error: message }, { status: 200, headers: NO_STORE });
  }

  try {
    const result = await discoverSuppliers({ session, projectId, requirementId, headers: request.headers });
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error('[dashboard/site] supply/discover: falhou', error);
    const message = DISCOVERY_MESSAGE.failed;
    return NextResponse.json({ ok: false, reason: 'error', message, error: message }, { status: 200, headers: NO_STORE });
  }
}

/**
 * Portão de leitura/escrita do levantamento técnico.
 *
 * Leitura: `commercial.view` OU `commercial.surveys.manage` — o mesmo par da
 * RLS de `commercial_site_surveys`. Escrita: `commercial.surveys.manage`.
 * O engenheiro de campo opera o levantamento sem enxergar o funil.
 */
import { NextResponse } from 'next/server';
import {
  requireCommercialSession, isSessionError, hasOptionalPermission, type CommercialSession,
} from './server-session';

export async function requireSurveySession(
  mode: 'read' | 'write',
): Promise<CommercialSession | { error: NextResponse }> {
  const session = await requireCommercialSession(mode === 'write' ? ['commercial.surveys.manage'] : []);
  if (isSessionError(session)) return session;
  if (mode === 'read') {
    const allowed = await hasOptionalPermission(session, 'commercial.surveys.manage')
      || await hasOptionalPermission(session, 'commercial.view');
    if (!allowed) {
      return { error: NextResponse.json({ ok: false,
        error: 'Esta ação exige: commercial.view ou commercial.surveys.manage.' }, { status: 403 }) };
    }
  }
  return session;
}

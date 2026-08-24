import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractClausesFromDocument } from '@/lib/ai/contract-clause-extractor';
import { logAuditEvent } from '@/lib/audit/log-audit-event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extração assistida de cláusulas a partir de um documento do contrato.
 *
 * A permissão exigida é `contracts.analyze_with_ai` — a mesma que já existia
 * para análise documental. Registrar a cláusula proposta continua sob
 * `contracts.edit` pela RLS, e validar continua sendo ato humano.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  try {
    const { contractId } = await params;
    if (!contractId) {
      return NextResponse.json({ ok: false, error: 'contractId ausente' }, { status: 400 });
    }

    let body: { documentId?: string } = {};
    try {
      body = (await req.json()) as { documentId?: string };
    } catch {
      // corpo vazio cai na validação abaixo
    }
    if (!body.documentId) {
      return NextResponse.json(
        { ok: false, error: 'documentId ausente: a análise precisa de um documento de origem.' },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }

    const { data: perms, error: permErr } = await supabase
      .from('user_roles')
      .select('roles!inner(role_permissions!inner(permissions!inner(key)))')
      .eq('user_id', user.id);
    if (permErr) {
      return NextResponse.json(
        { ok: false, error: `Erro ao verificar permissões: ${permErr.message}` },
        { status: 500 },
      );
    }

    type PermShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };
    const keys = new Set<string>();
    for (const row of (perms ?? []) as unknown as PermShape[]) {
      for (const rp of row?.roles?.role_permissions ?? []) {
        const k = rp?.permissions?.key;
        if (k) keys.add(k);
      }
    }
    if (!keys.has('contracts.analyze_with_ai')) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão contracts.analyze_with_ai' },
        { status: 403 },
      );
    }

    const result = await extractClausesFromDocument(contractId, body.documentId, user.id);

    const { data: profile } = await supabase
      .from('profiles').select('organization_id').eq('user_id', user.id).maybeSingle<{ organization_id: string }>();
    if (profile?.organization_id) {
      await logAuditEvent({
        organizationId: profile.organization_id,
        action: 'contract.clauses_extracted',
        entityType: 'contract',
        entityId: contractId,
        metadata: {
          analysis_id: result.analysisId,
          document_id: result.documentId,
          proposed: result.proposedCount,
          rejected_without_evidence: result.rejectedCount,
          model: result.model,
          version: result.version,
        },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro inesperado na análise.' },
      { status: 500 },
    );
  }
}

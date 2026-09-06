import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import { scheduleFastDrain } from '@/lib/platform/jobs/fast-path';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extração assistida de cláusulas — agora ENFILEIRADA.
 *
 * ─── O que mudou, e por quê ────────────────────────────────────────────────
 *
 * A leitura do PDF acontecia dentro deste pedido. Um contrato grande gasta
 * minutos de modelo, e uma função serverless reciclada no meio deixava a
 * análise presa em `running` sem ninguém para retomá-la — trabalho perdido em
 * silêncio, com aparência de "ainda analisando".
 *
 * Agora o pedido cria uma linha DURÁVEL e um trabalho na fila, e responde 202.
 * Se o processo cair, outro trabalhador pega. O `after()` logo abaixo é só
 * latência: quando ele roda, a análise começa em segundos; quando não roda, o
 * agendador a pega na próxima batida.
 *
 * ─── O que NÃO mudou ───────────────────────────────────────────────────────
 *
 * A permissão continua `contracts.analyze_with_ai`. O documento continua sendo
 * exigido como origem — e agora o portão é verificado ANTES de enfileirar, para
 * que "documento não é PDF" seja uma recusa imediata em vez de cinco
 * tentativas do mesmo erro. Página e trecho continuam obrigatórios em cada
 * proposta, a impressão digital continua impedindo fila de revisão duplicada, e
 * a proposta continua nascendo rascunho. Enfileirar mudou a confiabilidade da
 * execução; não mudou o que a máquina pode afirmar.
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

    // A organização vem do PERFIL, nunca do corpo do pedido.
    const { data: profile } = await supabase
      .from('profiles').select('organization_id').eq('user_id', user.id)
      .maybeSingle<{ organization_id: string }>();
    if (!profile?.organization_id) {
      return NextResponse.json(
        { ok: false, error: 'Perfil sem organização.' }, { status: 403 },
      );
    }

    /*
      Pedido e trabalho nascem na MESMA transação, dentro da função do banco.
      Criar um e depois o outro deixaria, entre os dois, um pedido eternamente
      QUEUED sem nada que o execute.
    */
    const { data: queued, error: queueError } = await platformServiceClient().rpc(
      'contract_clause_extraction_request',
      {
        p_organization_id: profile.organization_id,
        p_contract_id: contractId,
        p_document_id: body.documentId,
        p_requested_by: user.id,
      },
    );
    if (queueError) {
      // O portão de evidência recusa de forma DETERMINÍSTICA: documento
      // inexistente, de outro contrato ou que não é PDF nunca vira trabalho.
      const deterministic = ['P0002', '23514'].includes(queueError.code ?? '');
      return NextResponse.json(
        { ok: false, error: queueError.message },
        { status: deterministic ? 400 : 500 },
      );
    }

    const result = queued as {
      request_id: string; status: string; job_id: string | null; reused: boolean;
    };

    const write = await logAuditEventServer(
      {
        organizationId: profile.organization_id,
        action: 'contract.clause_extraction_requested',
        entityType: 'contract',
        entityId: contractId,
        metadata: {
          request_id: result.request_id,
          document_id: body.documentId,
          job_id: result.job_id,
          reused: result.reused,
        },
      },
      req.headers,
    );
    if (!write.ok) {
      console.error(`[clause-extraction] auditoria não registrada: ${write.error}`);
    }

    // Depois da resposta, e apenas como latência.
    scheduleFastDrain('clause-extraction');

    return NextResponse.json(
      {
        ok: true,
        requestId: result.request_id,
        status: result.status,
        jobId: result.job_id,
        reused: result.reused,
        audited: write.ok ? true : { error: write.error },
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro inesperado na análise.' },
      { status: 500 },
    );
  }
}

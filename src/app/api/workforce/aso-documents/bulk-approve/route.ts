import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  buildApprovalSnapshot,
  confirmedFields,
  nextReviewState,
} from '@/lib/workforce/aso-review';
import {
  buildAsoReviewSummary,
  effectiveFields,
  siblingsByPerson,
  siblingsFor,
} from '@/lib/workforce/aso-summary';
import {
  AsoSchemaMissingError,
  listAsoDocuments,
  updateAsoDocument,
  type AsoDocumentRow,
} from '@/lib/workforce/aso-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Teto por chamada. Lote maior que isso é o RH aprovando sem olhar. */
const MAX_BULK = 100;

/**
 * POST — confirma em lote os ASOs que não têm ressalva NENHUMA.
 *
 * POR QUE ISTO NÃO É AUTOAPROVAÇÃO
 *
 * A diferença entre lote e automação é quem inicia. Aqui nada roda sozinho:
 * não há cron, não há gatilho de upload, não há "aprovar se a confiança passar
 * de X". Existe um usuário autenticado que selecionou documentos e clicou. O
 * `reviewed_by` de cada linha é ele, e a trilha registra que a confirmação veio
 * por lote — para que uma auditoria consiga separar o que foi olhado um a um do
 * que foi aceito em bloco.
 *
 * O QUE O LOTE RECUSA, E POR QUE A RÉGUA É MAIS DURA QUE A INDIVIDUAL
 *
 * Só entra documento com `eligibleForBulk` — ou seja, ZERO ressalvas, nem
 * mesmo as leves. A confirmação individual admite ressalva com ciência
 * explícita, porque ali o RH está olhando aquele documento. No lote ele não
 * está olhando nenhum; o que ele afirma é "estes não têm nada de estranho". Se
 * o lote aceitasse ressalva, essa afirmação seria falsa por construção.
 *
 * A elegibilidade é recalculada AQUI, sobre a linha do banco. A lista que a
 * tela mandou é uma seleção, nunca um veredito.
 */
export async function POST(req: Request) {
  const guard = await resolveSensitiveActor();
  if (!guard.ok) return guard.response;

  let body: { documentIds?: unknown };
  try {
    body = (await req.json()) as { documentIds?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const ids = Array.isArray(body.documentIds)
    ? [...new Set(body.documentIds.filter((v): v is string => typeof v === 'string'))]
    : [];

  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Informe ao menos um documento para confirmar.' },
      { status: 400 },
    );
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { ok: false, error: `Máximo de ${MAX_BULK} documentos por confirmação em lote.` },
      { status: 400 },
    );
  }

  try {
    const all = await listAsoDocuments(guard.organizationId);
    const byId = new Map(all.map((r) => [r.id, r]));
    const siblings = siblingsByPerson(all);

    const approved: string[] = [];
    const skipped: { documentId: string; reason: string }[] = [];
    const at = new Date().toISOString();

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        skipped.push({ documentId: id, reason: 'Documento não encontrado nesta organização.' });
        continue;
      }
      if (row.review_status === 'approved') {
        skipped.push({ documentId: id, reason: 'Já estava confirmado.' });
        continue;
      }

      const summary = buildAsoReviewSummary(row, siblingsFor(row, siblings));
      if (!summary.readiness.eligibleForBulk) {
        skipped.push({
          documentId: id,
          reason:
            summary.readiness.issues[0]?.label ??
            'Tem ressalva — confirme individualmente, olhando o documento.',
        });
        continue;
      }

      const outcome = nextReviewState(
        'approve',
        {
          reviewStatus: row.review_status,
          reviewedBy: row.reviewed_by,
          reviewedAt: row.reviewed_at,
        },
        { userId: guard.userId, at },
        {
          note: 'Confirmado em lote (documento sem ressalvas).',
          // `cautions` sai vazio por construção — só entra no lote quem não tem
          // nenhuma. O retrato é gravado assim mesmo: numa auditoria, "aprovado
          // em lote, e estava limpo no momento" é uma afirmação diferente de
          // "aprovado em lote" sem mais nada.
          approval: buildApprovalSnapshot(summary.readiness, {
            mode: 'bulk',
            userId: guard.userId,
            at,
          }),
        },
      );

      await updateAsoDocument(guard.organizationId, id, {
        review_status: outcome.reviewStatus,
        reviewed_by: outcome.reviewedBy,
        reviewed_at: outcome.reviewedAt,
        reviewed_fields_json: confirmedFields(effectiveFields(row), row.reviewed_fields_json ?? {}),
        review_history: [...(row.review_history ?? []), outcome.entry],
      } satisfies Partial<Omit<AsoDocumentRow, 'document_status'>>);

      approved.push(id);
    }

    return NextResponse.json({ ok: true, approved: approved.length, approvedIds: approved, skipped });
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao confirmar em lote' },
      { status: 500 },
    );
  }
}

async function resolveSensitiveActor(): Promise<
  { ok: true; organizationId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const r = await resolvePayrollActor('people.view_sensitive_data');
  if (r.ok) return { ok: true, organizationId: r.actor.organizationId, userId: r.actor.userId };
  const alt = await resolvePayrollActor('people.payroll_view_sensitive');
  if (alt.ok) return { ok: true, organizationId: alt.actor.organizationId, userId: alt.actor.userId };
  return { ok: false, response: r.response };
}

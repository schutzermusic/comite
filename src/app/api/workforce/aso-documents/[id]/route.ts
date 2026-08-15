import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  applyAsoEdits,
  buildApprovalSnapshot,
  confirmedFields,
  nextReviewState,
  type AsoApprovalSnapshot,
  type AsoEditableField,
  type AsoFields,
  type AsoReviewAction,
} from '@/lib/workforce/aso-review';
import {
  buildAsoReviewSummary,
  siblingsByPerson,
  siblingsFor,
} from '@/lib/workforce/aso-summary';
import {
  AsoSchemaMissingError,
  deleteAsoDocument,
  getAsoDocument,
  listAsoDocuments,
  removeAsoFile,
  updateAsoDocument,
  type AsoDocumentRow,
} from '@/lib/workforce/aso-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS: AsoReviewAction[] = ['approve', 'request_correction', 'reject', 'edit', 'reopen'];

interface ReviewBody {
  action?: AsoReviewAction;
  /** Correções manuais, no vocabulário de `AsoFields`. */
  fields?: Partial<Record<AsoEditableField, unknown>>;
  person_id?: string | null;
  note?: string | null;
  /**
   * Ciência explícita das ressalvas leves (ex.: ASO sem validade apurável).
   * Sem isto, aprovar um documento com ressalva é recusado — não porque ele
   * seja inválido, mas para que "arquivei sabendo" e "cliquei sem ler" não
   * sejam a mesma ação.
   */
  acknowledge?: boolean;
}

/**
 * PATCH — curadoria humana do documento.
 *
 * Quatro ações, e elas são propositalmente separadas da edição de campos:
 *
 *   approve             — o RH conferiu e assume o documento. ÚNICO caminho
 *                         para `approved`, e o único momento em que o ASO passa
 *                         a sustentar indicador de vencimento.
 *   request_correction  — devolve para ajuste sem descartar o documento.
 *   reject              — recusa o documento (papel errado, ilegível, duplicado).
 *   edit                — corrige campos mal lidos. NÃO aprova nada.
 *   reopen              — desfaz uma decisão e devolve o documento à fila.
 *
 * `approve` pode ser chamado segundos depois do upload, da mesma tela — é o que
 * tira o RH da viagem até uma fila separada. O que NÃO muda com isso é o
 * agente: a chamada exige um usuário autenticado, e é ele que vai para
 * `reviewed_by`. Nenhum caminho do código produz `approved` sem essa chamada.
 *
 * E o servidor não confia na tela: antes de aprovar, ele reavalia o portão
 * (`assessApprovalReadiness`) sobre a linha do banco. Um POST forjado contra um
 * documento ilegível é recusado com os impeditivos listados, exatamente como o
 * botão que a tela teria escondido.
 *
 * O arquivo ORIGINAL não é tocado por nenhuma delas. Correção manual grava em
 * `reviewed_fields_json` e deixa `extracted_fields_json` intacto — é assim que
 * continua sendo possível responder, meses depois, se um valor veio do papel ou
 * da mão de alguém.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await resolveSensitiveActor();
  if (!guard.ok) return guard.response;

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const hasFields = Boolean(body.fields && Object.keys(body.fields).length > 0);
  const action: AsoReviewAction | undefined = body.action ?? (hasFields ? 'edit' : undefined);

  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, error: `Ação inválida. Use uma de: ${ACTIONS.join(', ')}.` },
      { status: 400 },
    );
  }

  try {
    const current = await getAsoDocument(guard.organizationId, id);
    if (!current) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });

    const patch: Partial<Omit<AsoDocumentRow, 'document_status'>> = {};
    let changed: AsoEditableField[] = [];
    let approvalSnapshot: AsoApprovalSnapshot | undefined;
    const decidedAt = new Date().toISOString();

    if (hasFields) {
      const result = applyAsoEdits(
        current.extracted_fields_json ?? {},
        current.reviewed_fields_json ?? {},
        body.fields!,
      );
      if (result.errors.length > 0) {
        // Nada foi gravado: a correção volta inteira para quem a digitou.
        return NextResponse.json(
          { ok: false, error: 'Correção recusada.', fieldErrors: result.errors },
          { status: 400 },
        );
      }

      changed = result.changed;
      patch.reviewed_fields_json = result.reviewed;
      Object.assign(patch, flatColumnsFrom(result.effective));
      // Depois que uma pessoa mexeu no valor, ele não é mais leitura de máquina
      // — e nenhuma reanálise futura pode sobrescrevê-lo em silêncio.
      patch.extraction_method = 'manual';
    }

    if (body.person_id !== undefined) {
      patch.person_id = body.person_id;
    }
    if (body.note !== undefined) {
      patch.notes = body.note;
    }

    // ── Portão de aprovação ──
    //
    // Reavaliado sobre a linha do banco JÁ com o patch aplicado, e não sobre o
    // que a tela mandou: corrigir um campo e aprovar na mesma chamada precisa
    // ver o valor corrigido, senão o impeditivo que a correção acabou de
    // resolver ainda barraria a aprovação.
    if (action === 'approve') {
      const projected: AsoDocumentRow = { ...current, ...patch } as AsoDocumentRow;

      // MELHORIA FUTURA (custo, não correção): isto lê o acervo inteiro só para
      // achar os ASOs do MESMO colaborador e detectar conflito. Com dezenas ou
      // centenas de documentos é irrelevante; quando o acervo passar de alguns
      // milhares, trocar por uma consulta filtrada por
      // (person_id, exam_kind, exam_date ± tolerância) — que é exatamente o
      // recorte que `assessApprovalReadiness` usa. Não fazer agora é deliberado:
      // o índice certo depende do formato real do acervo, e otimizar contra um
      // acervo vazio é chutar.
      const all = await listAsoDocuments(guard.organizationId).catch(() => [current]);
      const summary = buildAsoReviewSummary(
        projected,
        siblingsFor(projected, siblingsByPerson(all)),
      );

      if (!summary.readiness.eligibleForConfirmation) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Este ASO não pode ser confirmado com a leitura atual.',
            blockers: summary.readiness.blockers,
            suggestedStatus: 'correction_requested',
          },
          { status: 422 },
        );
      }
      if (summary.readiness.requiresAcknowledgement && !body.acknowledge) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Confirmação exige ciência das ressalvas.',
            cautions: summary.readiness.cautions,
            requiresAcknowledgement: true,
          },
          { status: 428 },
        );
      }

      // Retrato do portão NO INSTANTE do clique — com as ressalvas carimbadas
      // com quem as reconheceu. É o que permite provar, depois, que aprovar um
      // ASO sem validade declarada foi decisão consciente e não descuido.
      approvalSnapshot = buildApprovalSnapshot(summary.readiness, {
        mode: 'individual',
        userId: guard.userId,
        at: decidedAt,
      });

      // Aprovar é assumir o conjunto inteiro, e não só o que foi digitado.
      // `extracted_fields_json` continua intocado, então "corrigi" e "conferi e
      // aceitei" seguem distinguíveis por comparação.
      patch.reviewed_fields_json = confirmedFields(
        buildEffective(projected),
        (patch.reviewed_fields_json ?? current.reviewed_fields_json) ?? {},
      );
    }

    const outcome = nextReviewState(
      action,
      {
        reviewStatus: current.review_status,
        reviewedBy: current.reviewed_by,
        reviewedAt: current.reviewed_at,
      },
      { userId: guard.userId, at: decidedAt },
      { fields: changed, note: body.note ?? null, approval: approvalSnapshot },
    );

    patch.review_status = outcome.reviewStatus;
    patch.reviewed_by = outcome.reviewedBy;
    patch.reviewed_at = outcome.reviewedAt;
    // Trilha append-only: quem revisou, o quê e quando. Sobrescrever entradas
    // antigas apagaria justamente o que uma auditoria vem procurar.
    patch.review_history = [
      ...(current.review_history ?? []),
      // A ciência das ressalvas fica na trilha: numa auditoria, "aprovou sem
      // validade apurável" precisa vir com a marca de que foi deliberado.
      body.acknowledge && action === 'approve'
        ? { ...outcome.entry, note: outcome.entry.note ?? 'Confirmado com ciência das ressalvas.' }
        : outcome.entry,
    ];

    const row = await updateAsoDocument(guard.organizationId, id, patch);
    return NextResponse.json({ ok: true, document: row });
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao atualizar' },
      { status: 500 },
    );
  }
}

/** Campos vigentes de uma linha, no vocabulário de `AsoFields`. */
function buildEffective(row: AsoDocumentRow): AsoFields {
  return {
    workerName: row.worker_name_raw,
    workerRegistration: row.worker_registration,
    companyName: row.company_name,
    companyCnpj: row.company_cnpj,
    clinicName: row.clinic_name,
    examDate: row.exam_date,
    examKind: (row.exam_kind as AsoFields['examKind']) ?? null,
    result: (row.exam_result as AsoFields['result']) ?? null,
    validityDate: row.validity_date,
    validityBasis: row.validity_basis,
    doctorName: row.doctor_name,
    doctorCrm: row.doctor_crm,
    occupationalRisks: row.occupational_risks ?? null,
  };
}

/**
 * Projeta os campos vigentes nas colunas planas.
 *
 * As colunas existem para que consulta e índice não precisem abrir JSON; a
 * verdade sobre a PROCEDÊNCIA de cada valor continua nos dois JSONs.
 */
function flatColumnsFrom(fields: AsoFields): Partial<AsoDocumentRow> {
  return {
    worker_name_raw: fields.workerName ?? null,
    worker_registration: fields.workerRegistration ?? null,
    company_name: fields.companyName ?? null,
    company_cnpj: fields.companyCnpj ?? null,
    clinic_name: fields.clinicName ?? null,
    exam_date: fields.examDate ?? null,
    exam_kind: fields.examKind ?? null,
    exam_result: fields.result ?? null,
    validity_date: fields.validityDate ?? null,
    validity_basis: fields.validityBasis ?? 'undetermined',
    doctor_name: fields.doctorName ?? null,
    doctor_crm: fields.doctorCrm ?? null,
    occupational_risks: fields.occupationalRisks ?? [],
  };
}

/**
 * DELETE — remove a linha e o PDF. Exige `people.manage`.
 *
 * Deliberadamente destrutivo e restrito: o arquivo é dado de saúde, e um PDF
 * órfão no bucket é passivo, não histórico. O histórico que sobrevive à
 * exclusão é o do colaborador, no documento seguinte.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.manage');
  if (!r.ok) return r.response;

  try {
    const current = await getAsoDocument(r.actor.organizationId, id);
    if (!current) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });

    await deleteAsoDocument(r.actor.organizationId, id);
    await removeAsoFile(current.object_path).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao excluir' },
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

import { NextResponse } from 'next/server';
import { actorCan, resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import { batchActionRules, type BatchAction } from '@/lib/payroll/batch-actions';
import { GENERATED_ARTIFACT_TYPES, generateBatchArtifacts, type GeneratedArtifactType } from '@/lib/payroll/generated-artifacts-server';
import { sanitizeParseForSave } from '@/lib/payroll/email-intent';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ActionBody =
  | { action: 'save_parse'; parse: PayrollParseResult }
  | { action: 'save_report'; report_type: string; generated_text: string; generated_html: string; generated_by_ai: boolean; ai_provider?: string; ai_model?: string; ai_input_tokens?: number; ai_output_tokens?: number }
  | { action: 'add_generated_attachment'; file_type: string; content?: unknown; encoding?: unknown }
  | { action: 'approve' }
  | { action: 'send_to_finance'; override?: boolean; override_reason?: string }
  | { action: 'update'; competence_month?: string; payment_deadline?: string | null; notes?: string | null }
  | { action: 'cancel'; reason?: string }
  | { action: 'reopen'; reason?: string }
  | { action: 'invalidate_parse' };

/**
 * POST /api/payroll/batches/[id]/actions — dispatch table for the closing
 * lifecycle: save_parse | save_report | add_generated_attachment |
 * approve | send_to_finance. (O pacote de e-mail nasce só no envio tipado —
 * não há mais criação de pacote com assunto/HTML do navegador.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const repo = getServerRepository();
  try {
    switch (body.action) {
      case 'save_parse': {
        // A planilha é lida no navegador; o que ela produziu vira texto de e-mail
        // e de relatório — validado aqui antes de guardar.
        const clean = sanitizeParseForSave(body.parse);
        if (!clean.ok) return NextResponse.json({ ok: false, error: clean.error }, { status: 400 });
        const batch = await repo.saveParsedPayrollData(r.actor, id, clean.parse);
        return NextResponse.json({ ok: true, batch });
      }
      case 'save_report': {
        if (body.generated_by_ai && (!body.ai_provider || !body.ai_model)) {
          return NextResponse.json(
            { ok: false, error: 'Relatório de IA sem proveniência de provider/model.' },
            { status: 400 },
          );
        }
        const report = await repo.saveGeneratedReport(r.actor, id, {
          report_type: body.report_type as never,
          generated_text: body.generated_text, generated_html: body.generated_html,
          generated_by_ai: body.generated_by_ai,
          ai_provider: body.ai_provider,
          ai_model: body.ai_model,
          ai_input_tokens: body.ai_input_tokens,
          ai_output_tokens: body.ai_output_tokens,
        });
        return NextResponse.json({ ok: true, report });
      }
      case 'add_generated_attachment': {
        // O relatório gerado é do SERVIDOR: montado dos números e da narrativa
        // guardados. Conteúdo vindo do navegador não vira anexo (e depois
        // e-mail) — é recusado, não ignorado.
        if (body.content !== undefined || body.encoding !== undefined) {
          return NextResponse.json({ ok: false, error: 'O conteúdo do relatório gerado é montado pelo servidor.' }, { status: 400 });
        }
        if (!GENERATED_ARTIFACT_TYPES.includes(body.file_type as GeneratedArtifactType)) {
          return NextResponse.json({ ok: false, error: 'Tipo de relatório gerado inválido.' }, { status: 400 });
        }
        const facts = await repo.getEmailFacts(r.actor, id);
        if (!facts) return NextResponse.json({ ok: false, error: 'Fechamento não encontrado.' }, { status: 404 });
        const [attachment] = await generateBatchArtifacts(repo, r.actor, facts, [body.file_type as GeneratedArtifactType]);
        return NextResponse.json({ ok: true, attachment });
      }
      case 'approve': {
        const batch = await repo.approveClosingBatch(r.actor, id);
        return NextResponse.json({ ok: true, batch });
      }
      case 'update':
      case 'cancel':
      case 'reopen':
      case 'invalidate_parse': {
        // Re-validate the transition server-side against the SAME rules the UI
        // uses, then enforce the required permission (admins bypass).
        const action: BatchAction = body.action === 'update' ? 'edit'
          : body.action === 'invalidate_parse' ? 'reparse' : body.action;
        const batch = await repo.getClosingBatch(r.actor, id);
        if (!batch) return NextResponse.json({ ok: false, error: 'Fechamento não encontrado.' }, { status: 404 });
        const rule = batchActionRules(batch.status, !!batch.finance_batch_id)[action];
        if (!rule.allowed) {
          return NextResponse.json({ ok: false, error: rule.reason ?? 'Ação não permitida neste status.' }, { status: 409 });
        }
        if (rule.permission !== 'people.payroll_close' && !(await actorCan(r.actor, rule.permission))) {
          return NextResponse.json({ ok: false, error: `Sem permissão ${rule.permission}` }, { status: 403 });
        }
        if (body.action === 'update') {
          const updated = await repo.updateClosingBatch(r.actor, id, { competence_month: body.competence_month, payment_deadline: body.payment_deadline, notes: body.notes });
          return NextResponse.json({ ok: true, batch: updated });
        }
        if (body.action === 'cancel') {
          const updated = await repo.cancelClosingBatch(r.actor, id, body.reason);
          return NextResponse.json({ ok: true, batch: updated });
        }
        if (body.action === 'reopen') {
          const updated = await repo.reopenClosingBatch(r.actor, id, body.reason);
          return NextResponse.json({ ok: true, batch: updated });
        }
        const updated = await repo.invalidateParse(r.actor, id);
        return NextResponse.json({ ok: true, batch: updated });
      }
      case 'send_to_finance': {
        // Sending with unmapped cost centers requires an authorized override:
        // admin OR people.payroll_override_mapping — checked in the actor's
        // organization so the service-role repository can trust the flag.
        let override = false;
        if (body.override) {
          if (!(await actorCan(r.actor, 'people.payroll_override_mapping'))) {
            return NextResponse.json({ ok: false, error: 'Sem permissão people.payroll_override_mapping' }, { status: 403 });
          }
          override = true;
        }
        const result = await repo.sendToFinance(r.actor, id, { override, overrideReason: body.override_reason });
        return NextResponse.json(result, { status: result.ok ? 200 : 409 });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Ação desconhecida.' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

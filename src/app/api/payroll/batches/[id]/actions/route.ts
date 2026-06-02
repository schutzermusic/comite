import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { getServerRepository } from '@/lib/payroll/repository';
import { batchActionRules, type BatchAction } from '@/lib/payroll/batch-actions';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ActionBody =
  | { action: 'save_parse'; parse: PayrollParseResult }
  | { action: 'save_report'; report_type: string; generated_text: string; generated_html: string; generated_by_ai: boolean }
  | { action: 'add_generated_attachment'; file_name: string; file_type: string; mime_type: string; content: string; encoding?: 'utf8' | 'base64'; security_level?: string }
  | { action: 'create_package'; audience: string; subject: string; html_body: string; attachment_ids: string[] }
  | { action: 'approve' }
  | { action: 'send_to_finance'; override?: boolean; override_reason?: string }
  | { action: 'update'; competence_month?: string; payment_deadline?: string | null; notes?: string | null }
  | { action: 'cancel'; reason?: string }
  | { action: 'reopen'; reason?: string }
  | { action: 'invalidate_parse' };

/**
 * POST /api/payroll/batches/[id]/actions — dispatch table for the closing
 * lifecycle: save_parse | save_report | add_generated_attachment |
 * create_package | approve | send_to_finance.
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
        const batch = await repo.saveParsedPayrollData(r.actor, id, body.parse);
        return NextResponse.json({ ok: true, batch });
      }
      case 'save_report': {
        const report = await repo.saveGeneratedReport(r.actor, id, {
          report_type: body.report_type as never,
          generated_text: body.generated_text, generated_html: body.generated_html,
          generated_by_ai: body.generated_by_ai,
        });
        return NextResponse.json({ ok: true, report });
      }
      case 'add_generated_attachment': {
        const bytes = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
        const attachment = await repo.addGeneratedAttachment(r.actor, id, {
          file_name: body.file_name, file_type: body.file_type as never, mime_type: body.mime_type,
          bytes, security_level: body.security_level as never,
        });
        return NextResponse.json({ ok: true, attachment });
      }
      case 'create_package': {
        const pkg = await repo.createEmailPackage(r.actor, id, {
          audience: body.audience as never, subject: body.subject,
          html_body: body.html_body, attachment_ids: body.attachment_ids,
        });
        return NextResponse.json({ ok: true, package: pkg });
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
        if (rule.permission !== 'people.payroll_close') {
          const guard = await requireApiPermission(rule.permission, { allowAdmin: true });
          if (!guard.ok) return guard.response;
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
        // admin OR people.payroll_override_mapping. We verify it here (session
        // RPC) so the service-role repository can trust the flag.
        let override = false;
        if (body.override) {
          const ov = await requireApiPermission('people.payroll_override_mapping', { allowAdmin: true });
          if (!ov.ok) return ov.response;
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

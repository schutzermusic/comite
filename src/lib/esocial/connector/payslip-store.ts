import type { ProvisionalPayslipLine } from './payslip-pdf';
import { aggregatePayslipLines } from './payslip-pdf';
import { getEsocialServiceClient } from './store';

if (typeof window !== 'undefined') {
  throw new Error('payslip-store.ts não pode ser importado no browser');
}

const PAYSLIP_PAGE_SIZE = 1_000;

/**
 * O PostgREST limita SELECTs a 1.000 linhas por padrão. Uma folha real passa
 * facilmente disso, então a reapuração precisa percorrer todas as páginas —
 * caso contrário o PDF é importado inteiro, mas o agregado fica truncado.
 */
async function readAllPayslipLines(
  organizationId: string,
  competence: string,
): Promise<ProvisionalPayslipLine[]> {
  const db = getEsocialServiceClient();
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAYSLIP_PAGE_SIZE) {
    const { data, error } = await db
      .from('payroll_payslip_lines')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('competence', competence)
      .order('id', { ascending: true })
      .range(offset, offset + PAYSLIP_PAGE_SIZE - 1);
    if (error) throw new Error(`Falha ao reapurar contracheques: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAYSLIP_PAGE_SIZE) break;
  }
  return rows.map((row) => ({
    ...row,
    classification_basis: 'payslip_pdf' as const,
    natRubr: null,
    inssIncidence: null,
    fgtsIncidence: null,
    irrfIncidence: null,
    validity: null,
  })) as unknown as ProvisionalPayslipLine[];
}

/** Reaplica os agregados provisórios sem reimportar nem duplicar PDFs. */
export async function recomputePayslipMetrics(
  organizationId: string,
  competences: string[],
): Promise<void> {
  const db = getEsocialServiceClient();
  for (const competence of [...new Set(competences)]) {
    const lines = await readAllPayslipLines(organizationId, competence);
    const aggregate = aggregatePayslipLines(lines)[0];
    if (!aggregate) continue;
    const { error: metricError } = await db.from('esocial_competence_metrics').upsert({
      organization_id: organizationId,
      competence,
      payslip_gross_cents: aggregate.gross_cents,
      payslip_deductions_cents: aggregate.deductions_cents,
      payslip_net_cents: aggregate.net_cents,
      payslip_overtime_cents: aggregate.overtime_cents,
      payslip_overtime_hours: aggregate.overtime_hours,
      payslip_benefits_cents: aggregate.benefits_cents,
      payslip_benefits_by_nature: aggregate.benefits_cents > 0 ? { other: aggregate.benefits_cents } : {},
      payslip_absence_deductions_cents: aggregate.absence_deductions_cents,
      payslip_headcount: aggregate.headcount,
      payslip_line_count: aggregate.line_count,
      payslip_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,competence' });
    if (metricError) throw new Error(`Falha ao gravar fallback do contracheque: ${metricError.message}`);
  }
}

export async function importPayslipLines(input: {
  organizationId: string;
  userId: string;
  fileName: string;
  checksum: string;
  pageCount: number;
  lines: ProvisionalPayslipLine[];
}): Promise<{ duplicated: boolean; competences: string[] }> {
  const db = getEsocialServiceClient();
  const { data: existing, error: findError } = await db
    .from('payroll_payslip_imports')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('checksum_sha256', input.checksum)
    .maybeSingle();
  if (findError) throw new Error(`Falha ao verificar contracheque: ${findError.message}`);
  if (existing) return { duplicated: true, competences: [] };

  const { data: inserted, error: importError } = await db
    .from('payroll_payslip_imports')
    .insert({
      organization_id: input.organizationId,
      file_name: input.fileName,
      checksum_sha256: input.checksum,
      page_count: input.pageCount,
      line_count: input.lines.length,
      imported_by: input.userId,
    })
    .select('id')
    .single();
  if (importError || !inserted) throw new Error(`Falha ao registrar contracheque: ${importError?.message ?? 'sem retorno'}`);

  const rows = input.lines.map((line) => ({
    import_id: inserted.id,
    organization_id: input.organizationId,
    employee_name: line.employee_name,
    employee_code: line.employee_code,
    competence: line.competence,
    cost_center: line.cost_center,
    job_title: line.job_title,
    rubric_code: line.rubric_code,
    rubric_description: line.rubric_description,
    reference: line.reference,
    reference_quantity: line.reference_quantity,
    reference_hours: line.reference_hours,
    earning_cents: line.earning_cents,
    deduction_cents: line.deduction_cents,
    rubric_role: line.rubric_role,
    semantic_category: line.semantic_category,
    classification_basis: line.classification_basis,
    nat_rubr: null,
    inss_incidence: null,
    fgts_incidence: null,
    irrf_incidence: null,
    validity: null,
    source_page: line.source_page,
  }));
  const { error: linesError } = await db.from('payroll_payslip_lines').insert(rows);
  if (linesError) throw new Error(`Falha ao gravar rubricas do contracheque: ${linesError.message}`);

  const competences = [...new Set(input.lines.map((line) => line.competence))];
  await recomputePayslipMetrics(input.organizationId, competences);
  return { duplicated: false, competences };
}

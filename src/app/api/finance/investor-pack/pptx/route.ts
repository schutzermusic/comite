import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { validateInvestorPack } from '@/lib/finance/investor-pack/calculations';
import { investorPackFileStem } from '@/lib/finance/investor-pack/html-presentation';
import { generateInvestorPackPptx } from '@/lib/finance/investor-pack/pptx-server';
import type { ApexThemeMode } from '@/lib/finance/investor-pack/apex-theme';
import type { InvestorPack, InvestorPackNarrative } from '@/lib/finance/investor-pack/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

async function ensureExportPermission(): Promise<void> {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc('current_user_has_permission', { permission_key: 'finance.export' });
  if (!allowed) throw new Error('Você não possui permissão para exportar a projeção financeira.');
}

async function loadSavedProjection(id: string): Promise<InvestorPack | null> {
  const supabase = await createClient();
  const [{ data: row, error }, { data: months, error: monthError }] = await Promise.all([
    supabase.from('investor_report_packs').select('*').eq('id', id).maybeSingle(),
    supabase.from('investor_report_pack_months').select('*').eq('pack_id', id).order('period_key'),
  ]);
  if (error || monthError || !row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentPackId: row.parent_pack_id,
    title: row.title,
    company: row.company,
    recipient: row.recipient,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: 'BRL',
    referenceDate: row.reference_date,
    confidentiality: row.confidentiality,
    status: row.status,
    version: row.version,
    narrative: row.narrative as InvestorPackNarrative,
    createdBy: null,
    authorName: row.author_name,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    months: (months ?? []).map((month) => ({
      id: month.id,
      period: month.period_key,
      revenueActualCents: Number(month.revenue_actual_cents),
      revenueForecastCents: Number(month.revenue_forecast_cents),
      payrollActualCents: Number(month.payroll_actual_cents),
      payrollForecastCents: Number(month.payroll_forecast_cents),
      note: month.note,
    })),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: string; pack?: InvestorPack; theme?: string };
    // Mesmo par de temas do PDF; qualquer outro valor cai no escuro.
    const theme: ApexThemeMode = body.theme === 'light' ? 'light' : 'dark';
    let pack: InvestorPack | null = null;
    if (SUPABASE_CONFIGURED) {
      await ensureExportPermission();
      pack = body.pack
        ? { ...body.pack, organizationId: null, createdBy: null }
        : body.id
          ? await loadSavedProjection(body.id)
          : null;
    } else {
      pack = body.pack ?? null;
    }
    if (!pack) {
      return NextResponse.json({ error: 'Projeção financeira não informada.' }, { status: 404 });
    }
    const validation = validateInvestorPack(pack);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(' ') }, { status: 422 });
    }
    const bytes = await generateInvestorPackPptx(pack, { theme });
    const fileName = `${investorPackFileStem(pack)}.pptx`;
    const responseBody = new Uint8Array(bytes).buffer as ArrayBuffer;
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao gerar PowerPoint.' },
      { status: 500 },
    );
  }
}

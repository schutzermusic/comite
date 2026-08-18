/**
 * Geração do PowerPoint do cockpit de Pessoas & Custos.
 *
 * ─── Por que a rota recebe o MODELO pronto ─────────────────────────────────
 *
 * O cliente envia o `WorkforceOverviewModel` já montado, e a rota não
 * re-deriva nada. Re-buscar folha, eSocial e receita aqui produziria um
 * segundo caminho de cálculo — e bastaria uma diferença de arredondamento, de
 * fuso ou de permissão para o PowerPoint mostrar números que a tela não
 * mostrou. O modelo é o contrato; o servidor só desenha.
 *
 * O gerador OOXML é server-only por peso: importá-lo no cliente somaria ~1 MB
 * ao bundle da página.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateWorkforceOverviewPptx } from '@/lib/workforce/overview/report/pptx-server';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Mesma permissão do PDF, declarada no registry de relatórios. */
const EXPORT_PERMISSION = 'people.view_costs';
const FALLBACK_PERMISSION = 'people.cost_view';

async function ensureExportPermission(): Promise<void> {
  const supabase = await createClient();
  const [{ data: primary }, { data: fallback }] = await Promise.all([
    supabase.rpc('current_user_has_permission', { permission_key: EXPORT_PERMISSION }),
    supabase.rpc('current_user_has_permission', { permission_key: FALLBACK_PERMISSION }),
  ]);
  if (!primary && !fallback) {
    throw new Error('Você não possui permissão para exportar os custos de pessoal.');
  }
}

/**
 * Validação mínima do modelo recebido.
 *
 * Não revalida números — eles vieram do modelo, que é a fonte. O que importa é
 * recusar um payload que produziria um documento vazio circulando como se
 * fosse apuração.
 */
function validateModel(model: unknown): { valid: boolean; error?: string } {
  if (!model || typeof model !== 'object') {
    return { valid: false, error: 'Modelo do cockpit não informado.' };
  }
  const m = model as Partial<WorkforceOverviewModel>;
  if (!m.meta || !m.scope || !m.executive || !m.compliance) {
    return { valid: false, error: 'Modelo do cockpit incompleto.' };
  }
  if (!m.scope.hasData) {
    return {
      valid: false,
      error: 'Sem competência apurada no período — não há material a apresentar.',
    };
  }
  return { valid: true };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { model?: WorkforceOverviewModel };

    if (SUPABASE_CONFIGURED) await ensureExportPermission();

    const validation = validateModel(body.model);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 422 });
    }

    const model = body.model as WorkforceOverviewModel;
    const bytes = await generateWorkforceOverviewPptx(model);

    const period = model.meta.periodLabel
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const fileName = `relatorio-pessoas-e-custos-${period || 'periodo'}.pptx`;

    return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

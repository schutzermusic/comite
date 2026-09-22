import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { createClient } from '@/utils/supabase/server';
import {
  PreAnalysisUnavailableError, runEvidencePreAnalysis,
} from '@/lib/projects/measurements/preanalysis-server';
import { dispatchMeasurementHandoff } from '@/lib/projects/measurements/handoff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/projects/measurements/[id]/preanalysis
 *
 * ─── Por que é uma ROTA, e não um gatilho de upload ───────────────────────
 *
 * Porque falar com o provedor leva minutos e custa dinheiro, e o upload tem de
 * terminar quando o arquivo chega. Amarrar a análise ao upload faria o anexo
 * parecer que falhou quando o que falhou foi o modelo — e o anexo é a verdade
 * do acervo, com ou sem parecer.
 *
 * ─── Por que ela não decide nada ─────────────────────────────────────────
 *
 * A rota grava PARECER. Nenhuma linha daqui valida evidência, satisfaz
 * exigência, muda estado de medição ou toca faturamento. O portão é
 * `projects.measurements.edit` — a mesma chave de quem prepara o pacote —
 * porque pedir parecer é trabalho de preparação.
 *
 * `evidenceId` opcional: sem ele, analisa toda evidência documental ainda sem
 * parecer. É o caminho do botão "pré-analisar pendências".
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiPermission('projects.measurements.edit', { allowAdmin: true });
  if (!guard.ok) return guard.response;

  const { id: measurementId } = await ctx.params;
  let body: { evidenceId?: string } = {};
  try { body = (await req.json()) as typeof body; } catch { /* corpo vazio é válido */ }

  const supabase = await createClient();

  /*
    O recorte de inquilino vem da RLS, e não de um parâmetro: a leitura abaixo
    passa pela política de `project_measurement_evidence`. Uma medição de outra
    organização devolve zero linhas, e zero linhas é a mesma resposta de "não
    tem evidência" — que é exatamente o que se quer responder.
  */
  let query = supabase
    .from('project_measurement_evidence')
    .select('id')
    .eq('measurement_id', measurementId)
    .eq('source_type', 'project_file')
    .is('revoked_at', null);
  if (body.evidenceId) query = query.eq('id', body.evidenceId);

  const { data: evidence, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if ((evidence ?? []).length === 0) {
    return NextResponse.json({
      ok: true, analyzed: 0, skipped: 0, results: [],
      // A ausência é DITA. "0 analisados" sem explicação faz a pessoa clicar
      // de novo esperando um resultado diferente.
      note: 'Nenhum documento comprobatório vinculado a esta medição para pré-analisar.',
    });
  }

  // Evidência que já tem parecer COMPLETO não é reanalisada por padrão: rodar
  // de novo gastaria provedor para chegar ao mesmo parecer sobre o mesmo PDF.
  const ids = (evidence ?? []).map((e) => e.id as string);
  const { data: existing } = await supabase
    .from('project_measurement_evidence_analyses')
    .select('evidence_id')
    .in('evidence_id', ids)
    .eq('state', 'COMPLETED');
  const analyzed = new Set((existing ?? []).map((a) => a.evidence_id as string));
  const targets = body.evidenceId ? ids : ids.filter((i) => !analyzed.has(i));

  const results = [];
  let failures = 0;
  for (const evidenceId of targets) {
    try {
      results.push(await runEvidencePreAnalysis(evidenceId, guard.userId));
    } catch (e) {
      if (e instanceof PreAnalysisUnavailableError) {
        return NextResponse.json({ ok: false, error: e.message, code: 'AI_UNAVAILABLE' },
          { status: 503 });
      }
      failures += 1;
      results.push({
        analysisId: '', state: 'FAILED' as const,
        verifiable: 0, met: 0, notMet: 0, notFound: 0, inconsistent: 0, needsHumanReview: 0,
        failureReason: e instanceof Error ? e.message : 'Erro inesperado',
      });
    }
  }

  /*
    PENDÊNCIA DETECTADA → GESTOR DO PROJETO (§12).

    Só avisa quando o parecer encontrou algo que alguém precisa resolver. Um
    aviso a cada pré-análise — inclusive as que deram tudo atendido — é o tipo
    de mensagem que treina o destinatário a arquivar sem ler.

    A falha do aviso não derruba a resposta: o parecer já está gravado, e o
    registro de entrega (194) sabe quem ainda não foi avisado.
  */
  const pending = results.reduce(
    (n, r) => n + r.notMet + r.notFound + r.inconsistent + r.needsHumanReview, 0);
  if (pending > 0) {
    try {
      await dispatchMeasurementHandoff(measurementId, 'evidence.pending_detected', {
        reason: `A pré-análise apontou ${pending} ponto(s) a resolver na evidência.`,
        // A rodada é a contagem de pareceres: um parecer novo é aviso novo, e o
        // mesmo parecer relido não é.
        round: results.length,
      });
    } catch (e) {
      console.error('[measurements/preanalysis] aviso de pendência falhou:',
        e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({
    ok: true,
    analyzed: results.filter((r) => r.state === 'COMPLETED').length,
    skipped: ids.length - targets.length,
    failures,
    pending_findings: pending,
    results,
  });
}

/**
 * GET — o parecer CONSOLIDADO da medição.
 *
 * Passa pela mesma função que a tela usa, para que a rota e a tela nunca
 * discordem sobre quantos requisitos estão atendidos.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiPermission('projects.measurements.view', { allowAdmin: true });
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('project_measurement_preanalysis',
    { p_measurement_id: id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, preanalysis: data });
}

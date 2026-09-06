import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Saúde da fila e do grafo de eventos.
 *
 * Isto é observabilidade de INFRAESTRUTURA, não a Torre de Controle da Fase 9 e
 * não uma tela de usuário. Responde: há trabalho vencido? há concessão
 * expirada? há evento parado sem roteamento? quantas cartas mortas?
 *
 * Contadores e idades. Nenhum payload, nenhum trecho de contrato, nenhum nome.
 */
export async function GET(req: Request) {
  const auth = authorizePlatformCron(req, 'api/platform/jobs/health');
  if (!auth.ok) return auth.response;

  const supabase = platformServiceClient();
  const { data, error } = await supabase.rpc('apex_jobs_health');
  if (error) {
    console.error('[api/platform/jobs/health] failed', { message: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, health: data });
}

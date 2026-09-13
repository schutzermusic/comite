import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { platformServiceClient } from '@/lib/platform/server-client';
import { isDrainPaused } from '@/lib/platform/jobs/hold';

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
  /*
    Duas verdades operacionais, nenhum segredo: a CLASSE de credencial que
    autenticou (nome fixo do código, jamais o valor), e se a fila está sob
    trava. Sem a segunda, uma fila parada sob trava parece idêntica a uma fila
    parada por defeito.
  */
  return NextResponse.json({
    ok: true, caller: auth.caller, jobsDrainPaused: isDrainPaused(), health: data,
  });
}

import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { platformServiceClient } from '@/lib/platform/server-client';
import { sweepExpiredStaging } from '@/lib/commercial/proposal-staging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Limpeza diária da área de preparo de "Nova proposta" pelo PDF.
 *
 * Só apaga, em `<org>/proposals/_staging/`, o que passou do prazo e que nenhum
 * documento canônico referencia (`staging-sweep.ts`). PDF adotado por uma
 * revisão já foi MOVIDO para a pasta da proposta e nem aparece aqui.
 *
 * Autenticação: só `Authorization: Bearer` de plataforma, pelo mesmo módulo
 * dos outros agendadores. `?dryRun=1` relata sem apagar.
 */
export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  const auth = authorizePlatformCron(req, 'api/platform/jobs/commercial-staging-sweep');
  if (!auth.ok) return auth.response;
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';

  const { data: orgs, error } = await platformServiceClient().from('organizations').select('id');
  if (error) {
    return NextResponse.json({ ok: false, error: 'Falha ao listar organizações.' }, { status: 500 });
  }
  let scanned = 0;
  let removed = 0;
  const failures: string[] = [];
  for (const org of orgs ?? []) {
    try {
      const result = await sweepExpiredStaging({ organizationId: org.id as string, dryRun });
      scanned += result.scanned;
      removed += result.removed.length;
    } catch {
      failures.push(org.id as string);
    }
  }
  return NextResponse.json({ ok: failures.length === 0, dryRun, organizations: (orgs ?? []).length,
    scanned, removed, failedOrganizations: failures.length });
}

/**
 * Reapura as métricas do eSocial a partir dos eventos já gravados.
 *
 * Não busca nada novo: relê o acervo e regrava os agregados com as regras
 * atuais. É o caminho para corrigir apuração sem pedir o pacote de novo ao
 * escritório — o que importa, porque a janela de retenção do eSocial Download é
 * de 7 dias e o arquivo original nem sempre pode ser obtido outra vez.
 *
 * Uso:
 *   npx tsx scripts/recompute-esocial-metrics.ts <organization_id>
 *   npx tsx scripts/recompute-esocial-metrics.ts <organization_id> --dry
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // Ambiente já carregado por fora.
  }
}

const [organizationId, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry');

if (!organizationId) {
  console.error('Informe a organização: npx tsx scripts/recompute-esocial-metrics.ts <organization_id>');
  process.exit(1);
}

const brl = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function main() {
  // Importado depois do .env porque o cliente de serviço lê as chaves na carga.
  const { recomputeMetrics } = await import('../src/lib/esocial/connector/import');
  const { readCompetenceMetrics } = await import('../src/lib/esocial/connector/store');
  const { competenceCoverage } = await import('../src/lib/workforce/esocial-coverage');

  const antes = await readCompetenceMetrics(organizationId);
  console.log(`Competências apuradas hoje: ${antes.length}\n`);

  if (dryRun) {
    console.log('--dry: nada foi gravado.');
    return;
  }

  console.log('Reapurando a partir dos eventos gravados…');
  const total = await recomputeMetrics(organizationId);
  console.log(`${total} competência(s) reapurada(s).\n`);

  const depois = await readCompetenceMetrics(organizationId);
  const monthly = depois
    .filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m.competence))
    .sort((a, b) => a.competence.localeCompare(b.competence));

  console.log(
    'competência  head  massa exibida     fonte         INSS            IRRF            FGTS         faltas  cobertura',
  );
  for (const m of monthly) {
    const c = competenceCoverage(m);
    console.log(
      [
        m.competence.padEnd(11),
        String(m.headcount).padStart(5),
        c.payroll.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).padStart(16),
        c.payrollSource.padEnd(13),
        brl(m.inss_cents).padStart(14),
        brl(m.irrf_cents).padStart(15),
        brl(m.fgts_cents).padStart(14),
        String(m.absence_days).padStart(7),
        `${(c.rubricCoverage * 100).toFixed(1)}%`.padStart(8),
      ].join(' '),
    );
  }

  const semComposicao = monthly.filter((m) => !competenceCoverage(m).compositionReliable).length;
  if (semComposicao > 0) {
    console.log(
      `\n${semComposicao} de ${monthly.length} competências sem composição de folha: ` +
        'a tabela de rubricas (S-1010) do pacote não cobre essas folhas.',
    );
  }
}

main().catch((err) => {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

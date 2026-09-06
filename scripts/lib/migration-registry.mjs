/**
 * Registro canônico de migrations — `supabase_migrations.schema_migrations`.
 *
 * ─── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Este projeto aplica migrations por runners em `scripts/`, não por
 * `supabase db push`. Os runners são melhores no que fazem — rodam preflight,
 * asserções reais e ensaio com ROLLBACK — mas por muito tempo não gravavam
 * linha no registro. O resultado foi um registro que parou em 088 enquanto o
 * schema seguiu até 111: qualquer ferramenta que consultasse o registro
 * tentaria reaplicar migrations já aplicadas.
 *
 * A regra a partir daqui é uma só: **quem aplica, registra**. Todo runner novo
 * chama `recordMigrationApplied` dentro da MESMA transação em que aplicou o
 * arquivo. Se a transação falhar, nem o schema nem o registro mudam; se
 * cometer, os dois mudam juntos. Não existe mais um registro que descreva um
 * banco diferente do que está lá.
 *
 * Não há duas histórias: o registro é a história, e os runners são o
 * mecanismo. `assertRegistryMatches` é o que prova isso a cada execução.
 */

/**
 * Grava a versão como aplicada. Deve ser chamada DENTRO da transação da
 * migration — é isso que torna "aplicou" e "registrou" o mesmo evento.
 *
 * `statements` fica nulo de propósito: a coluna serve para replay, e replay de
 * migration já aplicada é exatamente o que não deve acontecer.
 */
export async function recordMigrationApplied(client, version, name) {
  if (!/^\d{3}$/.test(String(version))) {
    throw new Error(`Versão de migration inválida: ${version}`);
  }
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name)
     VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
    [String(version), name],
  );
}

/** Versões presentes no registro, ordenadas. */
export async function registryVersions(client) {
  const { rows } = await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
  return rows.map((r) => r.version);
}

/**
 * Confere que o registro descreve o diretório.
 *
 * `expectedAbsent` são versões que legitimamente NÃO estão no registro porque
 * nunca foram aplicadas e foram arquivadas em `supabase/migrations-superseded/`.
 * Elas precisam ser declaradas: um buraco silencioso é indistinguível de uma
 * migration esquecida, e a diferença entre as duas coisas é tudo.
 */
export async function assertRegistryMatches(client, { files, expectedAbsent = [] }) {
  const registry = new Set(await registryVersions(client));
  const problems = [];

  for (const version of files) {
    if (!registry.has(version)) problems.push(`${version}: arquivo presente, registro ausente`);
  }
  for (const version of expectedAbsent) {
    if (registry.has(version)) {
      problems.push(`${version}: marcada como aplicada, mas foi arquivada como NUNCA aplicada`);
    }
  }
  for (const version of registry) {
    if (!files.includes(version) && !expectedAbsent.includes(version)) {
      problems.push(`${version}: registrada, sem arquivo correspondente nem arquivamento declarado`);
    }
  }
  return problems;
}

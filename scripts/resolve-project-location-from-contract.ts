/**
 * RESOLVE A LOCALIZAÇÃO CANÔNICA DO PROJETO A PARTIR DO CONTRATO ASSINADO.
 *
 * Ensaio por padrão; `--apply` grava. `--project <id>` restringe.
 *
 * ─── O caminho, inteiro ───────────────────────────────────────────────────
 *
 *   contrato assinado (escopo + cláusulas)
 *     → extração de LOCAL DE EXECUÇÃO   (contract-location-evidence.ts)
 *       → geocodificação                (nominatim.ts)
 *         → PORTÃO de confiança         (geocode-gate.ts)
 *           → localização canônica do PROJETO, com proveniência
 *             → project_globe_marker → globo
 *
 * Toda a decisão mora nos dois módulos puros, que têm teste sem rede. Este
 * script é encanamento: lê, chama, grava, prova.
 *
 * ─── Idempotência ────────────────────────────────────────────────────────
 *
 * A impressão digital cobre projeto + contrato + evidência + consulta +
 * veredito. Rodar de novo com o mesmo insumo não cria linha nova: o índice
 * único a recusa e o script relata "já resolvido". É o que torna seguro
 * pendurar isto num handler de fila at-least-once.
 *
 * ─── O que ele NUNCA faz ─────────────────────────────────────────────────
 *
 *   · Não sobrescreve canônica vigente. Divergência material vira CONFLICT,
 *     e a vigente continua sendo a vigente.
 *   · Não grava coordenada que o portão recusou. Recusa vira
 *     REQUIRES_ATTENTION com o motivo, e o projeto fica FORA do globo.
 *   · Não usa sede, foro, cobrança nem correspondência. O extrator descarta
 *     o trecho inteiro ao primeiro sinal administrativo.
 */

import { createHash } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  resolveContractLocationEvidence,
  type LocationEvidenceSource,
} from '../src/lib/projects/location/contract-location-evidence';
import { decideGeocode, distanceKm } from '../src/lib/projects/location/geocode-gate';
import { geocodeNominatim, addressPartsOf } from '../src/lib/projects/location/nominatim';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const flagAt = process.argv.indexOf('--project');
const projectFilter = flagAt === -1 ? null : (process.argv[flagAt + 1] ?? null);
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const USER_AGENT = 'insight-governanca-corporativa/location-resolver (contato: ops@insight.local)';

/** Acima disto, duas resoluções falam de lugares diferentes. */
const CONFLICT_KM = 25;

const fingerprint = (parts: readonly (string | number | null)[]) =>
  createHash('sha256').update(parts.map((p) => String(p ?? '∅')).join('|')).digest('hex').slice(0, 32);

async function main() {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');

  /*
    Só projeto COM VÍNCULO de contrato. A regra é "contrato → projeto": um
    projeto sem contrato vinculado não tem de onde tirar local de execução, e
    inventar um a partir do nome do cliente seria exatamente o palpite que
    esta feature existe para não dar.
  */
  const targets = (await db.query(`
    SELECT lk.organization_id, lk.project_id, lk.contract_id,
           c.contract_number, c.scope_summary, c.title AS contract_title,
           p.project->>'codigo' AS project_code,
           p.project->>'descricao' AS project_description
      FROM public.project_contract_link_governed lk
      JOIN public.contracts c ON c.id = lk.contract_id AND c.deleted_at IS NULL
      JOIN public.projects p ON p.id = lk.project_id AND p.organization_id = lk.organization_id
     WHERE ($1::text IS NULL OR lk.project_id = $1)
     ORDER BY lk.project_id`, [projectFilter])).rows;

  console.log(`Projetos com contrato vinculado: ${targets.length}\n`);

  for (const t of targets) {
    console.log(`── ${t.project_code ?? t.project_id} ← ${t.contract_number}`);

    // ── 1. As fontes textuais do contrato assinado ───────────────────────
    const docId = (await db.query(
      `SELECT id FROM public.contract_documents
        WHERE contract_id = $1 AND document_type = 'contract'
          AND superseded_by_document_id IS NULL
        ORDER BY version DESC, created_at DESC LIMIT 1`, [t.contract_id])).rows[0]?.id ?? null;

    const clauses = (await db.query(
      `SELECT content, source_excerpt, source_document_id, source_page
         FROM public.contract_clauses
        WHERE contract_id = $1 AND superseded_by_clause_id IS NULL
        ORDER BY source_page NULLS LAST`, [t.contract_id])).rows;

    const sources: LocationEvidenceSource[] = [
      // O OBJETO do contrato é onde o local de execução costuma estar dito.
      { text: t.scope_summary ?? '', kind: 'contract_scope', documentId: docId, page: 1 },
      ...clauses.flatMap((c): LocationEvidenceSource[] => [
        { text: c.content ?? '', kind: 'contract_clause', documentId: c.source_document_id, page: c.source_page },
        { text: c.source_excerpt ?? '', kind: 'contract_clause', documentId: c.source_document_id, page: c.source_page },
      ]),
    ];

    const evidence = resolveContractLocationEvidence(sources);

    if (!evidence.candidate) {
      console.log(`   evidência: NENHUMA (${evidence.rejection})`);
      await record(t, {
        state: 'UNRESOLVED', reason: evidence.rejection, evidenceKind: 'none',
        fp: fingerprint([t.project_id, t.contract_id, 'no-evidence', evidence.rejection]),
      });
      continue;
    }

    const cand = evidence.candidate;
    console.log(`   evidência: "${cand.siteLabel}" (${cand.evidenceKind}, p.${cand.sourcePage})`);

    // ── 2. Geocodificação ────────────────────────────────────────────────
    let results: Awaited<ReturnType<typeof geocodeNominatim>> = [];
    try {
      results = await geocodeNominatim(cand.geocodeQuery, {
        userAgent: USER_AGENT, countryCodes: 'br', limit: 10,
      });
      await new Promise((r) => setTimeout(r, 1200));   // política de uso do Nominatim
    } catch (e) {
      console.log(`   geocodificação FALHOU: ${(e as Error).message}`);
    }
    console.log(`   candidatos: ${results.length}`);
    for (const r of results.slice(0, 6)) {
      console.log(`     · [${r.precision}] ${r.latitude.toFixed(4)},${r.longitude.toFixed(4)} — ${r.displayName.slice(0, 80)}`);
    }

    // ── 3. O portão ──────────────────────────────────────────────────────
    const decision = decideGeocode(results);
    if (!decision.accepted) {
      console.log(`   PORTÃO RECUSOU: ${decision.rejection}`
        + (decision.spreadKm ? ` (dispersão ${decision.spreadKm.toFixed(1)} km)` : ''));
      await record(t, {
        state: 'REQUIRES_ATTENTION', reason: decision.rejection, evidenceKind: cand.evidenceKind,
        cand, fp: fingerprint([t.project_id, t.contract_id, cand.siteLabel, decision.rejection]),
      });
      continue;
    }

    const acc = decision.accepted;
    const parts = addressPartsOf(acc);
    console.log(`   ACEITO: ${acc.latitude.toFixed(6)}, ${acc.longitude.toFixed(6)}`
      + ` [${acc.precision}] ${parts.municipality ?? '?'}/${parts.stateCode ?? '?'}`);

    await record(t, {
      state: 'RESOLVED', reason: null, evidenceKind: cand.evidenceKind, cand,
      lat: acc.latitude, lon: acc.longitude, precision: acc.precision,
      municipality: parts.municipality, stateCode: parts.stateCode,
      displayName: acc.displayName, raw: acc.raw,
      fp: fingerprint([t.project_id, t.contract_id, cand.siteLabel, 'RESOLVED',
        acc.latitude.toFixed(5), acc.longitude.toFixed(5)]),
    });
  }

  // ── A prova final: um marcador por projeto, nenhum duplicado ──────────
  const markers = (await db.query(`SELECT project_id, project_code, latitude, longitude,
    precision, site_label, municipality, state_code, source_page, geocoder
    FROM public.project_globe_marker ORDER BY project_code`)).rows;
  console.log('\nMarcadores no globo:');
  console.table(markers);

  const dup = (await db.query(`SELECT project_id, count(*)::int n
    FROM public.project_globe_marker GROUP BY 1 HAVING count(*) > 1`)).rows;
  if (dup.length) throw new Error(`MARCADOR DUPLICADO: ${JSON.stringify(dup)}`);

  const pending = (await db.query(`SELECT project_code, resolution_state, attention_reason
    FROM public.project_location_attention ORDER BY project_code`)).rows;
  console.log('Pendências de localização:');
  console.table(pending);

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
}

interface RecordArgs {
  state: 'RESOLVED' | 'UNRESOLVED' | 'REQUIRES_ATTENTION';
  reason: string | null;
  evidenceKind: string;
  fp: string;
  cand?: { siteLabel: string; sourceDocumentId: string | null; sourcePage: number | null;
           sourceExcerpt: string; geocodeQuery: string };
  lat?: number; lon?: number; precision?: string;
  municipality?: string | null; stateCode?: string | null;
  displayName?: string; raw?: unknown;
}

/**
 * Grava a resolução — ou reconhece que ela já existe, ou registra o conflito.
 *
 * Três caminhos, e o terceiro é o que protege o trabalho humano já feito.
 */
async function record(t: Record<string, string>, a: RecordArgs) {
  const live = (await db.query(
    `SELECT * FROM public.project_canonical_location
      WHERE organization_id=$1 AND project_id=$2 AND superseded_at IS NULL`,
    [t.organization_id, t.project_id])).rows[0];

  // Idempotência: o mesmo insumo já produziu esta linha.
  if (live && live.resolution_fingerprint === a.fp) {
    console.log('   → já resolvido com este mesmo insumo (idempotente, nada a fazer)');
    return;
  }

  /*
    CONFLITO. Há canônica RESOLVED vigente e a nova resolução aponta para
    outro lugar. A vigente NÃO é tocada; o conflito é gravado ao lado, para
    que alguém compare. Sobrescrever aqui apagaria, sem aviso, uma coordenada
    que talvez tenha sido conferida em campo.
  */
  if (live && live.resolution_state === 'RESOLVED' && a.state === 'RESOLVED'
      && live.latitude !== null && a.lat !== undefined) {
    const km = distanceKm(
      { latitude: live.latitude, longitude: live.longitude },
      { latitude: a.lat, longitude: a.lon! },
    );
    if (km > CONFLICT_KM) {
      console.log(`   → CONFLITO: canônica vigente está a ${km.toFixed(1)} km. Vigente PRESERVADA.`);
      await insert(t, { ...a, state: 'CONFLICT' as never,
        reason: `divergência de ${km.toFixed(1)} km da canônica v${live.version}`,
        fp: `${a.fp}:conflict` }, live.version + 1, /* live */ false);
      return;
    }
    console.log(`   → confirma a canônica vigente (${km.toFixed(2)} km). Nada a superar.`);
    return;
  }

  if (live) {
    await db.query(
      `UPDATE public.project_canonical_location SET superseded_at = now() WHERE id = $1`, [live.id]);
  }
  await insert(t, a, (live?.version ?? 0) + 1, true);
  console.log(`   → gravado ${a.state} (v${(live?.version ?? 0) + 1})`);

  // Espelha a UF apurada no project_v2 — o mapa de calor e filtros de
  // carteira leem isso mesmo se o marcador canônico falhar no cliente.
  if (a.state === 'RESOLVED' && a.stateCode) {
    await db.query(`
      UPDATE public.projects
         SET project_v2 = COALESCE(project_v2, '{}'::jsonb)
           || jsonb_build_object(
                'uf', $1::text,
                'location', COALESCE(project_v2->'location', '{}'::jsonb)
                  || jsonb_build_object(
                       'uf', $1::text,
                       'city', COALESCE($2::text, project_v2->'location'->>'city'),
                       'lat', COALESCE($3::float8, (project_v2->'location'->>'lat')::float8),
                       'lng', COALESCE($4::float8, (project_v2->'location'->>'lng')::float8)
                     )
              )
       WHERE id = $5 AND organization_id = $6
    `, [a.stateCode, a.municipality ?? null, a.lat ?? null, a.lon ?? null, t.project_id, t.organization_id]);
    console.log(`   → project_v2.uf = ${a.stateCode}`);
  }
}

async function insert(
  t: Record<string, string>, a: RecordArgs, version: number, isLive: boolean,
) {
  await db.query(`
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, attention_reason,
       site_label, normalized_address, municipality, state_code,
       latitude, longitude, precision,
       evidence_kind, source_contract_id, source_document_id, source_page, source_excerpt,
       geocoder, geocode_query, geocode_raw, geocoded_at, version, resolution_fingerprint,
       superseded_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
  [
    t.organization_id, t.project_id, a.state, a.reason,
    a.cand?.siteLabel ?? null, a.displayName ?? null, a.municipality ?? null, a.stateCode ?? null,
    a.lat ?? null, a.lon ?? null, a.precision ?? null,
    a.evidenceKind, t.contract_id, a.cand?.sourceDocumentId ?? null,
    a.cand?.sourcePage ?? null, a.cand?.sourceExcerpt ?? null,
    a.lat !== undefined ? 'nominatim' : null, a.cand?.geocodeQuery ?? null,
    a.raw ? JSON.stringify(a.raw) : null, a.lat !== undefined ? new Date().toISOString() : null,
    version, a.fp,
    // Linha de CONFLITO nasce já superada: ela é registro para comparação, e
    // não candidata a virar o ponto do globo por conta própria.
    isLive ? null : new Date().toISOString(),
  ]);
}

main().catch(async (e) => {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
}).finally(() => db.end());

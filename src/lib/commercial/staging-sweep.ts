/**
 * Limpeza da área de preparo de "Nova proposta" pelo PDF — a regra, sem I/O.
 *
 * O PDF preparado ou é ADOTADO (o registro canônico o MOVE para a pasta da
 * proposta) ou é descartado quando a pessoa cancela. O que sobra na área de
 * preparo depois do prazo é abandono: aba fechada, rede caída, sessão que
 * expirou. Esta função decide o que apagar, e é conservadora:
 *
 *   * só dentro de `<org>/proposals/_staging/` — nunca fora;
 *   * só o que passou do TTL, contado do momento do envio;
 *   * nunca um caminho que algum documento canônico referencia (defesa extra:
 *     a adoção move o arquivo, então isso não deveria existir — mas se
 *     existir, o arquivo fica);
 *   * a leitura guardada (`.apex.json`) segue o destino do seu PDF, e a
 *     leitura órfã (PDF já adotado ou apagado) também expira.
 */

export const STAGED_PDF_TTL_MS = 24 * 60 * 60 * 1000;
/** Nunca menos que isto, mesmo configurado errado: uma revisão em curso não some. */
export const STAGED_PDF_MIN_TTL_MS = 2 * 60 * 60 * 1000;

export interface StagedObject {
  /** Caminho completo no bucket. */
  path: string;
  /** ISO do envio. Sem data, o objeto não é tocado. */
  createdAt: string | null;
}

const SIDECAR = '.apex.json';
const isStagingPath = (path: string) => /^[0-9a-f-]{36}\/proposals\/_staging\/[0-9a-f-]{36}\/[^/]+$/i.test(path);

export function expiredStagedPaths(
  objects: StagedObject[],
  options: { now: Date; ttlMs?: number; protectedPaths?: Iterable<string> },
): string[] {
  const ttl = Math.max(options.ttlMs ?? STAGED_PDF_TTL_MS, STAGED_PDF_MIN_TTL_MS);
  const cutoff = options.now.getTime() - ttl;
  const protectedSet = new Set(options.protectedPaths ?? []);
  const byPath = new Map(objects.filter((o) => isStagingPath(o.path)).map((o) => [o.path, o]));
  const expired = (o: StagedObject | undefined) => {
    if (!o?.createdAt) return false;
    const at = Date.parse(o.createdAt);
    return Number.isFinite(at) && at < cutoff;
  };

  const out = new Set<string>();
  for (const object of byPath.values()) {
    if (object.path.endsWith(SIDECAR)) {
      const pdf = object.path.slice(0, -SIDECAR.length);
      const owner = byPath.get(pdf);
      // Leitura órfã expira sozinha; a de um PDF vivo segue o PDF.
      if (!owner && expired(object) && !protectedSet.has(pdf)) out.add(object.path);
      continue;
    }
    if (protectedSet.has(object.path) || !expired(object)) continue;
    out.add(object.path);
    if (byPath.has(object.path + SIDECAR)) out.add(object.path + SIDECAR);
  }
  return [...out].sort();
}

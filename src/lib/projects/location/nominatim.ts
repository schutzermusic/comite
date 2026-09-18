/**
 * ADAPTADOR DO NOMINATIM — a única parte desta feature que toca a rede.
 *
 * Fica separado do portão (`geocode-gate.ts`) de propósito: o portão é a
 * regra, e regra tem de ser testável sem internet. Aqui só mora a tradução do
 * formato do provedor para `GeocodeResult`, e essa tradução é onde a
 * PRECISÃO é atribuída — o campo do qual depende toda a decisão seguinte.
 *
 * O repositório já usa o Nominatim em `services/geofence.ts` para geocodificar
 * endereço digitado. Trocar de provedor aqui seria acrescentar uma segunda
 * dependência externa para resolver o mesmo problema.
 */

import type { GeocodeResult, GeocodePrecision } from './geocode-gate';

/**
 * A que granularidade corresponde cada classe do OSM.
 *
 * O mapeamento é conservador: o que não está listado vira `unknown`, e
 * `unknown` não passa no portão. Um provedor que invente uma classe nova não
 * consegue, por isso, produzir uma coordenada aceita por omissão.
 */
function precisionOf(r: {
  category?: string; class?: string; type?: string; addresstype?: string; place_rank?: number;
}): GeocodePrecision {
  /*
    `jsonv2` chama o campo de `category`; o formato `json` legado chama de
    `class`. Ler só um dos dois fazia TODO resultado cair em `unknown` — e
    `unknown` não passa no portão, então a feature inteira falhava fechada por
    um nome de campo, com a aparência de uma recusa legítima por imprecisão.
    Essa é a pior forma de bug de segurança-por-cautela: ele se parece com o
    sistema funcionando.
  */
  const cls = r.category ?? r.class ?? '';
  const type = r.type ?? '';

  // Instalação identificável: barragem, usina, subestação, obra de arte.
  if (cls === 'waterway' && (type === 'dam' || type === 'weir')) return 'site';
  if (cls === 'power') return 'site';                       // plant, substation, generator
  if (cls === 'man_made') return 'site';
  if (cls === 'landuse' && type === 'industrial') return 'site';
  if (cls === 'building') return 'site';
  if (cls === 'amenity' || cls === 'industrial') return 'site';

  // Cidade/município: aceitável, porém mais grosso.
  if (cls === 'place' && ['city', 'town', 'village', 'municipality', 'hamlet'].includes(type)) {
    return 'municipality';
  }
  if (cls === 'boundary' && type === 'administrative') {
    // `place_rank` do OSM: ~13-16 é estado, ~16-18 município.
    const rank = r.place_rank ?? 0;
    if (rank >= 16) return 'municipality';
    return 'region';
  }
  if (cls === 'place' && ['state', 'region', 'province'].includes(type)) return 'region';
  if (cls === 'place' && type === 'country') return 'country';

  return 'unknown';
}

export interface NominatimOptions {
  /** O Nominatim exige identificação. Sem ela a chamada é recusada. */
  readonly userAgent: string;
  /** Restringe o país. 'br' para este produto. */
  readonly countryCodes?: string;
  readonly limit?: number;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Consulta o gazeteer e devolve TODOS os candidatos.
 *
 * Devolver a lista inteira, e não o primeiro resultado, é o que permite ao
 * portão detectar ambiguidade. Um adaptador que já escolhesse por conta
 * própria esconderia do portão exatamente a informação que ele precisa para
 * recusar.
 */
export async function geocodeNominatim(
  query: string,
  opts: NominatimOptions,
): Promise<readonly GeocodeResult[]> {
  const endpoint = opts.endpoint ?? 'https://nominatim.openstreetmap.org/search';
  const doFetch = opts.fetchImpl ?? fetch;
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(opts.limit ?? 10));
  if (opts.countryCodes) url.searchParams.set('countrycodes', opts.countryCodes);

  const res = await doFetch(url.toString(), {
    headers: { 'User-Agent': opts.userAgent, 'Accept-Language': 'pt-BR' },
  });
  if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);

  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return [];

  return body.flatMap((raw): GeocodeResult[] => {
    const r = raw as Record<string, unknown>;
    const latitude = Number(r.lat);
    const longitude = Number(r.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      latitude,
      longitude,
      displayName: String(r.display_name ?? ''),
      precision: precisionOf(r as never),
      importance: typeof r.importance === 'number' ? r.importance : null,
      raw,
    }];
  });
}

/** O município e a UF que o provedor devolveu, quando devolveu. */
export function addressPartsOf(result: GeocodeResult): {
  municipality: string | null; stateCode: string | null;
} {
  const addr = (result.raw as { address?: Record<string, string> } | undefined)?.address;
  if (!addr) return { municipality: null, stateCode: null };
  const municipality = addr.city ?? addr.town ?? addr.municipality ?? addr.village ?? null;
  return { municipality, stateCode: addr['ISO3166-2-lvl4']?.replace('BR-', '') ?? null };
}

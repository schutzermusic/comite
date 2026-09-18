/**
 * O PORTÃO DO GEOCODIFICADOR — lógica pura, sem rede.
 *
 * ─── O que um geocodificador devolve, e por que isso é perigoso ───────────
 *
 * Um gazeteer SEMPRE devolve alguma coisa. Peça "UHE Cachoeira Dourada" e ele
 * pode responder com a usina, com o município homônimo, com a fronteira do
 * estado, ou com o centroide do país — e todos os quatro chegam no mesmo
 * formato, com a mesma cara de sucesso. Aceitar o primeiro resultado é como o
 * produto passa a afirmar coordenada que ninguém verificou.
 *
 * Este arquivo é o portão: ele recebe a lista crua de resultados e decide se
 * ALGUM deles é bom o bastante para virar a localização canônica de um
 * projeto. Ele erra para o lado de recusar.
 *
 * ─── As quatro recusas ───────────────────────────────────────────────────
 *
 *   NO_RESULT              — o gazeteer não achou nada.
 *   AMBIGUOUS_RESULTS      — achou lugares DIFERENTES, longe um do outro.
 *   INSUFFICIENT_PRECISION — achou, mas no nível de estado ou país.
 *   IMPLAUSIBLE_COORDINATE — achou coordenada fora do envelope aceitável.
 *
 * Nenhuma delas devolve coordenada. `requires_attention` é o desfecho, e é um
 * desfecho legítimo: um projeto sem ponto no globo é menos danoso que um
 * projeto com o ponto errado, porque o ponto errado ninguém confere.
 */

/** Um resultado cru do gazeteer, já normalizado para o mínimo que importa. */
export interface GeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly displayName: string;
  /**
   * Quão fino é o objeto encontrado. É o campo que separa "a usina" de
   * "o país onde fica a usina".
   */
  readonly precision: GeocodePrecision;
  /** Confiança do provedor, 0..1, quando ele oferece uma. */
  readonly importance: number | null;
  readonly raw: unknown;
}

/**
 * Granularidade do que o gazeteer encontrou.
 *
 * `site` e `municipality` são aceitáveis; `region` e `country` não são. Um
 * ponto no centro de Goiás não localiza uma unidade geradora.
 */
export type GeocodePrecision = 'site' | 'municipality' | 'region' | 'country' | 'unknown';

export type GeocodeRejectionReason =
  | 'NO_RESULT'
  | 'AMBIGUOUS_RESULTS'
  | 'INSUFFICIENT_PRECISION'
  | 'IMPLAUSIBLE_COORDINATE';

export interface GeocodeDecision {
  readonly accepted: GeocodeResult | null;
  readonly rejection: GeocodeRejectionReason | null;
  /** Distância, em km, entre os dois candidatos mais distantes. */
  readonly spreadKm: number | null;
  readonly considered: readonly GeocodeResult[];
}

/** Precisões que localizam de fato. */
const ACCEPTABLE: readonly GeocodePrecision[] = ['site', 'municipality'];

/**
 * Quanto dois resultados podem divergir e ainda serem "o mesmo lugar".
 *
 * 25 km cobre um reservatório e suas duas margens — a UHE Cachoeira Dourada
 * fica no Paranaíba, entre Goiás e Minas, e o gazeteer costuma devolver a
 * casa de força e o município de cada lado. Acima disso são lugares
 * diferentes, e escolher um deles é palpite.
 */
const SAME_PLACE_KM = 25;

/** Envelope do Brasil continental, com folga. Fora dele, algo deu errado. */
const ENVELOPE = { minLat: -34.5, maxLat: 6.0, minLon: -74.5, maxLon: -33.0 };

/** Haversine. Existe aqui para o teste não precisar de rede nem de PostGIS. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function plausible(r: GeocodeResult): boolean {
  return Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
    && r.latitude >= ENVELOPE.minLat && r.latitude <= ENVELOPE.maxLat
    && r.longitude >= ENVELOPE.minLon && r.longitude <= ENVELOPE.maxLon
    // 0,0 é o resultado clássico de um campo numérico vazio, não um lugar.
    && !(r.latitude === 0 && r.longitude === 0);
}

/**
 * A coordenada que o projeto pode adotar — ou a razão de não adotar nenhuma.
 *
 * A ordem das recusas importa: um resultado impreciso E ambíguo é reportado
 * como impreciso, porque precisão é o defeito que a próxima consulta pode
 * corrigir sozinha.
 */
export function decideGeocode(results: readonly GeocodeResult[]): GeocodeDecision {
  if (results.length === 0) {
    return { accepted: null, rejection: 'NO_RESULT', spreadKm: null, considered: [] };
  }

  const inEnvelope = results.filter(plausible);
  if (inEnvelope.length === 0) {
    return {
      accepted: null, rejection: 'IMPLAUSIBLE_COORDINATE', spreadKm: null, considered: results,
    };
  }

  const precise = inEnvelope.filter((r) => ACCEPTABLE.includes(r.precision));
  if (precise.length === 0) {
    return {
      accepted: null, rejection: 'INSUFFICIENT_PRECISION', spreadKm: null, considered: results,
    };
  }

  let spread = 0;
  for (let i = 0; i < precise.length; i += 1) {
    for (let j = i + 1; j < precise.length; j += 1) {
      spread = Math.max(spread, distanceKm(precise[i], precise[j]));
    }
  }
  if (spread > SAME_PLACE_KM) {
    return {
      accepted: null, rejection: 'AMBIGUOUS_RESULTS', spreadKm: spread, considered: results,
    };
  }

  // Entre candidatos do mesmo lugar, prefere a instalação ao município: o
  // ponto da casa de força é mais útil que o da praça central da cidade.
  const accepted = [...precise].sort((a, b) => {
    const rank = (r: GeocodeResult) => (r.precision === 'site' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (b.importance ?? 0) - (a.importance ?? 0);
  })[0];

  return { accepted, rejection: null, spreadKm: spread, considered: results };
}

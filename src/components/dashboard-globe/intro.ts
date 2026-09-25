/**
 * A ABERTURA DO FILME — Terra → Brasil → a vista pedida, numa trilha de chaves.
 *
 * Fonte: `APEX FILM/js/world/camera-track.js`. Cada canal (lat, lng, distância
 * em log, inclinação, rumo, ox, oy) passa por uma spline cúbica MONÓTONA
 * (Fritsch–Carlson): a câmera mantém a velocidade entre chaves em vez de parar
 * em cada uma; `hold` zera a velocidade na chave. Onde a distância muda em
 * ordens de grandeza (|Δ ln d| > 1.5) o alvo é guiado na tela, como no voo.
 *
 * As três primeiras chaves são as do filme (a própria abertura do produto:
 * `GLOBAL_INTRO_VIEW` a 28.000 km e a vista do Brasil a 9.500 km). A última é a
 * vista inicial do Dashboard; o tempo dela cresce com a profundidade do
 * mergulho (portfólio ≈ 4,4 s; um local a 1,4 km ≈ 7,0 s, como no filme).
 * Sob `prefers-reduced-motion` o componente nem monta a trilha.
 */
import type { CameraView } from './contract';
import { clamp, sanitizeView, shortestArc, wrap180 } from './camera';

export interface TrackKey extends CameraView {
  /** Instante da chave (s). */
  t: number;
  /** Velocidade zero nesta chave. */
  hold?: boolean;
}

/** Terra (28.000 km, a abertura do produto) → deriva lenta → Brasil (9.500 km). */
export const INTRO_KEYS: readonly TrackKey[] = Object.freeze([
  { t: 0, lat: 3.995, lng: -37.999, dist: 28_000, pitch: 89.9, heading: -18, ox: 0, oy: 0, hold: true },
  { t: 1.3, lat: 3.201, lng: -39.495, dist: 26_500, pitch: 89.9, heading: -18, ox: 0, oy: 0 },
  { t: 3.2, lat: -14.23, lng: -54.5, dist: 9_500, pitch: 88, heading: -8, ox: 40, oy: 20 },
]);

/** Até este instante (s) a trilha não depende da chave final: trocar o destino não mexe na câmera. */
export const INTRO_RETARGET_UNTIL = 1.3;

type Channel = 'lat' | 'lng' | 'pitch' | 'heading' | 'ox' | 'oy' | 'logD';

export interface IntroTrack {
  keys: TrackKey[];
  ts: number[];
  logD: number[];
  channels: Record<Channel, { vs: number[]; ms: number[] }>;
  /** Duração total (s). */
  duration: number;
}

/** Tempo do último trecho: cresce com o mergulho (log da razão de distâncias). */
export function finalSegmentSeconds(fromDist: number, toDist: number): number {
  const r = Math.log(Math.max(fromDist, 1e-6) / Math.max(toDist, 1e-6));
  return clamp(0.43 * (Number.isFinite(r) ? r : 0), 1.2, 3.8);
}

/** Tangentes monótonas (Fritsch–Carlson) de um canal, com chaves de parada. */
export function monotoneTangents(ts: number[], vs: number[], holds: boolean[]): number[] {
  const n = ts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  m[0] = holds[0] ? 0 : d[0];
  m[n - 1] = holds[n - 1] ? 0 : d[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (holds[i] || d[i - 1] * d[i] <= 0) m[i] = 0;
    else m[i] = (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return m;
}

function hermite(t: number, i: number, ts: number[], vs: number[], ms: number[]): number {
  const h = ts[i + 1] - ts[i];
  const u = (t - ts[i]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * vs[i] +
    (u3 - 2 * u2 + u) * h * ms[i] +
    (-2 * u3 + 3 * u2) * vs[i + 1] +
    (u3 - u2) * h * ms[i + 1]
  );
}

/** Monta a trilha da abertura até `finalView` (sanitizada; rumo e longitude desenrolados). */
export function buildIntroTrack(finalView: CameraView): IntroTrack {
  const target = sanitizeView(finalView);
  const base = INTRO_KEYS.map((k) => ({ ...k }));
  const brazil = base[base.length - 1];
  const last: TrackKey = {
    ...target,
    // desenrola para a spline não dar a volta: rumo e longitude pelo lado mais curto
    heading: brazil.heading + shortestArc(brazil.heading, target.heading),
    lng: brazil.lng + shortestArc(brazil.lng, target.lng),
    t: brazil.t + finalSegmentSeconds(brazil.dist, target.dist),
    hold: true,
  };
  const keys = [...base, last];
  const ts = keys.map((k) => k.t);
  const holds = keys.map((k) => Boolean(k.hold));
  const logD = keys.map((k) => Math.log(k.dist));
  const mk = (vs: number[]) => ({ vs, ms: monotoneTangents(ts, vs, holds) });
  const channels = {
    lat: mk(keys.map((k) => k.lat)),
    lng: mk(keys.map((k) => k.lng)),
    pitch: mk(keys.map((k) => k.pitch)),
    heading: mk(keys.map((k) => k.heading)),
    ox: mk(keys.map((k) => k.ox)),
    oy: mk(keys.map((k) => k.oy)),
    logD: mk(logD),
  };
  return { keys, ts, logD, channels, duration: ts[ts.length - 1] };
}

export interface IntroSample {
  cam: CameraView;
  /** Fração LINEAR do tempo da abertura (0..1). */
  arrive: number;
  done: boolean;
}

/** A câmera da abertura no instante `t` (s desde o início). */
export function sampleIntro(track: IntroTrack, tIn: number): IntroSample {
  const { ts, keys, channels, logD, duration } = track;
  const t = clamp(Number.isFinite(tIn) ? tIn : duration, ts[0], ts[ts.length - 1]);
  let i = 0;
  while (i < ts.length - 2 && t > ts[i + 1]) i += 1;
  const v = (ch: Channel) => hermite(t, i, ts, channels[ch].vs, channels[ch].ms);
  const ld = v('logD');
  const dist = Math.exp(ld);
  let lat: number;
  let lng: number;
  const a = keys[i];
  const b = keys[i + 1];
  if (Math.abs(logD[i + 1] - logD[i]) > 1.5) {
    // alvo guiado na tela (ver camera.ts)
    const w = clamp((ld - logD[i]) / (logD[i + 1] - logD[i]));
    if (b.dist < a.dist) {
      const k = (1 - w) * (dist / a.dist);
      lat = b.lat - (b.lat - a.lat) * k;
      lng = b.lng - (b.lng - a.lng) * k;
    } else {
      const k = w * (dist / b.dist);
      lat = a.lat + (b.lat - a.lat) * k;
      lng = a.lng + (b.lng - a.lng) * k;
    }
  } else {
    lat = v('lat');
    lng = v('lng');
  }
  const cam = sanitizeView({
    lat,
    lng: wrap180(lng),
    dist,
    pitch: v('pitch'),
    heading: v('heading'),
    ox: v('ox'),
    oy: v('oy'),
  }, keys[keys.length - 1]);
  const arrive = duration > 0 ? clamp(t / duration) : 1;
  return { cam, arrive, done: t >= duration };
}

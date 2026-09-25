/**
 * A CÂMERA DO FILME — o voo entre vistas do protótipo APEX FILM, sem Cesium.
 *
 * Fonte: `APEX FILM/js/app/app.js:62-101` (voo, respiração) e
 * `js/world/globe.js:121-139` (enquadramento fora do centro). Tudo aqui é puro
 * (sem DOM, sem Cesium) e testado em `tests/unit/dashboard-globe-camera.test.ts`.
 *
 * O voo:
 *  - começa da câmera ATUAL (mesmo no meio de outro voo);
 *  - distância em espaço LOGARÍTMICO;
 *  - curva `cine` = cubic-bezier(0.42, 0, 0.12, 1);
 *  - duração clamp(1 + 0.3·|ln(d1/d0)|, 1, 3.2) s;
 *  - rumo pelo arco mais curto;
 *  - nos mergulhos grandes (|Δ ln d| > 1.5) o alvo é "guiado" na tela: o
 *    destino desliza até a marca em vez de chicotear no fim do zoom;
 *  - inclinação e deslocamentos ox/oy em interpolação linear na curva.
 */
import type { CameraView } from './contract';

export const DEG = Math.PI / 180;
/** Campo de visão VERTICAL fixo do filme, em graus. */
export const VFOV_DEG = 32;
/** Distância mínima/máxima aceitas (km). */
export const DIST_MIN_KM = 0.05;
export const DIST_MAX_KM = 60_000;
/** Abaixo desta distância (km), parado, o rumo "respira". */
export const BREATH_MAX_DIST_KM = 2;
/** Amplitude (graus) e frequência angular (rad/s) da respiração: período ≈ 70 s. */
export const BREATH_AMPLITUDE_DEG = 2.5;
export const BREATH_RATE = 0.09;

/** Brasil inteiro — a vista neutra quando nada é válido. */
export const FALLBACK_VIEW: CameraView = Object.freeze({
  lat: -14.235,
  lng: -54.5,
  dist: 5200,
  pitch: 52,
  heading: 0,
  ox: 0,
  oy: 0,
});

/* ── Matemática básica ──────────────────────────────────────────────────── */

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fração 0..1 de `v` entre `a` e `b` (aceita a > b). */
export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return v >= b ? 1 : 0;
  return clamp((v - a) / (b - a));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Ângulo em graus levado para (−180, 180]. */
export function wrap180(deg: number): number {
  if (!finite(deg)) return 0;
  if (deg > -180 && deg <= 180) return deg; // já na faixa: sem ruído de arredondamento
  const r = ((deg % 360) + 360) % 360; // [0, 360)
  return r > 180 ? r - 360 : r;
}

/** Quanto girar (graus) de `from` para `to` pelo arco mais curto: (−180, 180]. */
export function shortestArc(from: number, to: number): number {
  if (!finite(from) || !finite(to)) return 0;
  return wrap180(to - from);
}

/**
 * cubic-bezier do CSS (Newton + bissecção), como `util.js:15-43` do filme.
 * Retorna `y(x)` com x em 0..1 (fora disso, satura).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (!(x > 0)) return 0; // também cobre NaN
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-7) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** A curva da câmera: começo suave, a maior parte do trajeto entre 15% e 45% do tempo, pouso longo. */
export const easeCine = cubicBezier(0.42, 0, 0.12, 1);

/** Aproximação exponencial por quadro, independente da taxa de quadros (`app.js:105-109`). */
export function approach(current: number, target: number, dt: number, rate: number): number {
  if (!finite(current)) return finite(target) ? target : 0;
  if (!finite(target)) return current;
  const k = 1 - Math.exp(-Math.max(0, finite(dt) ? dt : 0) * rate);
  return current + (target - current) * k;
}

/* ── Vista ───────────────────────────────────────────────────────────────── */

function safeDist(d: unknown, fallback: number): number {
  if (!finite(d) || d <= 0) return fallback;
  return clamp(d, DIST_MIN_KM, DIST_MAX_KM);
}

/**
 * Vista sempre finita e dentro da faixa: nada não-finito chega ao Cesium.
 * Campos inválidos caem no `fallback` (ou em 0 para ox/oy).
 */
export function sanitizeView(
  v: Partial<CameraView> | null | undefined,
  fallback: CameraView = FALLBACK_VIEW,
): CameraView {
  const fb = fallback === FALLBACK_VIEW ? FALLBACK_VIEW : sanitizeView(fallback, FALLBACK_VIEW);
  const src = v ?? {};
  return {
    lat: finite(src.lat) ? clamp(src.lat, -89.5, 89.5) : fb.lat,
    lng: finite(src.lng) ? wrap180(src.lng) : fb.lng,
    dist: safeDist(src.dist, fb.dist),
    pitch: finite(src.pitch) ? clamp(src.pitch, 0, 89.9) : fb.pitch,
    heading: finite(src.heading) ? src.heading : fb.heading,
    ox: finite(src.ox) ? clamp(src.ox, -4000, 4000) : 0,
    oy: finite(src.oy) ? clamp(src.oy, -4000, 4000) : 0,
  };
}

/** Mesma vista (tolerâncias de câmera: nada perceptível na tela). */
export function viewsEqual(a: CameraView | null | undefined, b: CameraView | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.lat - b.lat) < 1e-7 &&
    Math.abs(shortestArc(a.lng, b.lng)) < 1e-7 &&
    Math.abs(a.dist - b.dist) <= Math.max(1e-6, Math.abs(b.dist) * 1e-6) &&
    Math.abs(a.pitch - b.pitch) < 1e-4 &&
    Math.abs(shortestArc(a.heading, b.heading)) < 1e-4 &&
    Math.abs(a.ox - b.ox) < 0.01 &&
    Math.abs(a.oy - b.oy) < 0.01
  );
}

/* ── Voo ─────────────────────────────────────────────────────────────────── */

/** Duração do voo (s): clamp(1 + 0.3·|ln(d1/d0)|, 1, 3.2). */
export function flightDuration(d0: number, d1: number): number {
  const a = safeDist(d0, FALLBACK_VIEW.dist);
  const b = safeDist(d1, a);
  return clamp(1 + 0.3 * Math.abs(Math.log(b / a)), 1, 3.2);
}

export interface Flight {
  from: CameraView;
  to: CameraView;
  /** Início, no relógio do laço (s). */
  t0: number;
  /** Duração (s). */
  dur: number;
  /** Mergulho/subida grande: alvo guiado na tela. */
  steer: boolean;
  /** Giro de rumo pelo arco mais curto (graus). */
  dh: number;
  /** Deslocamento de longitude pelo lado mais curto (graus). */
  dlng: number;
}

export function createFlight(from: CameraView, to: CameraView, t0: number): Flight {
  const f = sanitizeView(from);
  const tt = sanitizeView(to, f);
  const l0 = Math.log(f.dist);
  const l1 = Math.log(tt.dist);
  return {
    from: f,
    to: tt,
    t0: finite(t0) ? t0 : 0,
    dur: flightDuration(f.dist, tt.dist),
    steer: Math.abs(l1 - l0) > 1.5,
    dh: shortestArc(f.heading, tt.heading),
    dlng: shortestArc(f.lng, tt.lng),
  };
}

/** A câmera do voo na fração ESFORÇADA `u` (0..1, já passada pela curva). */
export function stepCamera(fl: Flight, uIn: number): CameraView {
  const u = clamp(finite(uIn) ? uIn : 1);
  const { from, to } = fl;
  const l0 = Math.log(from.dist);
  const l1 = Math.log(to.dist);
  const dist = Math.exp(lerp(l0, l1, u));
  let lat: number;
  let k: number; // fração do caminho em lat/lng já percorrida
  if (fl.steer) {
    if (to.dist < from.dist) {
      // mergulho: o que falta encolhe com a distância — o destino segura o lugar na tela
      const rest = (1 - u) * (dist / from.dist);
      lat = to.lat - (to.lat - from.lat) * rest;
      k = 1 - rest;
    } else {
      // subida: o ponto de partida fica preso na tela até perto da altitude final
      k = u * (dist / to.dist);
      lat = from.lat + (to.lat - from.lat) * k;
    }
  } else {
    k = u;
    lat = lerp(from.lat, to.lat, u);
  }
  return {
    lat,
    lng: wrap180(from.lng + fl.dlng * k),
    dist,
    pitch: lerp(from.pitch, to.pitch, u),
    heading: from.heading + fl.dh * u,
    ox: lerp(from.ox, to.ox, u),
    oy: lerp(from.oy, to.oy, u),
  };
}

export interface FlightSample {
  cam: CameraView;
  /** Fração LINEAR do tempo (0..1) — é o que os painéis usam em `settle`. */
  arrive: number;
  /** Fração esforçada (curva `cine`). */
  u: number;
  done: boolean;
}

export function sampleFlight(fl: Flight, now: number): FlightSample {
  const raw = (now - fl.t0) / fl.dur;
  // 1e-9: o último quadro de um voo pousa mesmo com arredondamento de ponto flutuante
  const arrive = finite(raw) ? (raw >= 1 - 1e-9 ? 1 : clamp(raw)) : 1;
  const u = easeCine(arrive);
  return { cam: stepCamera(fl, u), arrive, u, done: arrive >= 1 };
}

/* ── Respiração e enquadramento ─────────────────────────────────────────── */

/** Desvio de rumo (graus) da respiração no instante `now` (s): ±2,5°, período ≈ 70 s. */
export function breathOffset(now: number): number {
  return finite(now) ? Math.sin(now * BREATH_RATE) * BREATH_AMPLITUDE_DEG : 0;
}

/** Distância focal (px) para o campo vertical fixo: F = H/2 / tan(fov/2). */
export function focalPx(heightPx: number, vfovDeg = VFOV_DEG): number {
  const h = finite(heightPx) && heightPx > 0 ? heightPx : 1;
  return h / 2 / Math.tan((vfovDeg * DEG) / 2);
}

/**
 * Giro da câmera (radianos) que leva o alvo a (ox, oy) px do centro:
 * `camera.look(up, −yaw)` e `camera.look(right, −pitch)` (`globe.js:133-137`).
 */
export function offsetAngles(ox: number, oy: number, heightPx: number): { yaw: number; pitch: number } {
  const F = focalPx(heightPx);
  return {
    yaw: finite(ox) ? Math.atan(ox / F) : 0,
    pitch: finite(oy) ? Math.atan(oy / F) : 0,
  };
}

/**
 * O `frustum.fov` do Cesium para um campo VERTICAL fixo. O Cesium lê `fov` como
 * horizontal quando a tela é mais larga que alta, e como vertical no retrato.
 */
export function cesiumFov(widthPx: number, heightPx: number, vfovDeg = VFOV_DEG): number {
  const vf = vfovDeg * DEG;
  const w = finite(widthPx) && widthPx > 0 ? widthPx : 1;
  const h = finite(heightPx) && heightPx > 0 ? heightPx : 1;
  const aspect = w / h;
  return aspect > 1 ? 2 * Math.atan(Math.tan(vf / 2) * aspect) : vf;
}

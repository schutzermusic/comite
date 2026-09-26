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

/** A rolagem do voo (graus): parte da lida no início e chega a 0 no pouso. */
export function flightRoll(roll0: number, u: number): number {
  return finite(roll0) ? roll0 * (1 - clamp(finite(u) ? u : 1)) : 0;
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

/* ── Mouse/toque: a câmera do usuário ───────────────────────────────────── */

/**
 * Limites e gestos do mapa (ScreenSpaceCameraController do Cesium):
 * zoom mínimo 250 m do chão, máximo 30.000 km, inclinação até 75° da vertical
 * (ou seja, `pitch` ≥ 15°), sem "olhar em volta".
 */
export const INTERACTION = Object.freeze({
  minZoomM: 250,
  maxZoomM: 30_000_000,
  maxTiltDeg: 75,
  /** Arrasto até este tanto (px) ainda é clique (marcador continua clicável). */
  dragPx: 6,
  /** A respiração só volta depois deste tempo (s) sem mexer no mapa. */
  idleBreathS: 6,
});

/** Vetor 3D (ECEF, metros, ou unitário). */
export type Vec3 = [number, number, number];

/** A pose da câmera em ECEF: posição (m) e a base ortonormal (direção, cima, direita = direção × cima). */
export interface CameraPose {
  position: Vec3;
  direction: Vec3;
  up: Vec3;
  right: Vec3;
}

const WGS84_A = 6_378_137.0;
const WGS84_B = 6_356_752.314245179;
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
function unit(a: Vec3): Vec3 | null {
  const n = norm(a);
  return n > 1e-12 && Number.isFinite(n) ? scale(a, 1 / n) : null;
}
/** Rodrigues: gira `v` em torno do eixo unitário `k` por `ang` (rad, mão direita). */
function rotate(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return add(scale(v, c), scale(cross(k, v), s), scale(k, dot(k, v) * (1 - c)));
}
const finiteVec = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Geodésico (graus, m) → ECEF (m), WGS84. */
export function ecefOf(latDeg: number, lngDeg: number, h = 0): Vec3 {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const s = Math.sin(lat);
  const c = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  return [(N + h) * c * Math.cos(lng), (N + h) * c * Math.sin(lng), (N * (1 - WGS84_E2) + h) * s];
}

/** Base leste/norte/cima no ponto (normal geodésica), como `Transforms.eastNorthUpToFixedFrame`. */
export function enuAt(latDeg: number, lngDeg: number): { e: Vec3; n: Vec3; u: Vec3 } {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const sg = Math.sin(lng);
  const cg = Math.cos(lng);
  return { e: [-sg, cg, 0], n: [-sl * cg, -sl * sg, cl], u: [cl * cg, cl * sg, sl] };
}

/** ECEF de um ponto NA SUPERFÍCIE do elipsoide → lat/lng (graus); exato para h = 0. */
export function latLngOfSurface(p: Vec3): { lat: number; lng: number } {
  const r = Math.hypot(p[0], p[1]);
  return { lat: Math.atan2(p[2], (1 - WGS84_E2) * r) / DEG, lng: Math.atan2(p[1], p[0]) / DEG };
}

/** Primeira interseção (t > 0) do raio `o + t·d` com o WGS84; `null` se não toca. */
export function rayEllipsoid(o: Vec3, d: Vec3): Vec3 | null {
  const os: Vec3 = [o[0] / WGS84_A, o[1] / WGS84_A, o[2] / WGS84_B];
  const ds: Vec3 = [d[0] / WGS84_A, d[1] / WGS84_A, d[2] / WGS84_B];
  const a = dot(ds, ds);
  const b = 2 * dot(os, ds);
  const c = dot(os, os) - 1;
  const disc = b * b - 4 * a * c;
  if (!(a > 0) || disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  const t = t0 > 0 ? t0 : t1 > 0 ? t1 : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return add(o, scale(d, t));
}

/** Base "sem rolagem" do `lookAt` do Cesium: direita = direção × cima-local (leste se degenerar). */
function zeroRollBasis(direction: Vec3, upLocal: Vec3, eastLocal: Vec3): { right: Vec3; up: Vec3 } {
  const right = unit(cross(direction, upLocal)) ?? eastLocal;
  return { right, up: unit(cross(right, direction)) ?? upLocal };
}

/**
 * A pose que o motor aplica para uma vista (modelo PURO do `applyCamera`):
 * `lookAt(alvo, rumo/inclinação/distância)` → giro em torno da direção (`rollDeg`)
 * → `look(cima, −yaw)` → `look(direita, −pitch)` com yaw/pitch de `offsetAngles`.
 */
export function poseFromView(view: CameraView, heightPx: number, rollDeg = 0): CameraPose {
  const v = sanitizeView(view);
  const T = ecefOf(v.lat, v.lng, 0);
  const { e, n, u } = enuAt(v.lat, v.lng);
  const H = v.heading * DEG;
  const P = Math.min(v.pitch, 89.9) * DEG;
  const range = v.dist * 1000;
  const off = add(scale(e, -Math.sin(H) * Math.cos(P) * range), scale(n, -Math.cos(H) * Math.cos(P) * range), scale(u, Math.sin(P) * range));
  const position = add(T, off);
  let direction = unit(scale(off, -1)) ?? scale(u, -1);
  let { right, up } = zeroRollBasis(direction, u, e);
  const roll = finite(rollDeg) ? rollDeg * DEG : 0;
  if (roll) {
    up = rotate(up, direction, roll);
    right = rotate(right, direction, roll);
  }
  const { yaw, pitch } = offsetAngles(v.ox, v.oy, heightPx);
  if (yaw) {
    direction = rotate(direction, up, yaw);
    right = rotate(right, up, yaw);
  }
  if (pitch) {
    direction = rotate(direction, right, pitch);
    up = rotate(up, right, pitch);
  }
  return { position, direction, up, right };
}

/**
 * Projeção de tela do modelo PURO (a mesma do Cesium com o campo vertical fixo):
 * ECEF (m) → px CSS do palco `W × H`; `null` atrás da câmera ou não-finito.
 * Serve para enquadrar (presets.ts) sem tocar no motor.
 */
export function projectPose(pose: CameraPose, W: number, H: number, p: Vec3): [number, number] | null {
  if (!pose || !finiteVec(p) || !(W > 0) || !(H > 0)) return null;
  const d = sub(p, pose.position);
  const z = dot(d, pose.direction);
  if (!(z > 1)) return null;
  const F = focalPx(H);
  const x = W / 2 + (F * dot(d, pose.right)) / z;
  const y = H / 2 - (F * dot(d, pose.up)) / z;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** O que foi lido da câmera do Cesium: a vista (com os ox/oy mantidos) e a rolagem residual (graus). */
export interface ReadBack {
  view: CameraView;
  rollDeg: number;
}

/**
 * LEITURA DE VOLTA: a câmera do usuário (arrastada pelo Cesium) → `CameraView`
 * mantendo `ox`/`oy`. O alvo é o ponto do chão sob (centro + ox, centro + oy);
 * distância, inclinação e rumo saem do vetor alvo→câmera no ENU do alvo; o que
 * sobra da orientação é a rolagem em torno da direção (o voo seguinte a leva a 0).
 * Inverso exato de `poseFromView`. `null` quando nada na pose é utilizável.
 */
export function readBackView(pose: CameraPose, ox: number, oy: number, heightPx: number, prevHeading = 0): ReadBack | null {
  if (!pose || !finiteVec(pose.position) || !finiteVec(pose.direction) || !finiteVec(pose.up) || !finiteVec(pose.right)) return null;
  const C = pose.position;
  const oxs = finite(ox) ? clamp(ox, -4000, 4000) : 0;
  const oys = finite(oy) ? clamp(oy, -4000, 4000) : 0;
  const { yaw: a, pitch: b } = offsetAngles(oxs, oys, heightPx);
  const r2 = pose.right;
  const u2 = pose.up;
  const d2 = pose.direction;
  // desfaz os giros do enquadramento: direção e "cima" da base (antes de yaw/pitch)
  let d0 = unit(add(scale(r2, Math.sin(a)), scale(u2, -Math.sin(b) * Math.cos(a)), scale(d2, Math.cos(b) * Math.cos(a))));
  let u0 = unit(add(scale(u2, Math.cos(b)), scale(d2, Math.sin(b))));
  let keepOx = oxs;
  let keepOy = oys;
  let T = d0 ? rayEllipsoid(C, d0) : null;
  if (!T) {
    // o ponto de enquadramento está no céu: tenta o centro da tela
    const dc = unit(d2);
    T = dc ? rayEllipsoid(C, dc) : null;
    d0 = dc;
    u0 = unit(u2);
    keepOx = 0;
    keepOy = 0;
  }
  if (!T || !d0 || !u0) {
    // nem o centro toca a Terra: a vertical sob a câmera, olhando para baixo
    const r = Math.hypot(C[0], C[1]);
    const lat = Math.atan2(C[2], (1 - WGS84_E2) * r) / DEG;
    const lng = Math.atan2(C[1], C[0]) / DEG;
    const ground = ecefOf(lat, lng, 0);
    const dist = norm(sub(C, ground)) / 1000;
    if (!finite(dist) || dist <= 0) return null;
    return { view: sanitizeView({ lat, lng, dist, pitch: 89.9, heading: prevHeading, ox: 0, oy: 0 }), rollDeg: 0 };
  }
  const ll = latLngOfSurface(T);
  const toCam = sub(C, T);
  const distM = norm(toCam);
  if (!(distM > 0) || !Number.isFinite(distM)) return null;
  const v = scale(toCam, 1 / distM);
  const { e, n, u } = enuAt(ll.lat, ll.lng);
  const ve = dot(v, e);
  const vn = dot(v, n);
  const vu = clamp(dot(v, u), -1, 1);
  const pitch = Math.asin(vu) / DEG;
  const flat = Math.hypot(ve, vn) < 1e-9;
  let heading = flat ? prevHeading : Math.atan2(-ve, -vn) / DEG;
  // continuidade: o rumo lido fica perto do anterior (sem saltos de 360°)
  if (finite(prevHeading)) heading = prevHeading + shortestArc(prevHeading, heading);
  // rolagem: "cima" da base contra o "cima" sem rolagem do lookAt, em torno da direção
  const dz = scale(v, -1);
  const zero = zeroRollBasis(dz, u, e);
  const rollDeg = Math.atan2(dot(cross(zero.up, u0), dz), dot(zero.up, u0)) / DEG;
  const view = sanitizeView({ lat: ll.lat, lng: ll.lng, dist: distM / 1000, pitch, heading, ox: keepOx, oy: keepOy });
  return { view, rollDeg: finite(rollDeg) ? rollDeg : 0 };
}

/* ── Época da vista: voar, só trocar o alvo, ou nada ────────────────────── */

export type Retarget = 'none' | 'target' | 'fly';

/**
 * Nova época (Esc, dock, outro local) ou varredura nova → voa até a vista,
 * mesmo igual à anterior, se a câmera saiu dela (usuário, deriva). Mesma
 * época: vista igual → nada; vista nova → voa, a não ser que o usuário tenha
 * mexido no mapa (aí só troca o alvo: a câmera nunca é roubada).
 */
export function retargetAction(o: { sameView: boolean; newEpoch: boolean; userMoved: boolean; offTarget?: boolean }): Retarget {
  const away = o.userMoved || Boolean(o.offTarget);
  if (o.newEpoch) return o.sameView && !away ? 'none' : 'fly';
  if (o.sameView) return 'none';
  return o.userMoved ? 'target' : 'fly';
}

/* ── Reajuste do voo em curso (mesma época) ─────────────────────────────── */

/** Duração mínima (s) da mistura de um reajuste que chega perto do pouso. */
export const REAIM_MIN_S = 0.45;

/**
 * Um alvo NOVO na mesma época, com o voo ainda em curso, é um REFINAMENTO da
 * mesma vista (o enquadramento mediu o HUD, o tipo de obra chegou) quando cai
 * perto do alvo atual: mesmo lugar (≤ 25% da distância), distância até 2,5×,
 * rumo ±30°, inclinação ±15°. Aí o voo é reajustado sem recomeçar; senão, voo novo.
 */
export function reaimable(prev: CameraView | null | undefined, next: CameraView | null | undefined): boolean {
  if (!prev || !next) return false;
  const a = sanitizeView(prev);
  const b = sanitizeView(next, a);
  const far = Math.max(a.dist, b.dist);
  const moveKm = Math.hypot((b.lat - a.lat) * 111.2, shortestArc(a.lng, b.lng) * 111.2 * Math.cos(((a.lat + b.lat) / 2) * DEG));
  return moveKm <= far * 0.25 &&
    Math.abs(Math.log(b.dist / a.dist)) <= Math.log(2.5) &&
    Math.abs(shortestArc(a.heading, b.heading)) <= 30 &&
    Math.abs(b.pitch - a.pitch) <= 15;
}

/** Mistura de duas câmeras (w: 0 → `a`, 1 → `b`): distância em log, ângulos pelo arco curto. */
export function blendView(a: CameraView, b: CameraView, wIn: number): CameraView {
  const w = clamp(finite(wIn) ? wIn : 1);
  return {
    lat: lerp(a.lat, b.lat, w),
    lng: wrap180(a.lng + shortestArc(a.lng, b.lng) * w),
    dist: Math.exp(lerp(Math.log(safeDist(a.dist, 1)), Math.log(safeDist(b.dist, 1)), w)),
    pitch: lerp(a.pitch, b.pitch, w),
    heading: a.heading + shortestArc(a.heading, b.heading) * w,
    ox: lerp(a.ox, b.ox, w),
    oy: lerp(a.oy, b.oy, w),
  };
}

/** Peso suave (C¹) da mistura do reajuste entre `t0` e `t1`. */
export function reaimWeight(t: number, t0: number, t1: number): number {
  if (!finite(t) || !finite(t0) || !finite(t1) || t1 <= t0) return 1;
  const k = clamp((t - t0) / (t1 - t0));
  return k * k * (3 - 2 * k);
}

/* ── Deriva depois do pouso ("procurando") ──────────────────────────────── */

export interface DriftSpec {
  headingDeg: number;
  distK: number;
  seconds: number;
}

/** Deriva válida (finita, duração > 0) ou `null`. */
export function sanitizeDrift(d: Partial<DriftSpec> | null | undefined): DriftSpec | null {
  if (!d) return null;
  const { headingDeg, distK, seconds } = d;
  if (!finite(headingDeg) || !finite(distK) || !finite(seconds) || seconds <= 0 || distK <= 0) return null;
  return { headingDeg: clamp(headingDeg, -45, 45), distK: clamp(distK, 0.25, 4), seconds: clamp(seconds, 0.2, 60) };
}

/** Deslocamento aditivo da deriva em `elapsed` s: rumo + fator de distância, curva seno (entra e sai suave). */
export function driftOffset(d: DriftSpec | null, elapsed: number): { heading: number; distMul: number; done: boolean } {
  if (!d) return { heading: 0, distMul: 1, done: true };
  const k = finite(elapsed) ? clamp(elapsed / d.seconds) : 1;
  const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
  return { heading: d.headingDeg * e, distMul: 1 + (d.distK - 1) * e, done: k >= 1 };
}

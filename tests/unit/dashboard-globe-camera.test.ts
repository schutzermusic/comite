/**
 * A CÂMERA DO GLOBO É A DO FILME — e nunca solta NaN.
 *
 * Referência: `APEX FILM/js/app/app.js:62-101` (voo), `js/world/camera-track.js`
 * (abertura), `js/world/globe.js:121-139` (enquadramento) e a especificação de
 * movimento (filmMotion.md §2): curva `cine`, tabela de durações, guiagem do
 * alvo nos mergulhos, arco mais curto, retomada a partir da câmera atual.
 *
 *   npx vitest run --project unit tests/unit/dashboard-globe-camera.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import type { CameraView, GlobeScan } from '@/components/dashboard-globe/contract';
import {
  approach,
  blendView,
  breathOffset,
  cesiumFov,
  createFlight,
  cubicBezier,
  DEG,
  driftOffset,
  easeCine,
  ecefOf,
  enuAt,
  FALLBACK_VIEW,
  flightDuration,
  flightRoll,
  focalPx,
  INTERACTION,
  latLngOfSurface,
  offsetAngles,
  poseFromView,
  projectPose,
  rayEllipsoid,
  readBackView,
  REAIM_MIN_S,
  reaimable,
  reaimWeight,
  retargetAction,
  sampleFlight,
  sanitizeDrift,
  sanitizeView,
  shortestArc,
  stepCamera,
  viewsEqual,
  wrap180,
  type CameraPose,
} from '@/components/dashboard-globe/camera';
import {
  buildIntroTrack,
  finalSegmentSeconds,
  INTRO_KEYS,
  INTRO_RETARGET_UNTIL,
  monotoneTangents,
  sampleIntro,
} from '@/components/dashboard-globe/intro';
import { getFlight, publishFlight, settleFlight } from '@/components/dashboard-globe/flight-store';
import {
  buildUfGeo,
  CONTEXT_MARKER_ALPHA,
  decodeArcInts,
  destinationPoint,
  effectiveFree,
  greatCircleKm,
  llhToEcef,
  outCubic,
  parseFreeRect,
  pickNearest,
  Projector,
  ringInts,
  STAGE_MARGIN,
  SCAN_RINGS_END,
  SCAN_T,
  scanNodeForArc,
  scanPhaseOf,
  scanReachTime,
  scanRings,
  twinDistanceAlpha,
  validLatLng,
  WorldOverlay,
} from '@/components/dashboard-globe/overlay';
import { UF_ARCS, UF_RINGS } from '@/components/dashboard-globe/br-uf-geo';
import { fitLabel } from '@/components/dashboard-globe/labels';

/* As vistas do protótipo (`app.js:38-44`, posições do §2.2). */
const V: Record<'portfolio' | 'usina' | 'planejar' | 'supply' | 'faturamento', CameraView> = {
  portfolio: { lat: -19.0387, lng: -46.6471, dist: 1550, pitch: 52, heading: -4, ox: 200, oy: 90 },
  usina: { lat: -18.5018, lng: -49.4916, dist: 0.9, pitch: 48, heading: 58, ox: 190, oy: 40 },
  planejar: { lat: -18.5018, lng: -49.4916, dist: 0.95, pitch: 50, heading: 64, ox: 40, oy: -170 },
  supply: { lat: -19.6644, lng: -47.8312, dist: 2200, pitch: 64, heading: -6, ox: -20, oy: -30 },
  faturamento: { lat: -18.5017, lng: -49.4908, dist: 9, pitch: 54, heading: 60, ox: 90, oy: 60 },
};

const allFinite = (c: CameraView) =>
  [c.lat, c.lng, c.dist, c.pitch, c.heading, c.ox, c.oy].every((v) => Number.isFinite(v));

describe('curva cine = cubic-bezier(0.42, 0, 0.12, 1)', () => {
  it('bate a amostragem do filme (tempo → progresso)', () => {
    const table: Array<[number, number]> = [
      [0.1, 0.024], [0.25, 0.258], [0.4, 0.67], [0.55, 0.86], [0.7, 0.949], [0.85, 0.989], [0.95, 0.999],
    ];
    for (const [x, y] of table) expect(Math.abs(easeCine(x) - y)).toBeLessThan(0.0015);
  });

  it('começa em 0, termina em 1, é monótona e satura fora de 0..1', () => {
    expect(easeCine(0)).toBe(0);
    expect(easeCine(1)).toBe(1);
    expect(easeCine(-3)).toBe(0);
    expect(easeCine(7)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 1000; i += 1) {
      const v = easeCine(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('NaN entra, número sai', () => {
    expect(easeCine(Number.NaN)).toBe(0);
    expect(cubicBezier(0.2, 0.7, 0.2, 1)(0.5)).toBeGreaterThan(0.5);
  });
});

describe('duração do voo: clamp(1 + 0,3·|ln(d1/d0)|, 1, 3,2) s', () => {
  it('reproduz a tabela do §2.3', () => {
    const cases: Array<[CameraView, CameraView, number]> = [
      [V.portfolio, V.usina, 3.2],
      [V.portfolio, V.planejar, 3.2],
      [V.usina, V.supply, 3.2],
      [V.supply, V.faturamento, 2.65],
      [V.portfolio, V.faturamento, 2.54],
      [V.usina, V.faturamento, 1.69],
      [V.planejar, V.faturamento, 1.67],
      [V.portfolio, V.supply, 1.11],
      [V.usina, V.planejar, 1.02],
    ];
    for (const [a, b, dur] of cases) {
      expect(Math.abs(flightDuration(a.dist, b.dist) - dur)).toBeLessThan(0.006);
      expect(flightDuration(b.dist, a.dist)).toBeCloseTo(flightDuration(a.dist, b.dist), 12);
    }
  });

  it('distância inválida não quebra a duração', () => {
    for (const [a, b] of [[Number.NaN, 5], [0, 0], [-4, 1e9], [Infinity, 1]] as const) {
      const d = flightDuration(a, b);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(3.2);
    }
  });
});

describe('voo: distância em log, alvo guiado nos mergulhos, arco mais curto', () => {
  it('guia o alvo só quando |Δ ln d| > 1,5', () => {
    expect(createFlight(V.portfolio, V.usina, 0).steer).toBe(true);
    expect(createFlight(V.usina, V.faturamento, 0).steer).toBe(true);
    expect(createFlight(V.portfolio, V.supply, 0).steer).toBe(false);
    expect(createFlight(V.usina, V.planejar, 0).steer).toBe(false);
  });

  it('parte exatamente de `from` e pousa exatamente em `to`', () => {
    const fl = createFlight(V.portfolio, V.usina, 10);
    const a = sampleFlight(fl, 10).cam;
    const b = sampleFlight(fl, 10 + fl.dur).cam;
    expect(viewsEqual(a, V.portfolio)).toBe(true);
    expect(viewsEqual(b, V.usina)).toBe(true);
    expect(sampleFlight(fl, 10 + fl.dur).done).toBe(true);
    expect(sampleFlight(fl, 11).done).toBe(false);
  });

  it('distância interpolada em log: aos 55% do tempo, ≈ 2,5 km (os painéis começam a entrar)', () => {
    const fl = createFlight(V.portfolio, V.usina, 0);
    const s = sampleFlight(fl, fl.dur * 0.55);
    expect(s.arrive).toBeCloseTo(0.55, 9);
    expect(s.cam.dist).toBeGreaterThan(2.3);
    expect(s.cam.dist).toBeLessThan(2.8);
  });

  it('mergulho: o destino segura o lugar na tela (quase todo o caminho lateral já feito)', () => {
    const fl = createFlight(V.portfolio, V.usina, 0);
    const span = Math.hypot(V.usina.lat - V.portfolio.lat, V.usina.lng - V.portfolio.lng);
    const c = stepCamera(fl, easeCine(0.55));
    const rest = Math.hypot(V.usina.lat - c.lat, V.usina.lng - c.lng);
    expect(rest / span).toBeLessThan(0.001);
  });

  it('subida: o ponto de partida fica preso até perto da altitude final', () => {
    const fl = createFlight(V.usina, V.portfolio, 0);
    const span = Math.hypot(V.usina.lat - V.portfolio.lat, V.usina.lng - V.portfolio.lng);
    const c = stepCamera(fl, 0.5);
    const moved = Math.hypot(c.lat - V.usina.lat, c.lng - V.usina.lng);
    expect(moved / span).toBeLessThan(0.02);
  });

  it('é contínuo: nenhum salto entre quadros vizinhos (guiado ou não)', () => {
    for (const [a, b] of [[V.portfolio, V.usina], [V.usina, V.portfolio], [V.portfolio, V.supply], [V.supply, V.faturamento]]) {
      const fl = createFlight(a, b, 0);
      const span = Math.hypot(b.lat - a.lat, b.lng - a.lng);
      let prev = sampleFlight(fl, 0).cam;
      let maxStep = 0;
      let maxLogStep = 0;
      for (let i = 1; i <= 4000; i += 1) {
        const cur = sampleFlight(fl, (fl.dur * i) / 4000).cam;
        maxStep = Math.max(maxStep, Math.hypot(cur.lat - prev.lat, cur.lng - prev.lng) / span);
        maxLogStep = Math.max(maxLogStep, Math.abs(Math.log(cur.dist / prev.dist)));
        expect(allFinite(cur)).toBe(true);
        prev = cur;
      }
      expect(maxStep).toBeLessThan(0.01);
      expect(maxLogStep).toBeLessThan(0.02);
    }
  });

  it('arco mais curto no rumo e na longitude', () => {
    expect(shortestArc(170, -170)).toBeCloseTo(20, 9);
    expect(shortestArc(-170, 170)).toBeCloseTo(-20, 9);
    expect(shortestArc(-4, 58)).toBeCloseTo(62, 9);
    expect(shortestArc(58, -4)).toBeCloseTo(-62, 9);
    expect(shortestArc(350, 10)).toBeCloseTo(20, 9);
    expect(shortestArc(10, 350)).toBeCloseTo(-20, 9);
    expect(shortestArc(-1070, 10)).toBeCloseTo(0, 9);
    expect(Math.abs(shortestArc(0, 180))).toBeCloseTo(180, 9);
    expect(wrap180(540)).toBeCloseTo(180, 9);
    expect(wrap180(-190)).toBeCloseTo(170, 9);
    const fl = createFlight({ ...V.usina, heading: 170 }, { ...V.usina, heading: -170 }, 0);
    expect(fl.dh).toBeCloseTo(20, 9);
    const half = stepCamera(fl, 0.5);
    expect(half.heading).toBeCloseTo(180, 9);
    const dateline = createFlight({ ...V.supply, lng: 179 }, { ...V.supply, lng: -179 }, 0);
    expect(dateline.dlng).toBeCloseTo(2, 9);
    expect(Math.abs(stepCamera(dateline, 0.5).lng)).toBeCloseTo(180, 6);
  });

  it('retomada no meio do voo parte da câmera ATUAL (sem salto)', () => {
    const a = createFlight(V.portfolio, V.usina, 0);
    const t = 1.3;
    const here = sampleFlight(a, t).cam;
    const b = createFlight(here, V.supply, t);
    const start = sampleFlight(b, t).cam;
    expect(viewsEqual(start, here)).toBe(true);
    const next = sampleFlight(b, t + 1 / 60).cam;
    expect(Math.abs(Math.log(next.dist / here.dist))).toBeLessThan(0.01);
    expect(sampleFlight(b, t + b.dur).done).toBe(true);
  });

  it('inclinação e ox/oy seguem a curva; `arrive` é a fração LINEAR do tempo', () => {
    const fl = createFlight(V.usina, V.planejar, 0);
    const s = sampleFlight(fl, fl.dur / 2);
    expect(s.arrive).toBeCloseTo(0.5, 9);
    expect(s.u).toBeCloseTo(easeCine(0.5), 9);
    expect(s.cam.pitch).toBeCloseTo(48 + 2 * s.u, 9);
    expect(s.cam.oy).toBeCloseTo(40 + (-170 - 40) * s.u, 9);
  });
});

describe('sem NaN nas bordas', () => {
  const bad = { lat: Number.NaN, lng: Infinity, dist: 0, pitch: Number.NaN, heading: -Infinity, ox: Number.NaN, oy: undefined } as unknown as CameraView;

  it('sanitizeView: tudo finito, na faixa, com recuo', () => {
    const s = sanitizeView(bad);
    expect(allFinite(s)).toBe(true);
    expect(s).toEqual({ ...FALLBACK_VIEW, ox: 0, oy: 0 });
    expect(sanitizeView(null)).toEqual(FALLBACK_VIEW);
    const c = sanitizeView({ lat: 123, lng: 190, dist: 1e12, pitch: 120, heading: 30, ox: 1e9, oy: -1e9 });
    expect(c.lat).toBeLessThanOrEqual(90);
    expect(c.lng).toBeCloseTo(-170, 9);
    expect(c.dist).toBeLessThanOrEqual(60_000);
    expect(c.pitch).toBeLessThanOrEqual(89.9);
    expect(Math.abs(c.ox)).toBeLessThanOrEqual(4000);
    expect(sanitizeView({ ...bad }, V.usina)).toEqual({ ...V.usina, ox: 0, oy: 0 });
  });

  it('voo com entrada não-finita nunca devolve não-finito', () => {
    for (const [a, b] of [[bad, V.usina], [V.portfolio, bad], [bad, bad]] as const) {
      const fl = createFlight(a, b, Number.NaN);
      expect(Number.isFinite(fl.dur)).toBe(true);
      for (let i = 0; i <= 50; i += 1) expect(allFinite(sampleFlight(fl, (fl.dur * i) / 50).cam)).toBe(true);
      expect(allFinite(sampleFlight(fl, Number.NaN).cam)).toBe(true);
      expect(allFinite(stepCamera(fl, Number.NaN))).toBe(true);
    }
  });

  it('enquadramento, respiração e fade toleram lixo', () => {
    const o = offsetAngles(Number.NaN, Infinity, 0);
    expect(Number.isFinite(o.yaw) && Number.isFinite(o.pitch)).toBe(true);
    expect(Number.isFinite(cesiumFov(0, Number.NaN))).toBe(true);
    expect(Number.isFinite(focalPx(-1))).toBe(true);
    expect(breathOffset(Number.NaN)).toBe(0);
    expect(approach(Number.NaN, 1, 0.016, 6)).toBe(1);
    expect(approach(0.5, Number.NaN, 0.016, 6)).toBe(0.5);
    expect(approach(0, 1, Number.NaN, 6)).toBe(0);
  });
});

describe('enquadramento fora do centro (fov vertical fixo de 32°)', () => {
  it('F = H/2 / tan(16°): 1883 px a 1080 px de altura', () => {
    expect(focalPx(1080)).toBeCloseTo(1883.2, 1);
  });

  it('o portfólio gira ≈ 6,1° / 2,7° para cair em (+200, +90) px', () => {
    const { yaw, pitch } = offsetAngles(200, 90, 1080);
    expect(yaw / DEG).toBeCloseTo(6.06, 1);
    expect(pitch / DEG).toBeCloseTo(2.74, 1);
  });

  it('o fov do Cesium mantém 32° na vertical na paisagem e no retrato', () => {
    const land = cesiumFov(1920, 1080);
    const aspect = 1920 / 1080;
    const fovy = 2 * Math.atan(Math.tan(land / 2) / aspect);
    expect(fovy / DEG).toBeCloseTo(32, 6);
    expect(cesiumFov(390, 844) / DEG).toBeCloseTo(32, 9);
  });
});

describe('respiração: ±2,5°, período ≈ 70 s', () => {
  it('amplitude e período', () => {
    let max = 0;
    for (let t = 0; t < 140; t += 0.05) max = Math.max(max, Math.abs(breathOffset(t)));
    expect(max).toBeLessThanOrEqual(2.5);
    expect(max).toBeGreaterThan(2.49);
    const period = (2 * Math.PI) / 0.09;
    expect(period).toBeGreaterThan(69);
    expect(period).toBeLessThan(70.5);
    expect(breathOffset(10)).toBeCloseTo(breathOffset(10 + period), 9);
  });
});

describe('abertura do filme: Terra → Brasil → vista (Fritsch–Carlson, log, paradas)', () => {
  it('começa na Terra a 28.000 km e passa pelo Brasil a 9.500 km aos 3,2 s', () => {
    const tr = buildIntroTrack(V.portfolio);
    const s0 = sampleIntro(tr, 0).cam;
    expect(s0.dist).toBeCloseTo(28_000, 6);
    expect(s0.lat).toBeCloseTo(INTRO_KEYS[0].lat, 9);
    expect(s0.lng).toBeCloseTo(INTRO_KEYS[0].lng, 9);
    const br = sampleIntro(tr, 3.2).cam;
    expect(br.dist).toBeCloseTo(9_500, 6);
    expect(br.lat).toBeCloseTo(-14.23, 6);
    expect(br.lng).toBeCloseTo(-54.5, 6);
  });

  it('≈ 4,4 s até o portfólio; ≈ 7,0 s até um local a 1,4 km (como no filme)', () => {
    expect(buildIntroTrack(V.portfolio).duration).toBeCloseTo(4.4, 6);
    expect(buildIntroTrack({ ...V.usina, dist: 1.4 }).duration).toBeCloseTo(7.0, 1);
    expect(finalSegmentSeconds(9500, 50_000)).toBe(1.2);
  });

  it('pousa exatamente na vista pedida (rumo pelo lado curto) e termina parado', () => {
    const tr = buildIntroTrack(V.usina);
    const end = sampleIntro(tr, tr.duration);
    expect(end.done).toBe(true);
    expect(end.arrive).toBe(1);
    expect(viewsEqual(end.cam, V.usina)).toBe(true);
    const before = sampleIntro(tr, tr.duration - 0.01).cam;
    expect(Math.abs(Math.log(before.dist / end.cam.dist))).toBeLessThan(0.01);
  });

  it('distância monótona (sem ultrapassar) e tudo finito', () => {
    for (const target of [V.portfolio, V.usina, V.supply, { ...V.portfolio, dist: 5200 }]) {
      const tr = buildIntroTrack(target);
      let prev = Infinity;
      for (let i = 0; i <= 600; i += 1) {
        const s = sampleIntro(tr, (tr.duration * i) / 600);
        expect(allFinite(s.cam)).toBe(true);
        expect(s.cam.dist).toBeLessThanOrEqual(prev + 1e-6);
        expect(s.cam.dist).toBeGreaterThanOrEqual(target.dist - 1e-6);
        prev = s.cam.dist;
      }
    }
    expect(allFinite(sampleIntro(buildIntroTrack(V.portfolio), Number.NaN).cam)).toBe(true);
  });

  it('trocar o destino antes de 1,3 s não mexe na câmera (a página pode chegar depois do globo)', () => {
    const a = buildIntroTrack({ ...V.portfolio, dist: 5200 });
    const b = buildIntroTrack(V.portfolio);
    for (let t = 0; t < INTRO_RETARGET_UNTIL; t += 0.05) {
      expect(viewsEqual(sampleIntro(a, t).cam, sampleIntro(b, t).cam)).toBe(true);
    }
    expect(viewsEqual(sampleIntro(a, 2.5).cam, sampleIntro(b, 2.5).cam)).toBe(false);
  });

  it('tangentes monótonas: parada zera a velocidade; extremo local não ultrapassa', () => {
    const m = monotoneTangents([0, 1, 2, 3], [0, 1, 1, 0], [true, false, false, true]);
    expect(m[0]).toBe(0);
    expect(m[3]).toBe(0);
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(0);
  });
});

describe('loja do voo (useFlight/getFlight)', () => {
  it('só notifica quando muda; mesma referência parada; nada não-finito', () => {
    const first = getFlight();
    expect(publishFlight({ ...first })).toBe(false);
    expect(getFlight()).toBe(first);
    const next = { flying: true, arrive: 0.25, dist: 900, flightId: first.flightId + 1 };
    expect(publishFlight(next)).toBe(true);
    const snap = getFlight();
    expect(snap).toEqual(next);
    expect(publishFlight({ ...next, dist: 900.0001 })).toBe(false);
    expect(getFlight()).toBe(snap);
    expect(publishFlight({ flying: true, arrive: Number.NaN, dist: Number.NaN, flightId: Number.NaN })).toBe(true);
    const clean = getFlight();
    expect(clean.arrive).toBe(1);
    expect(clean.dist).toBe(900);
    expect(clean.flightId).toBe(next.flightId);
    settleFlight();
    expect(getFlight().flying).toBe(false);
    expect(getFlight().arrive).toBe(1);
  });
});

describe('camadas 2D: hit-test, projeção, divisas', () => {
  it('pickNearest: o mais próximo dentro de 42 px', () => {
    const marks = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 130, y: 100 }];
    expect(pickNearest(marks, 118, 100)).toBe('b');
    expect(pickNearest(marks, 100, 141)).toBe('a');
    expect(pickNearest(marks, 100, 143)).toBeNull();
    expect(pickNearest(marks, Number.NaN, 100)).toBeNull();
    expect(pickNearest([], 0, 0)).toBeNull();
  });

  it('llhToEcef no WGS84 e validLatLng', () => {
    const p = [0, 0, 0];
    llhToEcef(0, 0, 0, p);
    expect(p[0]).toBeCloseTo(6_378_137, 3);
    llhToEcef(90, 0, 0, p);
    expect(p[2]).toBeCloseTo(6_356_752.3142, 3);
    expect(validLatLng(-18.5, -49.49)).toBe(true);
    expect(validLatLng(Number.NaN, 0)).toBe(false);
    expect(validLatLng(91, 0)).toBe(false);
    expect(validLatLng(0, '1')).toBe(false);
  });

  it('Projector: horizonte oculta o lado de trás; atrás da câmera e matriz inválida somem', () => {
    const P = new Projector();
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const cam = { x: 2 * 6_378_137, y: 0, z: 0 };
    P.set(I, 100, 100, cam);
    const out = [0, 0];
    expect(P.project(6_378_137, 0, 0, out)).toBe(true); // face voltada para a câmera
    expect(P.project(-6_378_137, 0, 0, out)).toBe(false); // lado de trás
    expect(P.project(0, 0, 0, out)).toBe(false); // centro da Terra
    P.set(I.map((v, i) => (i === 15 ? -1 : v)), 100, 100, cam);
    expect(P.project(6_378_137, 0, 0, out)).toBe(false); // w < 0: atrás da câmera
    P.set(I.map((v, i) => (i === 0 ? Number.NaN : v)), 100, 100, cam);
    expect(P.ok).toBe(false);
    expect(P.project(6_378_137, 0, 0, out)).toBe(false);
  });

  it('as divisas das UFs decodificam íntegras (contagem e soma por UF, anéis fechados)', () => {
    // gerado junto com br-uf-geo.ts: [pontos, soma de lng+lat·1000] por UF
    const expected: Record<string, [number, number]> = {
      AC: [179, -14391810], AL: [109, -5038130], AM: [652, -43964851], AP: [244, -12376045], BA: [591, -32313198],
      CE: [218, -9830628], DF: [26, -1653338], ES: [134, -8127304], GO: [481, -31148507], MA: [592, -29520309],
      MG: [636, -40610792], MS: [373, -28133186], MT: [468, -32507894], PA: [674, -36231467], PB: [240, -10588142],
      PE: [324, -15011230], PI: [410, -20622872], PR: [300, -22812064], RJ: [209, -13727195], RN: [165, -7108287],
      RO: [372, -27538641], RR: [379, -22536414], RS: [509, -42298289], SC: [290, -22677157], SE: [97, -4661651],
      SP: [441, -31147209], TO: [436, -25285063],
    };
    const arcs = UF_ARCS.map(decodeArcInts);
    expect(arcs.every((a) => a.length >= 4 && a.length % 2 === 0)).toBe(true);
    expect(Object.keys(UF_RINGS).sort()).toEqual(Object.keys(expected).sort());
    for (const [uf, rings] of Object.entries(UF_RINGS)) {
      let pts = 0;
      let sum = 0;
      for (const refs of rings) {
        const ring = ringInts(arcs, refs);
        expect(ring.slice(0, 2)).toEqual(ring.slice(-2)); // fechado
        pts += ring.length / 2;
        sum += ring.reduce((acc, v) => acc + v, 0);
      }
      expect([uf, pts, sum]).toEqual([uf, ...expected[uf]]);
    }
    // Minas Gerais no lugar certo
    const mg = ringInts(arcs, UF_RINGS.MG[0]);
    const lngs = mg.filter((_, i) => i % 2 === 0).map((v) => v / 1000);
    const lats = mg.filter((_, i) => i % 2 === 1).map((v) => v / 1000);
    expect(Math.min(...lngs)).toBeCloseTo(-51.046, 3);
    expect(Math.max(...lngs)).toBeCloseTo(-39.857, 3);
    expect(Math.min(...lats)).toBeCloseTo(-22.923, 3);
    expect(Math.max(...lats)).toBeCloseTo(-14.247, 3);
  });

  it('buildUfGeo: 27 UFs, ECEF finito', () => {
    const geo = buildUfGeo(UF_ARCS, UF_RINGS);
    expect(geo.rings.size).toBe(27);
    expect(geo.arcs.length).toBe(UF_ARCS.length);
    for (const a of geo.arcs) expect(Array.from(a).every(Number.isFinite)).toBe(true);
    expect(decodeArcInts('###')).toEqual([]);
  });
});

describe('WorldOverlay: diff por id, fades e desenho progressivo', () => {
  const marker = { id: 'p1', lat: -3.77, lng: -49.67, tone: 'critical' as const, label: 'Tucuruí', pulse: 0.7 };
  const arc = { id: 'a1', from: { lat: -1.45, lng: -48.5 }, to: { lat: -3.77, lng: -49.67 }, h: 40, tone: 'completed' as const, flow: 0.4 };

  it('entra com fade, para quando assenta, sai com fade e é apagado', () => {
    const o = new WorldOverlay();
    o.sync([marker], [], [], ['PA']);
    expect(o.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: false })).toBe(true);
    let moving = true;
    for (let i = 0; i < 200 && moving; i += 1) moving = o.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: false });
    expect(moving).toBe(false);
    o.sync([], [], [], []);
    expect(o.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: false })).toBe(true);
    moving = true;
    for (let i = 0; i < 400 && moving; i += 1) moving = o.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: false });
    expect(moving).toBe(false);
    expect(o.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: false })).toBe(false);
  });

  it('arco cresce com a entrada dos painéis (settle) durante o voo; movimento reduzido desenha inteiro', () => {
    const o = new WorldOverlay();
    o.sync([], [arc], [], []);
    // até 55% do voo nada é desenhado; a partir daí cresce
    expect(o.step({ dt: 0.016, flying: true, arrive: 0.5, reducedMotion: false })).toBe(true);
    const r = new WorldOverlay();
    r.sync([], [arc], [], []);
    let moving = true;
    for (let i = 0; i < 20 && moving; i += 1) moving = r.step({ dt: 0.016, flying: false, arrive: 1, reducedMotion: true });
    expect(moving).toBe(false);
  });

  it('entrada inválida (NaN, id duplicado) é ignorada sem quebrar', () => {
    const o = new WorldOverlay();
    const spy = vi.fn();
    o.sync(
      [marker, { ...marker }, { ...marker, id: 'bad', lat: Number.NaN }],
      [{ ...arc, id: 'x', from: { lat: 200, lng: 0 } }],
      [{ id: 'n', lat: Infinity, lng: 0, title: 'x' }],
      ['', 'pa', 'PA'],
    );
    spy();
    expect(() => o.step({ dt: Number.NaN, flying: false, arrive: Number.NaN, reducedMotion: false })).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });
});

/* ══ Round 2: mouse/toque, época, deriva, varredura ═════════════════════ */

const H900 = 900;

function expectViewClose(a: CameraView, b: CameraView, tol = 1e-6): void {
  expect(Math.abs(a.lat - b.lat)).toBeLessThan(tol);
  expect(Math.abs(shortestArc(a.lng, b.lng))).toBeLessThan(tol);
  expect(Math.abs(a.dist - b.dist) / b.dist).toBeLessThan(tol);
  expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(tol * 10);
  expect(Math.abs(shortestArc(a.heading, b.heading))).toBeLessThan(tol * 10);
  expect(a.ox).toBe(b.ox);
  expect(a.oy).toBe(b.oy);
}

describe('leitura de volta: câmera do usuário → CameraView (ox/oy mantidos)', () => {
  it('limites do mapa: 250 m–30.000 km, 75° de inclinação, arrasto de 6 px, respiração depois de 6 s', () => {
    expect(INTERACTION).toMatchObject({ minZoomM: 250, maxZoomM: 30_000_000, maxTiltDeg: 75, dragPx: 6, idleBreathS: 6 });
  });

  it('ENU e elipsoide: base ortonormal, superfície ida e volta, raio toca a Terra', () => {
    const { e, n, u } = enuAt(-3.77, -49.67);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(e, n)).toBeCloseTo(0, 12);
    expect(dot(e, u)).toBeCloseTo(0, 12);
    expect(dot(n, u)).toBeCloseTo(0, 12);
    const p = ecefOf(-3.77, -49.67, 0);
    const ll = latLngOfSurface(p);
    expect(ll.lat).toBeCloseTo(-3.77, 9);
    expect(ll.lng).toBeCloseTo(-49.67, 9);
    const hit = rayEllipsoid(ecefOf(-3.77, -49.67, 10_000), u.map((v) => -v) as [number, number, number]);
    expect(hit).not.toBeNull();
    expect(latLngOfSurface(hit!).lat).toBeCloseTo(-3.77, 6);
    expect(rayEllipsoid(ecefOf(0, 0, 10_000), [1, 0, 0])).toBeNull(); // olhando para o espaço
  });

  it('ida e volta exata para as vistas do filme, com e sem rolagem', () => {
    for (const v of [...Object.values(V), { lat: 45, lng: 170, dist: 900, pitch: 20, heading: 200, ox: -300, oy: -170 }]) {
      for (const roll of [0, 7.5, -30]) {
        const rb = readBackView(poseFromView(v, H900, roll), v.ox, v.oy, H900, v.heading);
        expect(rb).not.toBeNull();
        expectViewClose(rb!.view, sanitizeView(v));
        expect(rb!.rollDeg).toBeCloseTo(roll, 6);
      }
    }
  });

  it('o modelo puro é o MESMO do Cesium: lookAt + rolagem + look(cima, −yaw) + look(direita, −pitch), e a leitura de volta o inverte', async () => {
    const C = await import('@cesium/engine');
    const scene = {
      drawingBufferWidth: 1440, drawingBufferHeight: H900, pixelRatio: 1, mode: C.SceneMode.SCENE3D,
      mapProjection: new C.GeographicProjection(), ellipsoid: C.Ellipsoid.WGS84, canvas: { clientWidth: 1440, clientHeight: H900 },
    };
    const cam = new C.Camera(scene as unknown as ConstructorParameters<typeof C.Camera>[0]);
    const tgt = new C.Cartesian3();
    const axis = new C.Cartesian3();
    for (const v of [V.usina, V.portfolio, V.supply, { lat: 45, lng: 170, dist: 900, pitch: 20, heading: 200, ox: -300, oy: -170 }]) {
      for (const roll of [0, 12]) {
        // exatamente o `applyCamera` do motor
        C.Cartesian3.fromDegrees(v.lng, v.lat, 0, C.Ellipsoid.WGS84, tgt);
        cam.lookAt(tgt, new C.HeadingPitchRange(v.heading * DEG, -Math.min(v.pitch, 89.9) * DEG, v.dist * 1000));
        cam.lookAtTransform(C.Matrix4.IDENTITY);
        if (roll) cam.look(C.Cartesian3.clone(cam.direction, axis), -roll * DEG);
        const { yaw, pitch } = offsetAngles(v.ox, v.oy, H900);
        if (yaw) cam.look(C.Cartesian3.clone(cam.up, axis), -yaw);
        if (pitch) cam.look(C.Cartesian3.clone(cam.right, axis), -pitch);
        const pure = poseFromView(v, H900, roll);
        const c = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];
        c(cam.positionWC).forEach((x, i) => expect(Math.abs(x - pure.position[i])).toBeLessThan(1e-3));
        c(cam.directionWC).forEach((x, i) => expect(x).toBeCloseTo(pure.direction[i], 9));
        c(cam.upWC).forEach((x, i) => expect(x).toBeCloseTo(pure.up[i], 9));
        c(cam.rightWC).forEach((x, i) => expect(x).toBeCloseTo(pure.right[i], 9));
        const rb = readBackView({
          position: c(cam.positionWC) as [number, number, number], direction: c(cam.directionWC) as [number, number, number],
          up: c(cam.upWC) as [number, number, number], right: c(cam.rightWC) as [number, number, number],
        }, v.ox, v.oy, H900, v.heading);
        expectViewClose(rb!.view, sanitizeView(v), 1e-6);
        expect(rb!.rollDeg).toBeCloseTo(roll, 6);
      }
    }
  });

  it('o rumo lido fica perto do anterior (sem salto de 360°)', () => {
    const v = { ...V.usina, heading: 358 };
    const rb = readBackView(poseFromView(v, H900), v.ox, v.oy, H900, -2);
    expect(rb!.view.heading).toBeCloseTo(-2, 6);
  });

  it('enquadramento no céu cai no centro; sem Terra à vista, a vertical sob a câmera; pose inválida = null', () => {
    // inclinado quase no horizonte com o ponto de enquadramento muito acima do centro
    const sky = { lat: -10, lng: -50, dist: 3000, pitch: 16, heading: 0, ox: 0, oy: 0 };
    const pose = poseFromView(sky, H900);
    const rb = readBackView(pose, 0, -4000, H900, 0);
    expect(rb).not.toBeNull();
    expect(Object.values(rb!.view).every(Number.isFinite)).toBe(true);
    // câmera olhando para longe da Terra
    const away: CameraPose = { position: ecefOf(0, 0, 1_000_000), direction: [1, 0, 0], up: [0, 0, 1], right: [0, -1, 0] };
    const nadir = readBackView(away, 0, 0, H900, 12);
    expect(nadir!.view.pitch).toBeCloseTo(89.9, 6);
    expect(nadir!.view.dist).toBeCloseTo(1000, 3);
    expect(nadir!.view.heading).toBe(12);
    expect(readBackView({ ...away, position: [Number.NaN, 0, 0] }, 0, 0, H900)).toBeNull();
  });
});

describe('época da vista: voar, só trocar o alvo, ou nada', () => {
  it('nova época voa mesmo com a vista igual quando a câmera saiu dela', () => {
    expect(retargetAction({ sameView: true, newEpoch: true, userMoved: true })).toBe('fly');
    expect(retargetAction({ sameView: true, newEpoch: true, userMoved: false, offTarget: true })).toBe('fly');
    expect(retargetAction({ sameView: true, newEpoch: true, userMoved: false })).toBe('none');
    expect(retargetAction({ sameView: false, newEpoch: true, userMoved: true })).toBe('fly');
  });

  it('mesma época: vista nova voa, a não ser que o usuário tenha mexido (a câmera não é roubada)', () => {
    expect(retargetAction({ sameView: false, newEpoch: false, userMoved: false })).toBe('fly');
    expect(retargetAction({ sameView: false, newEpoch: false, userMoved: true })).toBe('target');
    expect(retargetAction({ sameView: true, newEpoch: false, userMoved: true })).toBe('none');
    expect(retargetAction({ sameView: true, newEpoch: false, userMoved: false, offTarget: true })).toBe('none');
  });

  it('a rolagem lida no início do voo chega a 0 no pouso', () => {
    expect(flightRoll(20, 0)).toBe(20);
    expect(flightRoll(20, 0.5)).toBe(10);
    expect(flightRoll(20, 1)).toBe(0);
    expect(flightRoll(Number.NaN, 0.5)).toBe(0);
    expect(flightRoll(20, Number.NaN)).toBe(0);
  });
});

describe('reajuste do voo em curso (mesma época): o enquadramento refina sem recomeçar', () => {
  const site: CameraView = { lat: -3.7662, lng: -49.6725, dist: 3.2, pitch: 50, heading: 64, ox: -211, oy: -279 };

  it('só é refinamento perto do alvo: mesmo lugar, distância até 2,5×, rumo ±30°, inclinação ±15°', () => {
    expect(reaimable(site, { ...site, dist: 2.76, oy: -238, ox: -213 })).toBe(true); // o Gantt medido
    expect(reaimable(site, { ...site, dist: 1.2 })).toBe(false); // 2,7× mais perto
    expect(reaimable(site, { ...site, heading: 110 })).toBe(false);
    expect(reaimable(site, { ...site, pitch: 70 })).toBe(false);
    expect(reaimable(site, { ...site, lat: site.lat + 0.1 })).toBe(false); // 11 km ao lado de uma vista a 3 km
    expect(reaimable(V.portfolio, { ...V.portfolio, lat: V.portfolio.lat + 1 })).toBe(true); // 111 km numa vista a 1550 km
    expect(reaimable(null, site)).toBe(false);
  });

  it('mistura: começa exatamente no voo antigo, termina exatamente no novo, contínua e sem NaN', () => {
    const from: CameraView = { ...V.portfolio, ox: 18, oy: -33, dist: 900 };
    const old = createFlight(from, site, 10);
    const next = { ...site, dist: 2.76, ox: -213, oy: -238 };
    const nf = createFlight(from, next, 10); // mesmo início, mesmo relógio
    const t0 = 10.8;
    const t1 = Math.max(t0 + REAIM_MIN_S, nf.t0 + nf.dur);
    const at = (t: number) => {
      const w = reaimWeight(t, t0, t1);
      return blendView(sampleFlight(old, t).cam, sampleFlight(nf, t).cam, w);
    };
    expectViewClose(at(t0), sampleFlight(old, t0).cam, 1e-9);
    const end = at(t1);
    expect(end.dist).toBeCloseTo(next.dist, 9);
    expect(end.ox).toBeCloseTo(next.ox, 9);
    expect(end.oy).toBeCloseTo(next.oy, 9);
    let prev = at(t0);
    for (let t = t0; t <= t1; t += 1 / 60) {
      const c = at(t);
      expect(allFinite(c)).toBe(true);
      // sem salto entre quadros (log da distância, deslocamento de tela)
      expect(Math.abs(Math.log(c.dist / prev.dist))).toBeLessThan(0.2);
      expect(Math.abs(c.oy - prev.oy)).toBeLessThan(40);
      prev = c;
    }
    expect(reaimWeight(t0 - 1, t0, t1)).toBe(0);
    expect(reaimWeight(t1 + 1, t0, t1)).toBe(1);
    expect(reaimWeight(Number.NaN, t0, t1)).toBe(1);
    expect(blendView(site, next, Number.NaN)).toEqual(blendView(site, next, 1));
  });
});

describe('projeção pura (enquadramento sem o motor)', () => {
  it('o alvo cai em (W/2 + ox, H/2 + oy); atrás da câmera ou lixo = null', () => {
    const v: CameraView = { lat: -3.7662, lng: -49.6725, dist: 900, pitch: 52, heading: -4, ox: 18, oy: -33 };
    const pose = poseFromView(v, 858);
    const s = projectPose(pose, 1368, 858, ecefOf(v.lat, v.lng, 0))!;
    // (os dois giros do enquadramento se acoplam em milésimos de px — o mesmo no Cesium)
    expect(Math.abs(s[0] - (684 + 18))).toBeLessThan(0.05);
    expect(Math.abs(s[1] - (429 - 33))).toBeLessThan(0.05);
    // na própria câmera / atrás dela: sem projeção
    expect(projectPose(pose, 1368, 858, pose.position)).toBeNull();
    const behind = pose.position.map((c, i) => c - pose.direction[i] * 1000) as [number, number, number];
    expect(projectPose(pose, 1368, 858, behind)).toBeNull();
    expect(projectPose(pose, 0, 858, ecefOf(0, 0, 0))).toBeNull();
    expect(projectPose(pose, 1368, 858, [Number.NaN, 0, 0])).toBeNull();
  });
});

describe('área livre no motor: `--ag-free` + créditos', () => {
  it('lê "l t r b", prende no palco e recusa lixo', () => {
    expect(parseFreeRect('480 72 928 804', 1368, 858)).toEqual({ l: 480, t: 72, r: 928, b: 804 });
    expect(parseFreeRect(' "-10 5 2000 900" ', 1368, 858)).toEqual({ l: 0, t: 5, r: 1368, b: 858 });
    expect(parseFreeRect('', 1368, 858)).toBeNull();
    expect(parseFreeRect('1 2 3', 1368, 858)).toBeNull();
    expect(parseFreeRect('10 10 20 20', 1368, 858)).toBeNull(); // pequeno demais
    expect(parseFreeRect('a b c d', 1368, 858)).toBeNull();
    expect(parseFreeRect(null, 1368, 858)).toBeNull();
  });

  it('sem área declarada: o palco menos a margem; a linha dos créditos que cruza a área é tirada', () => {
    expect(effectiveFree(null, 390, 371, null)).toEqual({ l: STAGE_MARGIN, t: STAGE_MARGIN, r: 390 - STAGE_MARGIN, b: 371 - STAGE_MARGIN });
    // celular: os créditos (2 linhas) sobem acima da folha — a área termina 6 px acima deles
    const phone = effectiveFree({ l: 12, t: 60, r: 378, b: 323 }, 390, 371, { l: 16, t: 305, r: 374, b: 337 });
    expect(phone.b).toBe(299);
    // desktop: os créditos ficam sob a coluna direita — não cruzam a área
    const desk = effectiveFree({ l: 480, t: 72, r: 928, b: 804 }, 1368, 858, { l: 973, t: 832, r: 1352, b: 848 });
    expect(desk.b).toBe(804);
  });
});

describe('rótulos do mapa dentro da área livre', () => {
  const free = { l: 12, t: 60, r: 378, b: 323 };

  const inside = (b: { l: number; t: number; r: number; b: number } | null) => !!b && b.l >= free.l && b.r <= free.r && b.t >= free.t && b.b <= free.b;

  it('cartão de dado sem espaço à direita vira para a esquerda do nó; sem lado nenhum (390 px), abaixo/acima', () => {
    // nó em x = 300 → o ponto de ancoragem do cartão é x + 18
    expect(fitLabel('node', 318, 200, 250, free, 69)).toMatchObject({ x: 300 - 18, side: 'l' });
    expect(fitLabel('node', 100, 200, 250, free, 69)).toMatchObject({ x: 100, side: 'r' }); // cabe à direita: fica
    // nem de um lado nem do outro (Belém a 390 px): centrado ABAIXO do nó, deslizando para dentro
    const below = fitLabel('node', 280, 150, 253, free, 69);
    expect(below).toMatchObject({ x: 378 - 253 / 2, side: 'b' });
    expect(inside(below.box)).toBe(true);
    // sem lugar embaixo: acima
    expect(fitLabel('node', 280, 300, 253, free, 69)).toMatchObject({ x: 378 - 253 / 2, side: 't' });
    // nó fora da área (sob o HUD): sem ajuste
    expect(fitLabel('node', 418, 200, 250, free, 69)).toMatchObject({ x: 418, side: 'r', box: null });
  });

  it('dois cartões perto (390 px depois da varredura): o segundo não cobre o primeiro; apertado demais = o que menos cobre', () => {
    type B = { l: number; t: number; r: number; b: number };
    const cross = (a: B, b: B) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const area = (a: B, b: B) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    // Belém no alto, Marabá embaixo (como depois da revelação): os dois inteiros e sem se cobrir
    const taken: B[] = [];
    const belem = fitLabel('node', 280, 110, 253, free, 69, taken);
    expect(belem.side).toBe('b');
    expect(inside(belem.box)).toBe(true);
    taken.push(belem.box!);
    const maraba = fitLabel('node', 248, 250, 176, free, 69, taken);
    expect(inside(maraba.box)).toBe(true);
    expect(cross(maraba.box!, belem.box!)).toBe(false);
    // com a linha de status da varredura no meio não há lugar livre: fica inteiro na área e cobre o MÍNIMO
    const status = fitLabel('status', 195, 230, 272, free, 32);
    expect(status.box).toEqual({ l: 195 - 136, t: 230, r: 195 + 136, b: 262 });
    const crowded = [status.box!, belem.box!];
    const m2 = fitLabel('node', 230, 261, 176, free, 69, crowded);
    expect(inside(m2.box)).toBe(true);
    const cost = (b: B) => crowded.reduce((s, q) => s + area(b, q), 0);
    for (const side of ['r', 'l', 'b', 't'] as const) {
      const alt = fitLabel('node', 230, 261, 176, free, 69, crowded, side);
      if (inside(alt.box) && alt.side === side) expect(cost(m2.box!)).toBeLessThanOrEqual(cost(alt.box!));
    }
    // histerese: o lado anterior, se ainda serve, fica
    expect(fitLabel('node', 100, 200, 200, free, 69, [], 'b').side).toBe('b');
    expect(fitLabel('node', 100, 200, 200, free, 69, [], 'x').side).toBe('r');
  });

  it('nome e linha de status (centrados) deslizam para dentro; área estreita = centro da área', () => {
    expect(fitLabel('tag', 330, 100, 334, { l: 480, t: 72, r: 928, b: 804 })).toMatchObject({ x: 330, side: 'r' }); // fora: nada
    expect(fitLabel('tag', 900, 100, 334, { l: 480, t: 72, r: 928, b: 804 })).toMatchObject({ x: 928 - 167, side: 'r' });
    expect(fitLabel('status', 20, 100, 200, free)).toMatchObject({ x: 12 + 100, side: 'r' });
    expect(fitLabel('tag', 200, 100, 400, free)).toMatchObject({ x: 195, side: 'r' });
    expect(fitLabel('tag', 200, 100, 0, free)).toMatchObject({ x: 200, side: 'r' });
    expect(fitLabel('tag', 200, 100, 100, null)).toMatchObject({ x: 200, side: 'r' });
  });
});

describe('deriva depois do pouso ("procurando")', () => {
  const d = sanitizeDrift({ headingDeg: -4, distK: 0.95, seconds: 4.6 })!;

  it('entra e sai suave, soma rumo e fator de distância, termina no alvo da deriva', () => {
    expect(driftOffset(d, 0)).toEqual({ heading: -0, distMul: 1, done: false });
    const mid = driftOffset(d, 2.3);
    expect(mid.heading).toBeCloseTo(-2, 6);
    expect(mid.distMul).toBeCloseTo(0.975, 6);
    const end = driftOffset(d, 10);
    expect(end).toEqual({ heading: -4, distMul: 0.95, done: true });
    expect(driftOffset(null, 1)).toEqual({ heading: 0, distMul: 1, done: true });
  });

  it('deriva inválida é ignorada; valores extremos são presos', () => {
    expect(sanitizeDrift(null)).toBeNull();
    expect(sanitizeDrift({ headingDeg: Number.NaN, distK: 1, seconds: 2 })).toBeNull();
    expect(sanitizeDrift({ headingDeg: 1, distK: 1, seconds: 0 })).toBeNull();
    expect(sanitizeDrift({ headingDeg: 1, distK: -1, seconds: 2 })).toBeNull();
    expect(sanitizeDrift({ headingDeg: 999, distK: 99, seconds: 999 })).toEqual({ headingDeg: 45, distK: 4, seconds: 60 });
  });
});

/** Canvas 2D de mentira (o teste olha a lógica, não os pixels). */
function stubCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (target, key: string) => {
      if (key in target) return target[key];
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => grad;
      return () => undefined;
    },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Projetor plano de teste: lng/lat → px (100 px por grau), sempre visível. */
function flatProjector(): Projector {
  return {
    ok: true,
    W: 1440,
    H: 900,
    cam: { x: 0, y: 0, z: 0 },
    project(x: number, y: number, z: number, out: Float64Array | number[]) {
      const r = Math.hypot(x, y);
      const lat = Math.atan2(z, r * (1 - 0.00669437999014)) / DEG;
      const lng = Math.atan2(y, x) / DEG;
      out[0] = 720 + (lng + 49) * 100;
      out[1] = 450 - (lat + 4) * 100;
      if (out.length > 2) out[2] = 1000;
      return true;
    },
  } as unknown as Projector;
}

describe('varredura da rede (cena 3): anéis, alcance, resposta, fases', () => {
  const TUCURUI = { lat: -3.7662, lng: -49.6725 };
  const MARABA = { id: 'stock:maraba', lat: -5.3686, lng: -49.1178, title: 'Canteiro LT Marabá' };
  const BARCARENA = { id: 'stock:barcarena', lat: -1.5059, lng: -48.6255, title: 'Canteiro UFV Barcarena' };
  const R = Math.max(greatCircleKm(TUCURUI, MARABA), greatCircleKm(TUCURUI, BARCARENA)) * 1.15;
  const arcs = [MARABA, BARCARENA].map((n) => ({ id: n.id, from: { lat: n.lat, lng: n.lng }, to: TUCURUI, h: 40, tone: 'healthy' as const }));
  const scan = (results: GlobeScan['results'], id = 'scan-1'): GlobeScan => ({
    id, origin: TUCURUI, radiusKm: R, results, statusText: 'Apex analisando a rede de estoque',
  });

  it('tempos do filme: 3 anéis a 0,45 s, 1,6 s cada; alcance pelo cruzamento do 1º anel', () => {
    expect(SCAN_T).toMatchObject({ rings: 3, gap: 0.45, ringDur: 1.6, answerDelay: 0.55 });
    expect(SCAN_RINGS_END).toBeCloseTo(2.5, 9);
    expect(scanReachTime(0, 100)).toBe(0);
    expect(scanReachTime(100, 100)).toBeCloseTo(1.6, 9);
    expect(scanReachTime(500, 100)).toBeCloseTo(1.6, 9); // além do alcance: o fim do 1º anel
    // o anel está EXATAMENTE na distância do nó no instante do alcance
    for (const f of [0.1, 0.35, 0.8]) {
      const t = scanReachTime(f * 200, 200);
      expect(200 * outCubic(t / SCAN_T.ringDur)).toBeCloseTo(f * 200, 6);
    }
    expect(scanReachTime(Number.NaN, 100)).toBe(1.6);
    expect(scanReachTime(10, 0)).toBe(1.6);
  });

  it('anéis vivos: raio cresce, opacidade cai; nada fora da janela', () => {
    expect(scanRings(-1, 100)).toEqual([]);
    const at1 = scanRings(1, 100);
    expect(at1).toHaveLength(3);
    expect(at1[0].r).toBeGreaterThan(at1[1].r);
    expect(at1[1].r).toBeGreaterThan(at1[2].r);
    expect(at1[0].alpha).toBeLessThan(at1[2].alpha);
    expect(scanRings(3, 100)).toEqual([]);
    expect(scanRings(1, 0)).toEqual([]);
  });

  it('fases: rings → answering (1º anel varreu ou alguém respondeu) → done (todos + 0,6 s, nunca antes dos anéis)', () => {
    expect(scanPhaseOf(-1, [null])).toBeNull();
    expect(scanPhaseOf(0.5, [null, null])).toBe('rings');
    expect(scanPhaseOf(1.7, [null, null])).toBe('answering');
    expect(scanPhaseOf(1.2, [1.1, null])).toBe('answering');
    expect(scanPhaseOf(2.0, [1.1, 1.3])).toBe('answering'); // anéis ainda correndo
    expect(scanPhaseOf(2.6, [1.1, 1.3])).toBe('done');
    expect(scanPhaseOf(9, [8.9, 1.3])).toBe('answering');
    expect(scanPhaseOf(9.5, [8.9, 1.3])).toBe('done');
    expect(scanPhaseOf(2.6, [])).toBe('done'); // rede sem nós: termina com os anéis
    expect(scanPhaseOf(0, [null], true)).toBe('answering');
    expect(scanPhaseOf(0, [0], true)).toBe('done');
  });

  it('grande círculo: ponto a d km no rumo volta à distância d', () => {
    for (const b of [0, 90, 225]) {
      const q = destinationPoint(TUCURUI.lat, TUCURUI.lng, b, 180);
      expect(greatCircleKm(TUCURUI, q)).toBeCloseTo(180, 6);
    }
  });

  it('arco ↔ nó da varredura: mesmo id ou ponta no nó', () => {
    const nodes = [MARABA, BARCARENA];
    const results = { [MARABA.id]: null, [BARCARENA.id]: null };
    expect(scanNodeForArc(arcs[0], nodes, results)).toBe(MARABA.id);
    expect(scanNodeForArc({ ...arcs[1], id: 'rota-x' }, nodes, results)).toBe(BARCARENA.id);
    expect(scanNodeForArc({ ...arcs[1], id: 'rota-x', from: { lat: 0, lng: 0 } }, nodes, results)).toBeNull();
    expect(scanNodeForArc(arcs[0], nodes, {})).toBeNull();
  });

  it('no overlay: "consultando…" até o anel chegar E o servidor responder; vira a resposta; fases em ordem', () => {
    const o = new WorldOverlay();
    const ctx = stubCtx();
    const P = flatProjector();
    o.sync([], arcs, [MARABA, BARCARENA], []);
    o.syncScan(scan({ [MARABA.id]: null, [BARCARENA.id]: null }));
    const frame = (t: number, extra: Partial<{ flying: boolean; arrive: number; reducedMotion: boolean }> = {}) => {
      o.step({ dt: 0.1, flying: extra.flying ?? false, arrive: extra.arrive ?? 1, reducedMotion: extra.reducedMotion ?? false });
      return o.draw(ctx, P, { t, dist: 600, reducedMotion: extra.reducedMotion ?? false, hoverId: null, flying: extra.flying ?? false, arrive: extra.arrive ?? 1 });
    };
    // recuo ainda voando: o relógio não começa
    frame(9, { flying: true, arrive: 0.5 });
    expect(o.scanPhase).toBeNull();
    expect(o.motion).toBe(true);
    let labels = frame(10);
    expect(o.scanPhase).toEqual({ id: 'scan-1', phase: 'rings' });
    expect(o.motion).toBe(true);
    labels = frame(13);
    expect(o.scanPhase?.phase).toBe('answering');
    const node = (id: string) => labels.find((l) => l.id === `n:${id}`)!;
    expect(node(MARABA.id).value).toBe('consultando…');
    expect(node(MARABA.id).state).toBe('pending');
    expect(labels.find((l) => l.id === 's:scan')?.title).toBe('Apex analisando a rede de estoque');
    // o servidor responde (mesmo id: o relógio segue)
    o.syncScan(scan({ [MARABA.id]: { tone: 'hit', value: '250 m disponíveis' }, [BARCARENA.id]: { tone: 'none', value: 'sem saldo disponível' } }));
    labels = frame(13.2);
    expect(node(MARABA.id).value).toBe('250 m disponíveis');
    expect(node(MARABA.id).state).toBe('answer');
    expect(node(MARABA.id).tone).toBe('hit');
    expect(node(BARCARENA.id).tone).toBe('none');
    expect(o.scanPhase?.phase).toBe('answering');
    frame(13.9);
    expect(o.scanPhase?.phase).toBe('done');
    // depois de tudo assentar, a varredura para de pedir quadros (só o fluxo do arco "hit" segue)
    labels = frame(20);
    expect(o.scanPhase?.phase).toBe('done');
    expect(labels.find((l) => l.id === 's:scan')?.alpha).toBe(0);
    // id novo = relógio novo
    o.syncScan(scan({ [MARABA.id]: null, [BARCARENA.id]: null }, 'scan-2'));
    frame(30);
    expect(o.scanPhase).toEqual({ id: 'scan-2', phase: 'rings' });
    o.syncScan(null);
    frame(31);
    expect(o.scanPhase).toBeNull();
  });

  it('movimento reduzido: estado final imediato (sem anéis), "done" assim que todos respondem', () => {
    const o = new WorldOverlay();
    const ctx = stubCtx();
    o.sync([], arcs, [MARABA, BARCARENA], []);
    o.syncScan(scan({ [MARABA.id]: { tone: 'hit', value: '250 m disponíveis' }, [BARCARENA.id]: { tone: 'none', value: 'sem saldo' } }));
    o.step({ dt: 0.1, flying: true, arrive: 0.2, reducedMotion: true });
    const labels = o.draw(ctx, flatProjector(), { t: 5, dist: 600, reducedMotion: true, hoverId: null, flying: true, arrive: 0.2 });
    expect(o.scanPhase?.phase).toBe('done');
    expect(labels.find((l) => l.id === `n:${MARABA.id}`)?.value).toBe('250 m disponíveis');
  });

  it('com nós no mapa (Supply), os OUTROS projetos são contexto: esmaecidos e desenhados ANTES (por baixo) dos nós', () => {
    const draws: Array<{ x: number; alpha: number }> = [];
    const store: Record<string, unknown> = { globalAlpha: 1 };
    const rec = new Proxy(store, {
      get: (target, key: string) => {
        if (key in target) return target[key];
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
        if (key === 'drawImage') {
          return (_img: unknown, x: number, _y: number, w: number) => draws.push({ x: x + w / 2, alpha: Number(target.globalAlpha) });
        }
        return () => undefined;
      },
      set: (target, key: string, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    // o sprite do hexágono precisa de um canvas: um de mentira basta (o desenho é registrado no `rec`)
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx() }) });
    try {
      const BELEM = { id: 'stock:belem', lat: -1.4558, lng: -48.4902, title: 'Almoxarifado Central — Belém' };
      const markers = [
        { id: 'barcarena', lat: BARCARENA.lat, lng: BARCARENA.lng, tone: 'critical' as const, label: 'Usina Solar Barcarena', pulse: 0 },
        { id: 'tucurui', lat: TUCURUI.lat, lng: TUCURUI.lng, tone: 'critical' as const, label: 'SE Tucuruí', selected: true, size: 52 },
      ];
      const o = new WorldOverlay();
      const settleAll = () => { for (let i = 0; i < 300; i += 1) o.step({ dt: 0.05, flying: false, arrive: 1, reducedMotion: true }); };
      o.sync(markers, [], [BELEM], []);
      settleAll();
      const P = flatProjector();
      o.draw(rec, P, { t: 1, dist: 600, reducedMotion: true, hoverId: null });
      const xOf = (lng: number) => 720 + (lng + 49) * 100;
      const find = (lng: number) => draws.findIndex((d) => Math.abs(d.x - xOf(lng)) < 0.5);
      const [iBar, iBel, iTuc] = [find(BARCARENA.lng), find(BELEM.lng), find(TUCURUI.lng)];
      expect(iBar).toBeGreaterThanOrEqual(0);
      expect(iBar).toBeLessThan(iBel); // o projeto vizinho por BAIXO do almoxarifado
      expect(iBel).toBeLessThan(iTuc); // o local em foco por cima
      expect(draws[iBar].alpha).toBeCloseTo(CONTEXT_MARKER_ALPHA, 6);
      expect(draws[iTuc].alpha).toBeCloseTo(1, 6);
      // ainda clicável (é outro projeto de verdade)
      expect(o.pick(xOf(BARCARENA.lng), 450 - (BARCARENA.lat + 4) * 100)).toBe('barcarena');
      // sem nós (portfólio, local): nada esmaecido
      draws.length = 0;
      o.sync(markers, [], [], []);
      settleAll();
      o.draw(rec, P, { t: 2, dist: 600, reducedMotion: true, hoverId: null });
      expect(draws[find(BARCARENA.lng)]?.alpha).toBeCloseTo(1, 6);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('modelo esquemático só perto do chão: opacidade (7,5 − d)/3,5 — inteiro até 4 km (o Planejar recua para caber acima do Gantt)', () => {
    expect(twinDistanceAlpha(1.4)).toBe(1);
    expect(twinDistanceAlpha(2)).toBe(1);
    expect(twinDistanceAlpha(3.4)).toBe(1);
    expect(twinDistanceAlpha(4)).toBe(1);
    expect(twinDistanceAlpha(5.75)).toBeCloseTo(0.5, 9);
    expect(twinDistanceAlpha(7.5)).toBe(0);
    expect(twinDistanceAlpha(Number.NaN)).toBe(0);
  });
});

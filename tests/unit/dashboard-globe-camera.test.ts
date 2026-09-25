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
import type { CameraView } from '@/components/dashboard-globe/contract';
import {
  approach,
  breathOffset,
  cesiumFov,
  createFlight,
  cubicBezier,
  DEG,
  easeCine,
  FALLBACK_VIEW,
  flightDuration,
  focalPx,
  offsetAngles,
  sampleFlight,
  sanitizeView,
  shortestArc,
  stepCamera,
  viewsEqual,
  wrap180,
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
  decodeArcInts,
  llhToEcef,
  pickNearest,
  Projector,
  ringInts,
  validLatLng,
  WorldOverlay,
} from '@/components/dashboard-globe/overlay';
import { UF_ARCS, UF_RINGS } from '@/components/dashboard-globe/br-uf-geo';

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

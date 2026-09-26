/**
 * RÓTULOS DO MUNDO — DOM preso a lat/lng (`APEX FILM/js/world/world.js:611-639`).
 *
 * `wl-tag` (nome do lugar) e `wl-node` (cartão de dado no mapa). Um elemento por
 * id, reaproveitado entre quadros; o laço do globo só escreve `transform` e
 * `opacity` quando mudam (translate3d, `will-change`). Fora da tela (> 400 px)
 * ou atrás do horizonte, o rótulo some (`visibility: hidden` em 0).
 *
 * O texto entra sempre por `textContent` — nunca HTML vindo de dado.
 *
 * DENTRO DA ÁREA LIVRE: com a área livre do HUD (`apply(…, free)`), o rótulo
 * cujo ponto está nela nunca sai dela — o cartão de dado (`wl-node`) vira para
 * a esquerda do ponto quando não cabe à direita (ou vai para baixo/cima do nó,
 * sem cobrir outro cartão), e o nome/linha de status (centrados) deslizam na
 * horizontal. O tamanho é medido só quando o texto muda.
 */
import type { GlobeNode } from './contract';

/** Retângulo em px do palco. */
export interface LabelBounds { l: number; t: number; r: number; b: number }

/** Deslocamento do cartão de dado a partir do ponto de ancoragem (`translate(14px, -50%)`). */
const NODE_GAP = 14;
/** O ponto de ancoragem do cartão fica 18 px à direita do nó (overlay.ts); virado, 18 px à esquerda. */
const NODE_ANCHOR = 18;
/** Sem lugar dos lados: o cartão fica centrado abaixo (ou acima) do nó, a esta distância (px). */
export const NODE_BELOW = 24;

export type LabelSide = 'r' | 'l' | 'b' | 't';

const overlaps = (a: LabelBounds, b: LabelBounds) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const contains = (f: LabelBounds, b: LabelBounds) => b.l >= f.l && b.r <= f.r && b.t >= f.t && b.b <= f.b;

/**
 * Onde o rótulo fica, dada a área livre e o tamanho medido (`box` = a caixa
 * ocupada). O cartão de dado tenta, nesta ordem: à direita do nó, virado à
 * esquerda, centrado ABAIXO, centrado acima — o primeiro INTEIRO na área e sem
 * cobrir outro cartão já posto (`taken`); sem nenhum livre, o primeiro inteiro
 * na área. Nome/status centrados deslizam para dentro. Ponto fora da área
 * livre = sem ajuste (está sob o HUD).
 */
export function fitLabel(
  kind: LabelSpec['kind'],
  x: number,
  y: number,
  w: number,
  free: LabelBounds | null,
  h = 0,
  taken: readonly LabelBounds[] = [],
  /** O lado do quadro anterior, tentado primeiro (a deriva da câmera não faz o cartão pular). */
  prev?: string | null,
): { x: number; side: LabelSide; box: LabelBounds | null } {
  if (!free || !(w > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { x, side: 'r', box: null };
  const hh = h > 0 ? h : 0;
  const slide = (cx: number) => (free.r - free.l < w ? (free.l + free.r) / 2 : Math.min(Math.max(cx, free.l + w / 2), free.r - w / 2));
  if (kind === 'node') {
    const nodeX = x - NODE_ANCHOR;
    if (nodeX < free.l || nodeX > free.r || y < free.t || y > free.b) return { x, side: 'r', box: null };
    const cx = slide(nodeX);
    const lx = nodeX - NODE_ANCHOR;
    const cands: Array<{ x: number; side: LabelSide; box: LabelBounds }> = [
      { x, side: 'r', box: { l: x + NODE_GAP, t: y - hh / 2, r: x + NODE_GAP + w, b: y + hh / 2 } },
      { x: lx, side: 'l', box: { l: lx - NODE_GAP - w, t: y - hh / 2, r: lx - NODE_GAP, b: y + hh / 2 } },
      { x: cx, side: 'b', box: { l: cx - w / 2, t: y + NODE_BELOW, r: cx + w / 2, b: y + NODE_BELOW + hh } },
      { x: cx, side: 't', box: { l: cx - w / 2, t: y - NODE_BELOW - hh, r: cx + w / 2, b: y - NODE_BELOW } },
    ];
    const ok = (c: (typeof cands)[number]) => contains(free, c.box) && !taken.some((q) => overlaps(c.box, q));
    const last = cands.find((c) => c.side === prev);
    const clear = (last && ok(last) ? last : null) ?? cands.find(ok);
    if (clear) return clear;
    // área apertada demais (celular com a varredura): o lugar inteiro na área que MENOS cobre os outros
    const covered = (b: LabelBounds) => taken.reduce((s, q) => s + Math.max(0, Math.min(b.r, q.r) - Math.max(b.l, q.l)) * Math.max(0, Math.min(b.b, q.b) - Math.max(b.t, q.t)), 0);
    const fits = cands.filter((c) => contains(free, c.box));
    return fits.length ? fits.reduce((best, c) => (covered(c.box) < covered(best.box) ? c : best)) : cands[0];
  }
  if (x < free.l || x > free.r) return { x, side: 'r', box: null };
  const sx = slide(x);
  return { x: sx, side: 'r', box: kind === 'status' ? { l: sx - w / 2, t: y, r: sx + w / 2, b: y + hh } : null };
}

export interface LabelSpec {
  /** `m:<id>` (marcador), `n:<id>` (cartão) ou `s:scan` (linha de status da varredura). */
  id: string;
  kind: 'tag' | 'node' | 'status';
  title: string;
  value?: string | null;
  tone?: GlobeNode['tone'];
  /** Cartão da varredura: "consultando…" (`pending`) ou a resposta (`answer`, vira com animação). */
  state?: 'pending' | 'answer';
  /** Posição do ponto de ancoragem, px CSS do palco. */
  x: number;
  y: number;
  alpha: number;
}

interface Entry {
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  name: HTMLDivElement | null;
  val: HTMLDivElement | null;
  kind: LabelSpec['kind'];
  title: string;
  value: string | null;
  tone: string;
  state: string;
  transform: string;
  opacity: string;
  hidden: boolean;
  side: string;
  /** Tamanho medido (px); `w = -1` = medir de novo (o texto mudou). */
  w: number;
  h: number;
}

const OFFSCREEN_X = 400;
const OFFSCREEN_Y = 300;

export class LabelPool {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly root: HTMLElement) {}

  /**
   * Aplica os rótulos do quadro; ids ausentes saem do DOM. Com `free`, o rótulo
   * fica dentro da área livre; `remeasure` relê as larguras (a fonte da web pode chegar depois).
   */
  apply(specs: readonly LabelSpec[], W: number, H: number, free: LabelBounds | null = null, remeasure = false): void {
    const seen = new Set<string>();
    const shown: Array<{ s: LabelSpec; e: Entry }> = [];
    for (const s of specs) {
      seen.add(s.id);
      let e = this.entries.get(s.id);
      if (!e || e.kind !== s.kind) {
        if (e) e.outer.remove();
        e = this.create(s.kind);
        this.entries.set(s.id, e);
      }
      if (this.content(e, s) || remeasure) e.w = -1;
      const off = s.x < -OFFSCREEN_X || s.x > W + OFFSCREEN_X || s.y < -OFFSCREEN_Y || s.y > H + OFFSCREEN_Y;
      const alpha = !off && Number.isFinite(s.alpha) && Number.isFinite(s.x) && Number.isFinite(s.y)
        ? Math.min(1, Math.max(0, s.alpha))
        : 0;
      const hidden = alpha <= 0.001;
      if (hidden !== e.hidden) {
        e.outer.style.visibility = hidden ? 'hidden' : 'visible';
        e.hidden = hidden;
      }
      if (hidden) continue;
      const opacity = String(Math.round(alpha * 1000) / 1000);
      if (opacity !== e.opacity) {
        e.outer.style.opacity = opacity;
        e.opacity = opacity;
      }
      // o tamanho do texto (uma leitura de layout só quando o texto muda)
      if (free && e.w < 0) {
        e.w = e.inner.offsetWidth;
        e.h = e.inner.offsetHeight;
      }
      shown.push({ s, e });
    }
    // posições: a linha de status primeiro (fixa), depois os cartões um a um (sem cobrir um já posto), depois os nomes
    const taken: LabelBounds[] = [];
    const order = (k: LabelSpec['kind']) => (k === 'status' ? 0 : k === 'node' ? 1 : 2);
    for (const { s, e } of [...shown].sort((a, b) => order(a.s.kind) - order(b.s.kind))) {
      const fit = fitLabel(s.kind, s.x, s.y, e.w, free, e.h, taken, e.side || 'r');
      if (fit.box) taken.push(fit.box);
      if (fit.side !== e.side) {
        if (fit.side === 'r') delete e.inner.dataset.side;
        else e.inner.dataset.side = fit.side;
        e.side = fit.side;
      }
      const transform = `translate3d(${Math.round(fit.x * 10) / 10}px, ${Math.round(s.y * 10) / 10}px, 0)`;
      if (transform !== e.transform) {
        e.outer.style.transform = transform;
        e.transform = transform;
      }
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        e.outer.remove();
        this.entries.delete(id);
      }
    }
  }

  clear(): void {
    for (const e of this.entries.values()) e.outer.remove();
    this.entries.clear();
  }

  private create(kind: LabelSpec['kind']): Entry {
    const outer = document.createElement('div');
    outer.className = 'ag-wlabel';
    outer.style.visibility = 'hidden';
    const inner = document.createElement('div');
    inner.className = kind === 'node' ? 'wl-node' : kind === 'status' ? 'wl-scan' : 'wl-tag';
    outer.appendChild(inner);
    let name: HTMLDivElement | null = null;
    let val: HTMLDivElement | null = null;
    if (kind === 'node') {
      name = document.createElement('div');
      name.className = 'wl-name';
      val = document.createElement('div');
      val.className = 'wl-val';
      val.style.display = 'none';
      inner.append(name, val);
    } else if (kind === 'status') {
      // radar (CSS) + texto
      const radar = document.createElement('i');
      radar.className = 'wl-radar';
      name = document.createElement('div');
      name.className = 'wl-scan-text';
      inner.append(radar, name);
    }
    this.root.appendChild(outer);
    return { outer, inner, name, val, kind, title: '', value: null, tone: '', state: '', transform: '', opacity: '', hidden: true, side: '', w: -1, h: 0 };
  }

  /** Atualiza o texto; `true` quando o que ocupa largura mudou (título ou valor). */
  private content(e: Entry, s: LabelSpec): boolean {
    const title = s.title ?? '';
    let grew = false;
    if (e.kind === 'tag') {
      if (title !== e.title) {
        e.inner.textContent = title;
        e.title = title;
        grew = true;
      }
      return grew;
    }
    if (e.kind === 'status') {
      if (title !== e.title && e.name) {
        e.name.textContent = title;
        e.title = title;
        grew = true;
      }
      return grew;
    }
    const state = s.state ?? '';
    if (state !== e.state) {
      if (state) e.inner.dataset.state = state;
      else delete e.inner.dataset.state;
      e.state = state;
    }
    if (title !== e.title && e.name) {
      e.name.textContent = title;
      e.title = title;
      grew = true;
    }
    const value = s.value ?? null;
    if (value !== e.value && e.val) {
      e.val.textContent = value ?? '';
      e.val.style.display = value ? '' : 'none';
      e.value = value;
      grew = true;
    }
    const tone = s.tone && s.tone !== 'default' ? s.tone : '';
    if (tone !== e.tone) {
      if (tone) e.inner.dataset.tone = tone;
      else delete e.inner.dataset.tone;
      e.tone = tone;
    }
    return grew;
  }
}

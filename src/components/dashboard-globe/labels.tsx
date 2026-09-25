/**
 * RÓTULOS DO MUNDO — DOM preso a lat/lng (`APEX FILM/js/world/world.js:611-639`).
 *
 * `wl-tag` (nome do lugar) e `wl-node` (cartão de dado no mapa). Um elemento por
 * id, reaproveitado entre quadros; o laço do globo só escreve `transform` e
 * `opacity` quando mudam (translate3d, `will-change`). Fora da tela (> 400 px)
 * ou atrás do horizonte, o rótulo some (`visibility: hidden` em 0).
 *
 * O texto entra sempre por `textContent` — nunca HTML vindo de dado.
 */
import type { GlobeNode } from './contract';

export interface LabelSpec {
  /** `m:<id>` (marcador) ou `n:<id>` (cartão). */
  id: string;
  kind: 'tag' | 'node';
  title: string;
  value?: string | null;
  tone?: GlobeNode['tone'];
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
  transform: string;
  opacity: string;
  hidden: boolean;
}

const OFFSCREEN_X = 400;
const OFFSCREEN_Y = 300;

export class LabelPool {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly root: HTMLElement) {}

  /** Aplica os rótulos do quadro; ids ausentes saem do DOM. */
  apply(specs: readonly LabelSpec[], W: number, H: number): void {
    const seen = new Set<string>();
    for (const s of specs) {
      seen.add(s.id);
      let e = this.entries.get(s.id);
      if (!e || e.kind !== s.kind) {
        if (e) e.outer.remove();
        e = this.create(s.kind);
        this.entries.set(s.id, e);
      }
      this.content(e, s);
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
      const transform = `translate3d(${Math.round(s.x * 10) / 10}px, ${Math.round(s.y * 10) / 10}px, 0)`;
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
    inner.className = kind === 'node' ? 'wl-node' : 'wl-tag';
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
    }
    this.root.appendChild(outer);
    return { outer, inner, name, val, kind, title: '', value: null, tone: '', transform: '', opacity: '', hidden: true };
  }

  private content(e: Entry, s: LabelSpec): void {
    const title = s.title ?? '';
    if (e.kind === 'tag') {
      if (title !== e.title) {
        e.inner.textContent = title;
        e.title = title;
      }
      return;
    }
    if (title !== e.title && e.name) {
      e.name.textContent = title;
      e.title = title;
    }
    const value = s.value ?? null;
    if (value !== e.value && e.val) {
      e.val.textContent = value ?? '';
      e.val.style.display = value ? '' : 'none';
      e.value = value;
    }
    const tone = s.tone && s.tone !== 'default' ? s.tone : '';
    if (tone !== e.tone) {
      if (tone) e.inner.dataset.tone = tone;
      else delete e.inner.dataset.tone;
      e.tone = tone;
    }
  }
}

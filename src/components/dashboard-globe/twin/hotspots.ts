/**
 * OS PONTOS DE INTERESSE DO MODELO — botões DOM presos ao modelo esquemático.
 *
 * Ficam FORA da camada `aria-hidden` do mundo (são interativos e lidos pelo
 * leitor de tela), um `<button>` por hotspot, reaproveitado entre quadros; o
 * laço do globo só escreve `transform`/`opacity`/`visibility` quando mudam.
 * Escondido = `visibility: hidden` + `tabIndex = -1` (nunca recebe foco).
 * Texto sempre por `textContent`. O rótulo obrigatório ("Representação
 * esquemática — não é o projeto executivo") é uma nota (`role="note"`).
 *
 * Duas fases por quadro: `prepare` cria/atualiza o conteúdo e devolve o
 * TAMANHO real de cada cartão (medido só quando o texto ou a largura do palco
 * mudam); o modelo decide o lugar (`placeCards`, dentro da área livre do HUD)
 * e `apply` só posiciona.
 */
import type { ModuleId, TwinHotspot } from '../contract';
import { CARD_SIZE, NOTE_SIZE, type CardPlacement, type CardSize, type TwinScreenPoint } from './draw';

const MODULE_LABEL: Record<ModuleId, string> = { overview: 'Visão geral', plan: 'Planejar', supply: 'Supply Chain', billing: 'Faturamento' };

interface Entry {
  el: HTMLButtonElement;
  label: HTMLSpanElement;
  value: HTMLSpanElement;
  key: string;
  transform: string;
  opacity: string;
  side: string;
  hidden: boolean;
  size: CardSize | null;
}

/** O nome acessível do hotspot ("Pátio de materiais: 2 materiais em falta — abre Supply Chain"). */
export function hotspotAriaLabel(h: TwinHotspot): string {
  const base = h.value ? `${h.label}: ${h.value}` : h.label;
  return h.target ? `${base} — abre ${MODULE_LABEL[h.target] ?? h.target}` : base;
}

/** Tamanho lido do DOM; 0 (camada escondida, sem layout) = o padrão. */
function measured(el: HTMLElement, fallback: CardSize): CardSize {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return w > 0 && h > 0 ? { w, h } : fallback;
}

export class HotspotPool {
  private readonly entries = new Map<string, Entry>();
  private note: { el: HTMLDivElement; text: string; transform: string; opacity: string; hidden: boolean; size: CardSize | null } | null = null;
  private stageW = -1;

  constructor(private readonly root: HTMLElement, private readonly onClick: (id: string) => void) {}

  /**
   * Cria/atualiza os botões e o rótulo deste quadro (ids ausentes saem do DOM)
   * e devolve os tamanhos. A medida (uma leitura de layout) só acontece quando
   * o conteúdo muda, a largura do palco muda (o cartão encolhe no celular) ou
   * o motor pede (`remeasure`, de tempos em tempos: a fonte da web pode chegar depois).
   */
  prepare(hotspots: readonly TwinHotspot[], noteText: string | null, W: number, remeasure = false): { sizes: Map<string, CardSize>; note: CardSize | null } {
    const resized = W !== this.stageW || remeasure;
    this.stageW = W;
    const sizes = new Map<string, CardSize>();
    const seen = new Set<string>();
    for (const h of hotspots) {
      if (!h || typeof h.id !== 'string') continue;
      seen.add(h.id);
      let e = this.entries.get(h.id);
      if (!e) {
        e = this.create(h.id);
        this.entries.set(h.id, e);
      }
      const changed = this.content(e, h);
      if (changed || resized || !e.size) e.size = measured(e.el, CARD_SIZE);
      sizes.set(h.id, e.size);
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        e.el.remove();
        this.entries.delete(id);
      }
    }
    let note: CardSize | null = null;
    if (noteText) {
      const n = this.ensureNote();
      const changed = noteText !== n.text;
      if (changed) {
        n.el.textContent = noteText;
        n.text = noteText;
      }
      if (changed || resized || !n.size) n.size = measured(n.el, NOTE_SIZE);
      note = n.size;
    }
    return { sizes, note };
  }

  /** Posiciona os cartões e o rótulo nos lugares decididos (`placeCards`). */
  apply(cards: ReadonlyMap<string, CardPlacement>, note: TwinScreenPoint | null, alpha: number): void {
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
    for (const [id, e] of this.entries) {
      const c = cards.get(id);
      this.place(e, c && c.shown ? a : 0, c ?? null);
    }
    this.applyNote(note, a);
  }

  clear(): void {
    for (const e of this.entries.values()) e.el.remove();
    this.entries.clear();
    this.note?.el.remove();
    this.note = null;
  }

  private create(id: string): Entry {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ag-hs';
    el.dataset.hotspot = id;
    el.style.visibility = 'hidden';
    el.tabIndex = -1;
    const dot = document.createElement('i');
    dot.className = 'ag-hs-dot';
    dot.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    txt.className = 'ag-hs-txt';
    const label = document.createElement('span');
    label.className = 'ag-hs-label';
    const value = document.createElement('span');
    value.className = 'ag-hs-val';
    txt.append(label, value);
    el.append(dot, txt);
    el.addEventListener('click', (ev) => {
      // o clique não chega ao palco (não seleciona o marcador embaixo)
      ev.stopPropagation();
      this.onClick(id);
    });
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    this.root.appendChild(el);
    return { el, label, value, key: '', transform: '', opacity: '', side: '', hidden: true, size: null };
  }

  /** Texto, tom e destino; `true` quando algo mudou (o tamanho precisa ser medido de novo). */
  private content(e: Entry, h: TwinHotspot): boolean {
    const key = `${h.label}|${h.value ?? ''}|${h.tone ?? ''}|${h.target ?? ''}|${h.role}`;
    if (key === e.key) return false;
    e.key = key;
    e.label.textContent = h.label;
    e.value.textContent = h.value ?? '';
    e.value.style.display = h.value ? '' : 'none';
    e.el.dataset.tone = h.tone ?? 'accent';
    e.el.dataset.role = h.role;
    if (h.target) e.el.dataset.target = h.target;
    else delete e.el.dataset.target;
    e.el.setAttribute('aria-label', hotspotAriaLabel(h));
    return true;
  }

  private place(e: Entry, alpha: number, c: CardPlacement | null): void {
    const hidden = alpha <= 0.05 || !c;
    if (hidden !== e.hidden) {
      e.el.style.visibility = hidden ? 'hidden' : 'visible';
      e.el.tabIndex = hidden ? -1 : 0;
      e.hidden = hidden;
      // nunca some com o foco dentro: devolve ao palco
      if (hidden && document.activeElement === e.el) e.el.blur();
    }
    if (hidden || !c) return;
    const opacity = String(Math.round(alpha * 1000) / 1000);
    if (opacity !== e.opacity) {
      e.el.style.opacity = opacity;
      e.opacity = opacity;
    }
    if (c.side !== e.side) {
      e.el.dataset.side = c.side;
      e.side = c.side;
    }
    const transform = `translate3d(${Math.round(c.left * 10) / 10}px, ${Math.round(c.top * 10) / 10}px, 0)`;
    if (transform !== e.transform) {
      e.el.style.transform = transform;
      e.transform = transform;
    }
  }

  private ensureNote() {
    if (!this.note) {
      const el = document.createElement('div');
      el.className = 'ag-twin-note';
      el.setAttribute('role', 'note');
      el.style.visibility = 'hidden';
      this.root.appendChild(el);
      this.note = { el, text: '', transform: '', opacity: '', hidden: true, size: null };
    }
    return this.note;
  }

  /** O rótulo obrigatório no canto (x, y = canto superior esquerdo), já dentro da área livre. */
  private applyNote(note: TwinScreenPoint | null, alpha: number): void {
    const n = this.note;
    if (!n) return;
    const a = note && note.visible && Number.isFinite(note.x) && Number.isFinite(note.y) ? alpha : 0;
    const hidden = a <= 0.05;
    if (hidden !== n.hidden) {
      n.el.style.visibility = hidden ? 'hidden' : 'visible';
      n.hidden = hidden;
    }
    if (hidden || !note) return;
    const opacity = String(Math.round(a * 1000) / 1000);
    if (opacity !== n.opacity) {
      n.el.style.opacity = opacity;
      n.opacity = opacity;
    }
    const transform = `translate3d(${Math.round(note.x)}px, ${Math.round(note.y)}px, 0)`;
    if (transform !== n.transform) {
      n.el.style.transform = transform;
      n.transform = transform;
    }
  }
}

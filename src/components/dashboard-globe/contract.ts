/**
 * CONTRATO do globo do Dashboard (estilo do protótipo APEX FILM).
 *
 * O globo é o PALCO: fica montado em todos os estados (portfólio, local,
 * Planejar, Supply Chain, Faturamento) e só muda a CÂMERA. Cada troca de
 * `view` vira UM voo contínuo, nunca um corte: distância em espaço
 * logarítmico, curva `cine` (cubic-bezier(0.42, 0, 0.12, 1)), duração
 * clamp(1 + 0.3·|ln(d1/d0)|, 1, 3.2) s, direção pelo arco mais curto, alvo
 * "guiado" na tela nos mergulhos grandes e enquadramento fora do centro
 * (ox/oy em px) para o alvo não ficar sob os painéis.
 *
 * Os painéis ESPERAM a câmera: entram nos últimos 45% do voo (ver `settle`).
 * O estado do voo sai por `useFlight()` (loja externa, sem re-render do globo).
 */

export type GlobeTone = 'healthy' | 'attention' | 'critical' | 'completed' | 'unknown' | 'accent';

/** Uma câmera: alvo no chão + ângulos + distância (km) + deslocamento do alvo na tela (px). */
export interface CameraView {
  lat: number;
  lng: number;
  /** Distância da câmera ao alvo, em km (log-space no voo). */
  dist: number;
  /** Inclinação para baixo, em graus (48–64 no estilo Apex; 89.9 = de cima). */
  pitch: number;
  /** Rumo, em graus. */
  heading: number;
  /** Onde o alvo cai na tela, em px a partir do centro (positivo = direita / baixo). */
  ox: number;
  oy: number;
}

export interface GlobeMarker {
  id: string;
  lat: number;
  lng: number;
  tone: GlobeTone;
  /** Rótulo (DOM, preso ao ponto) — mostrado quando `showLabel` ou em hover/seleção. */
  label: string;
  selected?: boolean;
  /** 0..1 — intensidade do pulso (0 = sem pulso). */
  pulse?: number;
  /** Tamanho do hexágono em px lógicos (44 normal, 54 hover, 58 principal). */
  size?: number;
  showLabel?: boolean;
}

export interface GlobeArc {
  id: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** Altura do arco no meio, em km. */
  h: number;
  tone: GlobeTone;
  /** Traço tracejado [traço, vão] em px; `null` = contínuo. */
  dash?: [number, number] | null;
  /** Velocidade das partículas (0 = sem fluxo). */
  flow?: number;
  width?: number;
  alpha?: number;
}

/** Cartão de dado preso a um ponto do mapa (estilo `wl-node` do filme). */
export interface GlobeNode {
  id: string;
  lat: number;
  lng: number;
  title: string;
  value?: string | null;
  tone?: 'hit' | 'none' | 'default';
}

export interface FlightState {
  /** Há um voo em curso. */
  flying: boolean;
  /** Fração LINEAR do tempo do voo atual, 0..1 (1 = pousou). */
  arrive: number;
  /** Distância atual da câmera, km. */
  dist: number;
  /** Id do voo (muda a cada `view` nova) — para reiniciar entradas de painel. */
  flightId: number;
}

export interface ApexGlobeProps {
  markers: GlobeMarker[];
  arcs?: GlobeArc[];
  nodes?: GlobeNode[];
  /** UFs a realçar (contorno ciano + preenchimento suave). */
  highlightUfs?: string[];
  /** A câmera-alvo. Mudou → voo cinematográfico até ela (a partir da câmera ATUAL, mesmo no meio de outro voo). */
  view: CameraView;
  /** 0..1 — o mundo recua atrás do HUD (brilho/saturação do globo e das camadas). */
  dim?: number;
  /** Abertura do filme na primeira montagem: Terra → Brasil → `view`. */
  intro?: boolean;
  /** "Respiração" do rumo quando perto do chão (< 2 km) e parado. */
  idleBreath?: boolean;
  /** `prefers-reduced-motion`: câmera direta (sem voo), sem pulsos/partículas/respiração. */
  reducedMotion?: boolean;
  /** Tema da interface: o globo é sempre escuro; muda só o sombreamento/vinheta. */
  theme?: 'dark' | 'light';
  onSelectMarker?: (id: string | null) => void;
  onHoverMarker?: (id: string | null) => void;
  onReady?: () => void;
  /** Falha do globo (WebGL, carga do Cesium): a página mostra o HUD sem o palco. */
  onError?: (message: string) => void;
  className?: string;
}

/* ── Página ↔ módulos do local (Planejar, Supply Chain, Faturamento) ────── */

export type ModuleId = 'overview' | 'plan' | 'supply' | 'billing';

/** O que um módulo põe no mapa: arcos, cartões e, se quiser, o enquadramento da câmera. */
export interface MapLayer {
  arcs?: GlobeArc[];
  nodes?: GlobeNode[];
  /** Enquadramento próprio do módulo (ex.: Supply enquadra canteiro + almoxarifados); ausente = preset da vista. */
  view?: CameraView | null;
}

/**
 * Props de TODO módulo. O módulo desenha os PRÓPRIOS painéis (esquerda/direita/
 * inferior) dentro do HUD, lê o próprio endpoint e devolve a camada do mapa.
 * `enter` é o fator de entrada (0..1) já calculado com `settle` pela página:
 * o módulo multiplica a opacidade e o deslocamento (−18 px → 0) por ele.
 */
export interface ModuleProps {
  projectId: string;
  siteName: string;
  /** Hoje em São Paulo (YYYY-MM-DD), o mesmo do overview. */
  today: string;
  enter: number;
  onMapLayer: (layer: MapLayer | null) => void;
  onNavigate: (module: ModuleId) => void;
  /** Abre "Entender" (?x=) para uma referência da fila. */
  onExplain: (ref: string) => void;
  /** Depois de um ato (aprovar compra): a página relê overview + local. */
  onChanged: () => void;
}

/** Entrada de painel no estilo Apex: 0 até 55% do voo, rampa linear até 1 no pouso. */
export function settle(x: number, arrive: number): number {
  const k = Math.min(1, Math.max(0, (arrive - 0.55) / 0.45));
  return x * k;
}

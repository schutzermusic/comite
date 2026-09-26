/**
 * A SPEC DO MODELO ESQUEMÁTICO a partir do dado REAL do local (`SiteHud`).
 *
 * O modelo (twin/layouts.ts) é procedural por tipo de obra; aqui entra só o
 * que é dado: tipo detectado (`project.kind`), fase atual (grupo em foco pelo
 * título + avanço), equipe alocada (ou restrito → sem pontos), falta de
 * material (pátio → Supply Chain), próximo marco e a saúde (tom). Nada é
 * inventado: sem fase não há anel de avanço; sem leitura não há "0".
 *
 * Só com posição de CANTEIRO (`precision: 'site'`) e nas vistas do local
 * (Visão geral, Planejar). Puro — testado em `dashboard-globe-twin.test.ts`.
 */
import type { SiteHud, SiteKind, SitePosition } from '@/lib/dashboard/types';
import type { GlobeTone, TwinHotspot, TwinSpec } from '../contract';
import { toneForLevel, validLatLng, type DashView } from '../presets';
import { buildLayout, layoutKind } from './layouts';

export const TWIN_NOTE = 'Representação esquemática — não é o projeto executivo';

/**
 * Equipe com ZERO alocações: o que o dado diz é "nenhuma alocação registrada"
 * (`project_allocations`), não "ninguém na obra" — um requisito de equipe pode
 * estar marcado atendido no cronograma sem alocação lançada.
 */
export const TEAM_NONE = 'Nenhuma alocação registrada';

/** Vistas em que o modelo aparece. */
export const TWIN_VIEWS: readonly DashView[] = Object.freeze(['overview', 'plan']);

/** Minúsculas, sem acento (para casar palavras-chave do título da fase). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Palavra-chave do título da fase → grupo do layout, por tipo (o primeiro que
 * casar vence). Termos de engenharia em português, sem acento.
 */
const FOCUS_RULES: Record<SiteKind, Array<[RegExp, string]>> = {
  substation: [
    [/\b(transformador(es)?|trafos?|autotransformador(es)?|reator(es)?)\b/, 'transformer'],
    [/\b(casa de comando|sala de comando|casa de controle|comando|protecao|scada|paineis|painel|servicos auxiliares|baterias)\b/, 'control'],
    [/\b(disjuntor(es)?|seccionador(as|es)?|chaves?|para-raios|pararraios|tcs?|tps?|equipamentos?)\b/, 'breakers'],
    [/\b(barramentos?|barras?)\b/, 'buses'],
    [/\b(porticos?|estruturas? metalicas?|montagem eletromecanica|eletromecanica|montagem)\b/, 'gantries'],
    [/\b(canaletas?|cabos?|lancamento|eletrodutos?|malha de terra|aterramento|cabeamento)\b/, 'trench'],
    [/\b(fundac(ao|oes)|bases?|concreto|civil|terraplenagem|drenagem)\b/, 'foundations'],
    [/\b(bays?|vaos?|entradas? de linha|ampliacao)\b/, 'gantries'],
  ],
  transmission: [
    [/\b(lancamento|cabos?|condutor(es)?|para-raios|opgw|tensionamento|flechamento|grampeacao|emendas?)\b/, 'conductors'],
    [/\b(fundac(ao|oes)|estacas?|concreto|escavacao)\b/, 'foundations'],
    [/\b(torres?|montagem|estruturas?|icamento)\b/, 'towers'],
    [/\b(acessos?|faixa de servidao|supressao|limpeza de faixa)\b/, 'access'],
  ],
  solar: [
    [/\b(inversor(es)?|skids?|eletrocentros?|cabines?|subestacao)\b/, 'inverters'],
    [/\b(cabos?|lancamento|valas?|canaletas?|eletrodutos?|strings?)\b/, 'trench'],
    [/\b(modulos?|paineis|painel|placas?|trackers?|mesas?|estruturas?|estacas?|estaqueamento)\b/, 'tables'],
  ],
  hydro: [
    [/\b(ponte rolante|guindastes?|icamento)\b/, 'crane'],
    [/\b(unidades?|ugs?|gerador(es|a)?|estator|rotor|turbinas?|bobinas?|enrolamentos?|montagem)\b/, 'unit'],
    [/\b(casa de forca|civil|concreto|cobertura)\b/, 'powerhouse'],
    [/\b(barragem|vertedouro|tomada d.agua|comportas?)\b/, 'dam'],
  ],
  wind: [
    [/\b(fundac(ao|oes)|concreto|armacao)\b/, 'foundations'],
    [/\b(cabos?|valas?|rede de media)\b/, 'trench'],
    [/\b(aerogerador(es)?|torres?|pas?|naceles?|montagem|icamento)\b/, 'turbines'],
    [/\b(acessos?|plataformas?)\b/, 'access'],
  ],
  generic: [
    [/\b(cabos?|lancamento|eletrodutos?|instalacoes eletricas|canaletas?)\b/, 'trench'],
    [/\b(canteiro|mobilizacao|escritorios?|containers?)\b/, 'offices'],
    [/\b(obra civil|civil|construc\w*|edifica\w*|estruturas?|alvenaria|fundac(ao|oes)|concreto|montagem)\b/, 'building'],
  ],
};

/** O grupo do layout que a fase aponta (palavra-chave do título), ou `null` — nunca um palpite. */
export function focusGroupFor(kind: unknown, title: string | null | undefined): string | null {
  if (typeof title !== 'string' || !title.trim()) return null;
  const k = layoutKind(kind);
  const t = fold(title);
  const groups = buildLayout(k).groups;
  for (const [re, group] of FOCUS_RULES[k]) {
    if (re.test(t) && groups.includes(group)) return group;
  }
  return null;
}

/** "Ampliação" / "novos bays" no nome ou escopo → destacar os elementos novos. */
export function wantsHighlightNew(...texts: Array<string | null | undefined>): boolean {
  return texts.some((s) => typeof s === 'string' && /\b(ampliacao|novo bay|novos bays|nova entrada|novas entradas|expansao)/.test(fold(s)));
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' → 'dd/mm' (ou `null`). */
export function shortDate(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${pad2(Number(m[3]))}/${pad2(Number(m[2]))}` : null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export interface TwinInput {
  projectId: string;
  hud: SiteHud | null;
  position: SitePosition | null;
  view: DashView;
  /** Rumo do eixo longo (preset do local + 90°). */
  azimuthDeg: number;
}

/**
 * A `TwinSpec` do local — ou `null` quando o modelo não se aplica (sem HUD, sem
 * posição de canteiro, fora de Visão geral/Planejar).
 */
export function twinSpecFor({ projectId, hud, position, view, azimuthDeg }: TwinInput): TwinSpec | null {
  if (!hud || !(TWIN_VIEWS as readonly string[]).includes(view)) return null;
  if (!position || position.precision !== 'site' || !validLatLng(position)) return null;
  // o tipo ainda pode não vir do servidor: ausente = genérico (só muda o desenho, nunca um dado)
  const kind = layoutKind(hud.project.kind?.kind);
  const now = hud.now.state === 'ok' ? hud.now.data : null;
  const phase = now?.phase ?? null;
  const tone: GlobeTone = now?.health ? toneForLevel(now.health.level) : 'unknown';
  const progress = phase && typeof phase.percent === 'number' && Number.isFinite(phase.percent)
    ? Math.min(1, Math.max(0, phase.percent / 100))
    : null;
  const team = now?.team ?? null;
  const people = team && team.state === 'ok' && Number.isFinite(team.data.allocated) ? Math.max(0, Math.round(team.data.allocated)) : null;
  const highlightNew = wantsHighlightNew(hud.project.name, hud.project.scope);

  const hotspots: TwinHotspot[] = [];
  if (phase) {
    hotspots.push({
      id: 'workfront', role: 'workfront', label: phase.title || 'Fase atual',
      value: progress !== null ? `${Math.round(progress * 100)}% concluído` : null, tone, target: 'plan',
    });
  }
  if (team) {
    hotspots.push({
      id: 'team', role: 'team', label: 'Equipe',
      // o número vem das ALOCAÇÕES registradas no projeto; um requisito de equipe marcado
      // "atendido" (Planejar) é outro registro — o texto diz a fonte para não parecer contradição
      value: team.state === 'ok'
        ? (people === 0 ? TEAM_NONE : plural(people ?? 0, 'pessoa alocada', 'pessoas alocadas'))
        : team.state === 'restricted' ? 'Restrito' : 'Não foi possível ler',
      tone: team.state === 'ok' ? (people === 0 ? 'attention' : 'healthy') : 'unknown',
      target: null,
    });
  }
  const supply = hud.supply;
  if (supply.state === 'ok') {
    const { total, critical, partial } = supply.data.shortages;
    hotspots.push({
      id: 'laydown', role: 'laydown', label: 'Pátio de materiais',
      value: total > 0
        ? `${plural(total, 'material em falta', 'materiais em falta')}${partial ? ' (leitura parcial)' : ''}`
        : partial ? 'Leitura parcial do estoque' : 'Sem falta de material',
      tone: total > 0 ? (critical > 0 ? 'critical' : 'attention') : partial ? 'unknown' : 'healthy',
      target: 'supply',
    });
  } else {
    hotspots.push({
      id: 'laydown', role: 'laydown', label: 'Pátio de materiais',
      value: supply.state === 'restricted' ? 'Restrito' : 'Não foi possível ler',
      tone: 'unknown', target: supply.state === 'restricted' ? null : 'supply',
    });
  }
  const ms = now?.nextMilestone ?? null;
  if (ms) {
    const when = shortDate(ms.date);
    hotspots.push({
      id: 'milestone', role: 'milestone', label: 'Próximo marco',
      value: [ms.title || 'Marco', when].filter(Boolean).join(' · '), tone: 'accent', target: 'plan',
    });
  }

  return {
    key: `${projectId}|${kind}|${highlightNew ? 'new' : ''}`,
    kind,
    anchor: { lat: position.lat, lng: position.lng },
    azimuthDeg: Number.isFinite(azimuthDeg) ? azimuthDeg : 0,
    focusGroup: focusGroupFor(kind, phase?.title),
    progress,
    people,
    highlightNew,
    tone,
    hotspots,
    label: TWIN_NOTE,
  };
}

/**
 * Estados de localização e de cerca (geofence) do portal de Ponto.
 *
 * O servidor continua sendo a autoridade: `/api/mobile/punch` reavalia a
 * cerca e decide `under_review` (ADR-008). O que existe aqui é a leitura
 * CLIENTE — usada só para explicar ao colaborador, antes de bater o
 * ponto, o que está acontecendo com o GPS e com a área autorizada.
 *
 * Módulo puro: recebe posições e cercas, devolve estado e texto.
 */

import { haversineMeters } from '@/lib/mobile/geo';
import type { GeofenceRecord, GeoPoint } from './attendance-types';

/* ───────────────────── estados de localização ───────────────────── */

export type LocationStatusKind =
  | 'idle'
  | 'requesting'
  | 'loading'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable'
  | 'timeout'
  | 'unsupported';

export interface LocationState {
  kind: LocationStatusKind;
  point: GeoPoint | null;
  /** Momento da leitura (epoch ms) — alimenta o "atualizado às HH:MM". */
  updatedAt: number | null;
  /** Precisão considerada baixa (> 100 m), igual ao critério do servidor. */
  lowAccuracy: boolean;
}

export const INITIAL_LOCATION_STATE: LocationState = {
  kind: 'idle',
  point: null,
  updatedAt: null,
  lowAccuracy: false,
};

/** Acima disso a evidência é gravada como `limited` pelo servidor. */
export const LOW_ACCURACY_THRESHOLD_M = 100;

export interface StatusCopy {
  title: string;
  description: string;
  /** O que o colaborador pode fazer agora. Vazio = nada a fazer. */
  action: string | null;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

/**
 * Traduz o estado técnico em linguagem de campo. Nunca expõe
 * `GeolocationPositionError` — sempre diz o que fazer em seguida.
 */
export function describeLocation(state: LocationState): StatusCopy {
  switch (state.kind) {
    case 'idle':
      return {
        title: 'Localização ainda não confirmada',
        description: 'Vamos confirmar onde você está no momento de registrar o ponto.',
        action: 'Confirmar minha localização',
        tone: 'neutral',
      };
    case 'requesting':
      return {
        title: 'Aguardando sua permissão',
        description: 'Toque em "Permitir" na janela do navegador para confirmar a área de trabalho.',
        action: null,
        tone: 'neutral',
      };
    case 'loading':
      return {
        title: 'Procurando o sinal de GPS',
        description: 'Isso leva alguns segundos. Se estiver em local coberto, chegue perto de uma janela.',
        action: null,
        tone: 'neutral',
      };
    case 'granted':
      return state.lowAccuracy
        ? {
            title: 'Localização com pouca precisão',
            description: `O sinal está impreciso (cerca de ${Math.round(state.point?.accuracy ?? 0)} m). O registro pode ir para análise.`,
            action: 'Atualizar localização',
            tone: 'warning',
          }
        : {
            title: 'Localização confirmada',
            description: 'Seu ponto será registrado com a posição atual.',
            action: null,
            tone: 'success',
          };
    case 'denied':
      return {
        title: 'Localização não autorizada',
        description: 'Sem a localização não é possível confirmar que você está na área de trabalho.',
        action: 'Permitir localização e tentar de novo',
        tone: 'danger',
      };
    case 'blocked':
      return {
        title: 'Localização bloqueada no navegador',
        description:
          'O acesso à localização foi bloqueado para este site. Abra as configurações do navegador, autorize a localização e recarregue a página.',
        action: 'Já autorizei — tentar de novo',
        tone: 'danger',
      };
    case 'unavailable':
      return {
        title: 'Não foi possível obter a localização',
        description: 'Ative o GPS do aparelho e verifique se o modo economia de bateria não está desligando a localização.',
        action: 'Tentar de novo',
        tone: 'danger',
      };
    case 'timeout':
      return {
        title: 'O GPS demorou a responder',
        description: 'Vá para um ponto mais aberto e tente novamente. Você ainda consegue registrar, mas o ponto irá para análise.',
        action: 'Tentar de novo',
        tone: 'warning',
      };
    case 'unsupported':
      return {
        title: 'Este navegador não informa a localização',
        description: 'Use o Chrome ou o Safari atualizados. O registro segue possível, porém será analisado pelo gestor.',
        action: null,
        tone: 'warning',
      };
  }
}

/** Converte o erro nativo em um estado nosso, sem vazar código técnico. */
export function mapGeolocationError(error: { code?: number } | null | undefined): LocationStatusKind {
  switch (error?.code) {
    case 1:
      return 'denied';
    case 2:
      return 'unavailable';
    case 3:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

/* ───────────────────── estados de cerca ───────────────────── */

export type GeofenceStatusKind =
  | 'unknown'
  | 'no_worksite'
  | 'no_location'
  | 'inside'
  | 'outside';

export interface GeofenceState {
  kind: GeofenceStatusKind;
  geofenceName: string | null;
  projectId: string | null;
  distanceMeters: number | null;
  radiusMeters: number | null;
}

export const INITIAL_GEOFENCE_STATE: GeofenceState = {
  kind: 'unknown',
  geofenceName: null,
  projectId: null,
  distanceMeters: null,
  radiusMeters: null,
};

/**
 * Pré-avaliação cliente da cerca mais próxima. Usa a mesma haversine e a
 * mesma tolerância do servidor (`evaluateGeofence`), mas o veredito que
 * vale é sempre o da API.
 */
export function evaluateGeofenceClient(
  point: GeoPoint | null,
  geofences: readonly GeofenceRecord[],
): GeofenceState {
  const usable = geofences.filter(
    (g) => typeof g.center_lat === 'number' && typeof g.center_lng === 'number' && typeof g.radius_meters === 'number',
  );
  if (usable.length === 0) return { ...INITIAL_GEOFENCE_STATE, kind: 'no_worksite' };
  if (!point) return { ...INITIAL_GEOFENCE_STATE, kind: 'no_location' };

  let nearest: GeofenceRecord | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const fence of usable) {
    const distance = haversineMeters(point.lat, point.lng, fence.center_lat as number, fence.center_lng as number);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = fence;
    }
  }
  if (!nearest) return { ...INITIAL_GEOFENCE_STATE, kind: 'no_worksite' };

  const radius = nearest.radius_meters as number;
  const tolerance = (nearest.accuracy_tolerance_meters ?? 0) + (point.accuracy ?? 0);
  const inside = nearestDistance <= radius + tolerance;

  return {
    kind: inside ? 'inside' : 'outside',
    geofenceName: nearest.name,
    projectId: nearest.project_id,
    distanceMeters: Math.round(nearestDistance),
    radiusMeters: radius,
  };
}

export function describeGeofence(state: GeofenceState): StatusCopy {
  switch (state.kind) {
    case 'inside':
      return {
        title: 'Dentro da área autorizada',
        description: state.geofenceName ? `Você está em ${state.geofenceName}.` : 'Você está no local de trabalho cadastrado.',
        action: null,
        tone: 'success',
      };
    case 'outside':
      return {
        title: 'Fora da área autorizada',
        description:
          state.distanceMeters != null
            ? `Você está a ${formatDistance(state.distanceMeters)} de ${state.geofenceName ?? 'área autorizada'}. Dá para registrar, mas o ponto vai para análise do gestor.`
            : 'Você parece estar fora do local cadastrado. Dá para registrar, mas o ponto vai para análise do gestor.',
        action: null,
        tone: 'warning',
      };
    case 'no_worksite':
      return {
        title: 'Nenhum local de trabalho cadastrado',
        description: 'Sua marcação registra a jornada normalmente. Peça ao gestor para cadastrar a obra se precisar validar a área.',
        action: null,
        tone: 'neutral',
      };
    case 'no_location':
      return {
        title: 'Área não verificada',
        description: 'Confirme sua localização para sabermos se você está no local de trabalho.',
        action: null,
        tone: 'neutral',
      };
    case 'unknown':
      return {
        title: 'Área ainda não verificada',
        description: 'A verificação acontece no momento do registro.',
        action: null,
        tone: 'neutral',
      };
  }
}

/** "32 m" / "1,2 km" — sem casas decimais desnecessárias. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatAccuracy(accuracy: number | undefined | null): string {
  if (accuracy == null || !Number.isFinite(accuracy)) return '—';
  return `± ${Math.round(accuracy)} m`;
}

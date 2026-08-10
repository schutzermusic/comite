import { describe, expect, it } from 'vitest';
import {
  INITIAL_LOCATION_STATE,
  describeGeofence,
  describeLocation,
  evaluateGeofenceClient,
  formatDistance,
  mapGeolocationError,
  type LocationState,
  type LocationStatusKind,
} from '@/lib/ponto/geolocation';
import { evaluateGeofence } from '@/lib/mobile/geo';
import type { GeofenceRecord } from '@/lib/ponto/attendance-types';

const SITE: GeofenceRecord = {
  id: 'gf-1',
  project_id: 'PRJ-1',
  name: 'Subestação Londrina',
  center_lat: -23.31,
  center_lng: -51.16,
  radius_meters: 150,
  accuracy_tolerance_meters: 30,
};

function state(kind: LocationStatusKind, overrides: Partial<LocationState> = {}): LocationState {
  return { ...INITIAL_LOCATION_STATE, kind, ...overrides };
}

describe('mensagens de localização (§6)', () => {
  const kinds: LocationStatusKind[] = [
    'idle',
    'requesting',
    'loading',
    'granted',
    'denied',
    'blocked',
    'unavailable',
    'timeout',
    'unsupported',
  ];

  it('cobre todos os estados sem vazar erro técnico', () => {
    for (const kind of kinds) {
      const copy = describeLocation(state(kind));
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.title).not.toMatch(/GeolocationPositionError|code \d/i);
      expect(copy.description).not.toMatch(/GeolocationPositionError|code \d/i);
    }
  });

  it('dá instrução de recuperação quando o acesso está bloqueado (Fluxo 4)', () => {
    const copy = describeLocation(state('blocked'));
    expect(copy.tone).toBe('danger');
    expect(copy.description).toMatch(/configurações do navegador/i);
    expect(copy.action).toBeTruthy();
  });

  it('avisa sobre baixa precisão sem impedir o registro', () => {
    const copy = describeLocation(
      state('granted', { point: { lat: 0, lng: 0, accuracy: 180 }, lowAccuracy: true }),
    );
    expect(copy.tone).toBe('warning');
    expect(copy.description).toMatch(/180 m/);
  });

  it('confirma em tom positivo quando a precisão é boa', () => {
    const copy = describeLocation(state('granted', { point: { lat: 0, lng: 0, accuracy: 12 } }));
    expect(copy.tone).toBe('success');
    expect(copy.title).toBe('Localização confirmada');
  });

  it('traduz os códigos nativos sem expor o número', () => {
    expect(mapGeolocationError({ code: 1 })).toBe('denied');
    expect(mapGeolocationError({ code: 2 })).toBe('unavailable');
    expect(mapGeolocationError({ code: 3 })).toBe('timeout');
    expect(mapGeolocationError(null)).toBe('unavailable');
  });
});

describe('cerca do local de trabalho', () => {
  it('reconhece a posição dentro da área', () => {
    const result = evaluateGeofenceClient({ lat: SITE.center_lat as number, lng: SITE.center_lng as number, accuracy: 10 }, [SITE]);
    expect(result.kind).toBe('inside');
    expect(result.geofenceName).toBe('Subestação Londrina');
    expect(describeGeofence(result).tone).toBe('success');
  });

  it('reconhece a posição fora e informa a distância (Fluxo 3)', () => {
    // ~1 km ao norte do centro da cerca.
    const result = evaluateGeofenceClient(
      { lat: (SITE.center_lat as number) + 0.009, lng: SITE.center_lng as number, accuracy: 10 },
      [SITE],
    );
    expect(result.kind).toBe('outside');
    expect(result.distanceMeters).toBeGreaterThan(900);
    const copy = describeGeofence(result);
    expect(copy.tone).toBe('warning');
    expect(copy.description).toMatch(/análise do gestor/i);
  });

  it('usa o mesmo veredito do servidor para o mesmo ponto', () => {
    const point = { lat: (SITE.center_lat as number) + 0.0012, lng: SITE.center_lng as number, accuracy: 25 };
    const client = evaluateGeofenceClient(point, [SITE]);
    const server = evaluateGeofence(point.lat, point.lng, point.accuracy, [
      {
        id: SITE.id,
        project_id: SITE.project_id,
        name: SITE.name,
        center_lat: SITE.center_lat as number,
        center_lng: SITE.center_lng as number,
        radius_meters: SITE.radius_meters as number,
        accuracy_tolerance_meters: SITE.accuracy_tolerance_meters as number,
      },
    ]);
    expect(client.kind === 'inside').toBe(server.inside);
    expect(client.distanceMeters).toBe(server.distanceMeters);
  });

  it('explica quando não há local cadastrado, sem bloquear a jornada', () => {
    const result = evaluateGeofenceClient({ lat: 0, lng: 0 }, []);
    expect(result.kind).toBe('no_worksite');
    const copy = describeGeofence(result);
    expect(copy.tone).toBe('neutral');
    expect(copy.description).toMatch(/registra a jornada normalmente/i);
  });

  it('não avalia sem posição', () => {
    expect(evaluateGeofenceClient(null, [SITE]).kind).toBe('no_location');
  });

  it('ignora cercas sem centro ou raio', () => {
    const incomplete: GeofenceRecord = { id: 'gf-2', project_id: 'PRJ-2', name: 'Sem coordenadas' };
    expect(evaluateGeofenceClient({ lat: 0, lng: 0 }, [incomplete]).kind).toBe('no_worksite');
  });

  it('formata distância em metros e quilômetros', () => {
    expect(formatDistance(32)).toBe('32 m');
    expect(formatDistance(1250)).toBe('1,3 km');
  });
});

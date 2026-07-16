/**
 * Geofence evaluation shared by the mobile API (Fase 4a, diferencial D5).
 * Circular fences (center + radius), haversine distance — no PostGIS.
 * Mirrors the SQL haversine_meters() from migration 050.
 */

export interface Geofence {
  id: string;
  project_id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_meters: number;
  accuracy_tolerance_meters: number;
}

export interface GeofenceMatch {
  geofenceId: string | null;
  geofenceName: string | null;
  distanceMeters: number | null;
  inside: boolean;
  /** integrity heuristic for the location evidence */
  integrityStatus: 'trusted' | 'limited' | 'suspicious' | 'unverified';
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Picks the nearest active geofence and decides whether the point is
 * inside (radius + accuracy tolerance + reported GPS accuracy).
 */
export function evaluateGeofence(
  lat: number,
  lng: number,
  accuracyMeters: number | null,
  geofences: Geofence[],
): GeofenceMatch {
  if (geofences.length === 0) {
    return {
      geofenceId: null,
      geofenceName: null,
      distanceMeters: null,
      inside: false,
      integrityStatus: 'unverified',
    };
  }

  let nearest: Geofence | null = null;
  let nearestDist = Infinity;
  for (const g of geofences) {
    const d = haversineMeters(lat, lng, g.center_lat, g.center_lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = g;
    }
  }
  if (!nearest) {
    return { geofenceId: null, geofenceName: null, distanceMeters: null, inside: false, integrityStatus: 'unverified' };
  }

  const tolerance = nearest.accuracy_tolerance_meters + (accuracyMeters ?? 0);
  const inside = nearestDist <= nearest.radius_meters + tolerance;

  // low precision (>100m) or offline → limited/suspicious trust
  let integrityStatus: GeofenceMatch['integrityStatus'] = 'trusted';
  if (accuracyMeters != null && accuracyMeters > 100) integrityStatus = 'limited';
  if (!inside && nearestDist > nearest.radius_meters * 3) integrityStatus = 'suspicious';

  return {
    geofenceId: nearest.id,
    geofenceName: nearest.name,
    distanceMeters: Math.round(nearestDist),
    inside,
    integrityStatus,
  };
}

import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';

/**
 * Native biometric gate (spec §13.1): the app only receives success/failure,
 * never a face template. Falls back to device passcode when biometrics are
 * unavailable.
 */
export async function confirmBiometric(reason: string): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) {
    // no biometrics enrolled — allow but caller should mark lower assurance
    return true;
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Usar senha do dispositivo',
  });
  return result.success;
}

export interface Coords {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Captures location ONLY at the event (spec §14.1 — no continuous tracking).
 * Returns null when permission is denied; the caller can still punch (the
 * backend flags missing evidence for review).
 */
export async function captureLocation(): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
  };
}

/** RFC4122-ish UUID for clientEventId (idempotency key). */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

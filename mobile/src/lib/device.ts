import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { mobileApi } from '../api/mobileApi';
import { uuid } from './capture';

/**
 * Device binding (spec §20.6). Um identificador estável por instalação é
 * gerado e persistido; o enroll registra o dispositivo no backend
 * (idempotente por device_public_id) e devolve o id interno usado nas
 * marcações. O enroll roda uma vez após o login.
 */
const PUBLIC_ID_KEY = 'insight.device.public_id.v1';
const INTERNAL_ID_KEY = 'insight.device.internal_id.v1';

export async function getDevicePublicId(): Promise<string> {
  let id = await AsyncStorage.getItem(PUBLIC_ID_KEY);
  if (!id) {
    id = uuid();
    await AsyncStorage.setItem(PUBLIC_ID_KEY, id);
  }
  return id;
}

export async function getEnrolledDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(INTERNAL_ID_KEY);
}

/** Registra/atualiza o dispositivo no backend e cacheia o id interno. */
export async function ensureDeviceEnrolled(deviceName?: string): Promise<string | null> {
  try {
    const devicePublicId = await getDevicePublicId();
    const res = await mobileApi.enroll({
      devicePublicId,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: deviceName ?? `${Platform.OS} device`,
    });
    await AsyncStorage.setItem(INTERNAL_ID_KEY, res.device.id);
    return res.device.id;
  } catch {
    // offline no primeiro login: usa o id cacheado (se houver) e tenta depois
    return getEnrolledDeviceId();
  }
}

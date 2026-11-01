/**
 * The phone's sign-in. The token the server hands out is kept in the
 * Android keystore (SecureStore) and only ever leaves it in the
 * Authorization header. The app asks for the fingerprint (or the phone's
 * screen lock) before it will use the token: the server trusts a signed-in
 * phone for sensitive changes, so the phone must be sure it's the owner.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { appLogin, appLogout } from './api';

const TOKEN_KEY = 'rk.owner.token';

let cached: string | null = null;

export async function loadToken(): Promise<string | null> {
  cached = await SecureStore.getItemAsync(TOKEN_KEY);
  return cached;
}

export const currentToken = async () => cached;

export async function signIn(password: string): Promise<void> {
  const model = (Platform.constants as { Model?: string }).Model ?? 'Android phone';
  const { token } = await appLogin({ password, deviceName: model, platform: 'android' });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  cached = token;
}

/** Forgets the token here; tells the server too when it can. */
export async function signOut(): Promise<void> {
  try {
    if (cached) await appLogout();
  } catch {
    /* already signed out on the server, or offline: forget it locally anyway */
  }
  await forgetToken();
}

export async function forgetToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Fingerprint, face or the phone's own PIN. A phone with no screen lock at
 * all is let through: there is nothing to ask for, and refusing would lock
 * the owner out of their own app.
 */
export async function unlock(reason: string): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (!hasHardware && level === LocalAuthentication.SecurityLevel.NONE) return true;
  if (level === LocalAuthentication.SecurityLevel.NONE) return true;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel' });
  return result.success;
}

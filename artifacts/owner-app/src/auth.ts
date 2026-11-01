/**
 * The phone's sign-in. The token the server hands out is kept in the
 * Android keystore (SecureStore) and only ever leaves it in the
 * Authorization header. The app asks for the fingerprint (or the phone's
 * screen lock) before it will use the token: the server trusts a signed-in
 * phone for sensitive changes, so the phone must be sure it's the owner.
 *
 * Password once, fingerprint after that. The token stays on the phone until
 * one of three things happens, and nothing else removes it:
 *  - you press Sign out in Settings;
 *  - the server confirms this phone was signed out (from Settings on another
 *    phone or the web console, or 90 days unused);
 *  - the app is uninstalled. Android deletes the keystore with the app, and
 *    app.json turns Android backup off, so a reinstall starts signed out and
 *    nothing old is restored.
 * A server that is restarting, a weak signal or a 5xx never signs you out.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { appLogin, appLogout, getSession } from './api';

const TOKEN_KEY = 'rk.owner.token';

let cached: string | null = null;

export async function loadToken(): Promise<string | null> {
  // The keystore can be slow to answer right after the phone boots: try twice.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      cached = await SecureStore.getItemAsync(TOKEN_KEY);
      return cached;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  cached = null;
  return null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A request came back 401. Before forgetting the token, ask the server
 * directly whether this phone is still signed in. Only a clear "no" counts:
 * an error, a timeout or a 503 (the server could not check) keeps the token.
 */
export async function confirmSignedOut(): Promise<boolean> {
  if (!cached) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await wait(attempt === 0 ? 1200 : 4000);
    try {
      const session = await getSession();
      if (session.signedIn) return false;
      if (session.configured) return true;
      return false;
    } catch {
      /* offline or the server is busy: try once more, then keep the token */
    }
  }
  return false;
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
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel' });
    return result.success;
  } catch {
    // Never fall back to the password: stay locked and let "Unlock" try again.
    return false;
  }
}

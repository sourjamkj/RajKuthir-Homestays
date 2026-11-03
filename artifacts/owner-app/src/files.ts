/**
 * Files the console serves only to a signed-in owner: invoices, booking
 * confirmations, OTA vouchers and guest ID documents. The web console opens
 * them with its session cookie; the app downloads them with its token into
 * the app's private cache and hands them to Android's share sheet, from
 * where they open in a PDF/image viewer or go straight into a WhatsApp chat.
 * Nothing is saved to the phone's shared storage.
 */
import { cacheDirectory, deleteAsync, downloadAsync } from 'expo-file-system/legacy';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

import { SITE } from './api';
import { currentToken } from './auth';

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '-').slice(0, 120) || 'file';
}

export async function shareAdminFile(path: string, filename: string, mimeType = 'application/pdf'): Promise<void> {
  const token = await currentToken();
  if (!token) throw new Error('Signed out. Sign in again to open this file.');
  if (!cacheDirectory) throw new Error('This phone has no space to open the file.');
  if (!(await isAvailableAsync())) throw new Error('Sharing is not available on this phone.');

  const target = `${cacheDirectory}${Date.now()}-${safeName(filename)}`;
  const result = await downloadAsync(`${SITE}${path}`, target, { headers: { Authorization: `Bearer ${token}` } });
  if (result.status !== 200) {
    await deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw new Error(result.status === 404 ? 'That file is no longer there.' : `Could not open the file (${result.status}).`);
  }
  await shareAsync(result.uri, { mimeType: result.headers['content-type'] ?? result.headers['Content-Type'] ?? mimeType, dialogTitle: filename });
}

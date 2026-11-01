import { logger } from "./logger";
import { EXPO_PUSH_URL, chunk, deadTokens, expoMessages, type OwnerPush } from "./expo-push-rules";

/**
 * Sends one alert to every signed-in phone. Never throws: an alert that fails
 * to push is still in the app's alert list and, where it applies, in email.
 *
 * EXPO_ACCESS_TOKEN (optional, Railway) is only needed if "enhanced push
 * security" is switched on for the project at expo.dev.
 */
export async function pushToPhones(tokens: string[], push: OwnerPush, quiet: boolean): Promise<{ sent: number; dead: string[] }> {
  if (tokens.length === 0) return { sent: 0, dead: [] };
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const accessToken = process.env["EXPO_ACCESS_TOKEN"]?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let sent = 0;
  const dead: string[] = [];
  for (const batch of chunk(expoMessages(tokens, push, quiet))) {
    try {
      const response = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(batch), signal: AbortSignal.timeout(10_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        logger.warn({ status: response.status }, "Expo push refused the batch");
        continue;
      }
      dead.push(...deadTokens(batch, body));
      sent += batch.length;
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : error }, "Expo push failed");
    }
  }
  return { sent, dead };
}

/**
 * Push notifications to the owner's phone through Expo's push service.
 * Pure: building the messages and reading Expo's answer. expo-push.ts sends.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts up to 100 messages per request. */
export const EXPO_BATCH = 100;

export type OwnerPush = {
  title: string;
  body: string;
  /** Where the app opens when the alert is tapped. */
  data: { alertId: string; event: string; href: string };
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: OwnerPush["data"];
  sound: "default" | null;
  priority: "high" | "normal";
  channelId: string;
};

/** In quiet hours the alert still arrives, just without sound, on Android's quiet channel. */
export function expoMessages(tokens: string[], push: OwnerPush, quiet: boolean): ExpoMessage[] {
  const title = push.title.slice(0, 120);
  const body = push.body.length > 240 ? `${push.body.slice(0, 237)}…` : push.body;
  return tokens.map((to) => ({
    to,
    title,
    body,
    data: push.data,
    sound: quiet ? null : "default",
    priority: quiet ? "normal" : "high",
    channelId: quiet ? "quiet" : "alerts",
  }));
}

export function chunk<T>(items: T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Ticket = { status?: string; details?: { error?: string } };

/**
 * Tokens Expo says are dead (the app was uninstalled or its token replaced).
 * Their phones should stop being sent to; any other error is left for the next try.
 */
export function deadTokens(sent: ExpoMessage[], response: unknown): string[] {
  const tickets = (response as { data?: unknown })?.data;
  if (!Array.isArray(tickets)) return [];
  const dead: string[] = [];
  tickets.forEach((ticket: Ticket, i) => {
    if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered" && sent[i]) dead.push(sent[i]!.to);
  });
  return dead;
}

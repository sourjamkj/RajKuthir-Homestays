/**
 * Phone alerts. The server pushes through Expo's push service to the token
 * this phone registers (PUT /api/admin/app/push-token). Two Android channels:
 * "alerts" rings; "quiet" (used during quiet hours) arrives silently. The
 * server picks the channel per message.
 *
 * Getting an Expo push token on Android needs the app's Firebase file
 * (google-services.json) and its Expo project id, both added at build time.
 * Until then registerForPush() says why it can't, and the alert list in the
 * app still works: it reads the same alerts from the server.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { setPushToken } from './api';

export type PushStatus = {
  permission: 'granted' | 'denied' | 'undetermined';
  registered: boolean;
  problem: string | null;
};

let status: PushStatus = { permission: 'undetermined', registered: false, problem: null };
export const pushStatus = () => status;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function setupChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Alerts',
    description: 'Payments, bookings, cancellations and anything that needs you.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
  });
  await Notifications.setNotificationChannelAsync('quiet', {
    name: 'Quiet hours',
    description: 'The same alerts during your quiet hours, without sound.',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
  });
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/** Asks for permission (once), gets the token and tells the server. Never throws. */
export async function registerForPush(ask = true): Promise<PushStatus> {
  try {
    await setupChannels();
    let { status: permission } = await Notifications.getPermissionsAsync();
    if (permission !== 'granted' && ask) ({ status: permission } = await Notifications.requestPermissionsAsync());
    status = { permission, registered: false, problem: null };
    if (permission !== 'granted') {
      status.problem = 'Notifications are turned off for this app in Android settings.';
      return status;
    }
    const id = projectId();
    if (!id) {
      status.problem = 'Push is not set up in this build yet (needs the Firebase file and Expo project id).';
      return status;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await setPushToken(token);
    status = { permission, registered: true, problem: null };
  } catch (e) {
    status = { ...status, registered: false, problem: e instanceof Error ? e.message : 'Could not register for alerts.' };
  }
  return status;
}

/** Before signing out: stop alerts to this phone. Never throws. */
export async function unregisterPush(): Promise<void> {
  try {
    await setPushToken(null);
  } catch {
    /* signed out already, or offline: the server drops dead tokens itself */
  }
  status = { ...status, registered: false };
}

/** Where a tapped alert should land, from its console path. */
export type GuestsSection = 'enquiries' | 'stays' | 'contacts';

export type Destination =
  | { tab: 'today' | 'calendar' | 'caretaker' }
  | { tab: 'guests'; section: GuestsSection; focus: string | null }
  | { screen: 'messages' }
  | { web: string };

/** The same places the web console's links land: Guests opens on the exact enquiry or stay. */
export function destinationFor(href: string | undefined | null): Destination {
  const h = href ?? '/admin';
  if (/^\/admin\/guests#payments?(-|$)/.test(h)) return { tab: 'today' };
  const enquiry = /^\/admin\/guests#enquiry-(.+)$/.exec(h);
  if (enquiry) return { tab: 'guests', section: 'enquiries', focus: enquiry[1]! };
  const stay = /^\/admin\/guests#stay-(.+)$/.exec(h);
  if (stay) return { tab: 'guests', section: 'stays', focus: stay[1]! };
  if (h.startsWith('/admin/guests#stays')) return { tab: 'guests', section: 'stays', focus: null };
  if (h.startsWith('/admin/guests#messages')) return { screen: 'messages' };
  if (h === '/admin/guests' || h.startsWith('/admin/guests#')) return { tab: 'guests', section: 'enquiries', focus: null };
  if (h.startsWith('/admin/caretaker')) return { tab: 'caretaker' };
  if (h.startsWith('/admin/reviews')) return { web: h };
  return { tab: 'calendar' };
}

import { eq } from "drizzle-orm";
import { db, appSettings, GUEST_INFO_KEY } from "@workspace/db";

/**
 * The arrival pack a guest sees on /welcome.
 *
 * Everything here is owner-edited from the admin console and stored as one
 * JSON document in app_settings. Nothing in this file may ever be served on a
 * public route: `getGuestInfo` is only called after a booking reference has
 * been matched to a stay that has not ended.
 */

export type GuestContact = {
  /** What this person does — "Caretaker", "Plumber", "Toto / local transport". */
  label: string;
  name: string;
  phone: string;
};

export type GuestInfo = {
  wifiSsid: string;
  wifiPassword: string;
  /** Free text: directions, landmarks, gate, parking, check-in notes. */
  arrival: string;
  contacts: GuestContact[];
};

export const EMPTY_GUEST_INFO: GuestInfo = {
  wifiSsid: "",
  wifiPassword: "",
  arrival: "",
  contacts: [],
};

const MAX_CONTACTS = 12;
const MAX_TEXT = 4000;

function str(value: unknown, limit = 200): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * Coerces whatever is in the database — or whatever the admin form posted —
 * into a valid GuestInfo. Bad entries are dropped rather than rejected: a
 * half-filled contact should not stop the owner saving a new Wi-Fi password.
 */
export function parseGuestInfo(raw: unknown): GuestInfo {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const contactsRaw = Array.isArray(source.contacts) ? source.contacts : [];
  const contacts: GuestContact[] = [];

  for (const entry of contactsRaw.slice(0, MAX_CONTACTS)) {
    const item =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};

    const contact: GuestContact = {
      label: str(item.label, 60),
      name: str(item.name, 80),
      phone: str(item.phone, 40),
    };

    // A contact with no number is not a contact.
    if (contact.phone) contacts.push(contact);
  }

  return {
    wifiSsid: str(source.wifiSsid, 120),
    wifiPassword: str(source.wifiPassword, 120),
    arrival: str(source.arrival, MAX_TEXT),
    contacts,
  };
}

export async function getGuestInfo(): Promise<GuestInfo> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, GUEST_INFO_KEY));

  if (!row?.value) return { ...EMPTY_GUEST_INFO };

  try {
    return parseGuestInfo(JSON.parse(row.value));
  } catch {
    // A corrupt blob should degrade to an empty pack, not take the route down.
    return { ...EMPTY_GUEST_INFO };
  }
}

export async function setGuestInfo(raw: unknown): Promise<GuestInfo> {
  const info = parseGuestInfo(raw);

  await db
    .insert(appSettings)
    .values({
      key: GUEST_INFO_KEY,
      value: JSON.stringify(info),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(info), updatedAt: new Date() },
    });

  return info;
}

/** True when there is enough here to be worth showing a guest. */
export function hasGuestInfo(info: GuestInfo): boolean {
  return Boolean(
    info.wifiSsid || info.wifiPassword || info.arrival || info.contacts.length,
  );
}

import { eq } from "drizzle-orm";
import { appSettings, db } from "@workspace/db";

import { logger } from "./logger";
import { OWNER_SETTINGS_KEY, parseStoredSettings, type StoredOwnerSettings } from "./owner-settings-rules";
import { setOwnerSettingsState, storedOwnerSettings } from "./owner-settings-state";

/**
 * Loads and saves the owner's settings. The values live in memory
 * (owner-settings-state.ts) so the many places that read them stay
 * synchronous: loaded at boot, after every save, and once a minute (so a
 * second instance would pick a change up too). A failed load keeps the last
 * good copy, or, before the first one, the Railway values.
 */
let refreshTimer: NodeJS.Timeout | null = null;

export { storedOwnerSettings };

export async function loadOwnerSettings(): Promise<StoredOwnerSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, OWNER_SETTINGS_KEY));
    setOwnerSettingsState(parseStoredSettings(row?.value));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, "Could not load owner settings; using Railway values");
  }
  return storedOwnerSettings();
}

export async function saveOwnerSettings(next: StoredOwnerSettings): Promise<void> {
  const value = JSON.stringify(next);
  await db
    .insert(appSettings)
    .values({ key: OWNER_SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  setOwnerSettingsState(parseStoredSettings(value));
}

export function startOwnerSettingsRefresh(): void {
  void loadOwnerSettings();
  if (refreshTimer) return;
  refreshTimer = setInterval(() => void loadOwnerSettings(), 60_000);
  refreshTimer.unref();
}

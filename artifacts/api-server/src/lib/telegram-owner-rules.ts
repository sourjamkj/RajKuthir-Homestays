/**
 * The owner notification bot is allowed to send only to one positive,
 * numeric Telegram user ID, and only when that ID is in Ryan's allow-list.
 * Reject groups/channels: this path is owner-only, never caretaker-facing.
 */
export function isAllowedOwnerTelegramTarget(homeChannel: string | undefined, allowedUsers: string | undefined): boolean {
  const target = homeChannel?.trim() ?? "";
  if (!/^\d+$/.test(target) || target === "0") return false;
  const allowed = new Set(
    (allowedUsers ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value)),
  );
  return allowed.has(target);
}

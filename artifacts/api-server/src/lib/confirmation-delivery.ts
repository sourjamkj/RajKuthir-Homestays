/**
 * Getting the booking confirmation PDF to the guest on EVERY channel we
 * have, not the first one that works. Pure: the senders are passed in, so
 * confirmation-delivery.test.ts can prove that one channel failing never
 * stops the other.
 */

export type ChannelStatus = "sent" | "skipped" | "failed";

export type ConfirmationDelivery = {
  email: ChannelStatus;
  whatsapp: ChannelStatus;
  emailTo: string | null;
  whatsappTo: string | null;
  notes: string[];
};

export type DeliveryDeps = {
  /** Resolves true when the email (with the PDF attached) went. */
  sendEmail: (to: string) => Promise<boolean>;
  /** null when WhatsApp sending is not set up at all. */
  whatsapp: null | {
    to: string | null;
    send: (to: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function deliverOnChannels(email: string | null, deps: DeliveryDeps): Promise<ConfirmationDelivery> {
  const out: ConfirmationDelivery = { email: "skipped", whatsapp: "skipped", emailTo: null, whatsappTo: null, notes: [] };

  const address = email?.trim() || null;
  if (!address || !EMAIL.test(address)) {
    out.notes.push("email skipped (no address)");
  } else {
    out.emailTo = address;
    try {
      out.email = (await deps.sendEmail(address)) ? "sent" : "failed";
      if (out.email === "failed") out.notes.push("email failed (is a mailbox connected?)");
    } catch {
      out.email = "failed";
      out.notes.push("email failed");
    }
  }

  if (!deps.whatsapp) {
    out.notes.push("whatsapp skipped (WhatsApp sending or WHATSAPP_CONFIRMATION_TEMPLATE not set up)");
  } else if (!deps.whatsapp.to) {
    out.notes.push("whatsapp skipped (no valid number)");
  } else {
    out.whatsappTo = deps.whatsapp.to;
    try {
      const sent = await deps.whatsapp.send(deps.whatsapp.to);
      out.whatsapp = sent.ok ? "sent" : "failed";
      if (!sent.ok) out.notes.push(`whatsapp failed (${sent.error})`);
    } catch (error) {
      out.whatsapp = "failed";
      out.notes.push(`whatsapp failed (${error instanceof Error ? error.message : "error"})`);
    }
  }

  return out;
}

export function delivered(result: Pick<ConfirmationDelivery, "email" | "whatsapp">): boolean {
  return result.email === "sent" || result.whatsapp === "sent";
}

/** One line for the payment events log and the owner's alert. */
export function deliverySummary(result: ConfirmationDelivery): string {
  const part = (channel: string, status: ChannelStatus, to: string | null) =>
    status === "sent" ? `${channel} sent${to ? ` to ${to}` : ""}` : null;
  const sent = [part("email", result.email, result.emailTo), part("whatsapp", result.whatsapp, result.whatsappTo)].filter(Boolean);
  const problems = result.notes.filter((note) => !note.startsWith("email sent") && !note.startsWith("whatsapp sent"));
  return [sent.length ? sent.join(", ") : "not delivered", ...problems].join("; ");
}

/** Retry only what failed, a couple of times, soon after the booking. */
export const MAX_DELIVERY_ATTEMPTS = 3;
export const RETRY_WINDOW_MS = 30 * 60_000;
export const RETRY_GAP_MS = 5 * 60_000;

export function dueForRetry(
  row: { emailStatus: string; whatsappStatus: string; attempts: number; createdAt: Date; updatedAt: Date },
  now: Date,
): boolean {
  if (row.emailStatus === "sent" || row.whatsappStatus === "sent") return false;
  if (row.emailStatus !== "failed" && row.whatsappStatus !== "failed") return false; // nothing to retry: all skipped
  if (row.attempts >= MAX_DELIVERY_ATTEMPTS) return false;
  if (now.getTime() - row.createdAt.getTime() > RETRY_WINDOW_MS) return false;
  return now.getTime() - row.updatedAt.getTime() >= RETRY_GAP_MS;
}

/* --------------------------- the PDF's payment line --------------------------- */

function istDateTime(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(at);
}

/**
 * How the advance reached us, for the confirmation PDF:
 *   "Paid online 31 Oct 2026, 1:42 am · UPI · Cashfree payment ID 5114917039"
 *   "Paid by UPI · UTR 412345678901"
 * null when we have nothing more to say than "Advance received".
 */
export function advanceReceiptLine(source: {
  online: { method: string; paidAt: Date | null; cfPaymentId: string | null } | null;
  utr: string | null;
}): string | null {
  if (source.online) {
    return [
      `Paid online${source.online.paidAt ? ` ${istDateTime(source.online.paidAt)}` : ""}`,
      source.online.method,
      source.online.cfPaymentId ? `Cashfree payment ID ${source.online.cfPaymentId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (source.utr) return `Paid by UPI · UTR ${source.utr}`;
  return null;
}

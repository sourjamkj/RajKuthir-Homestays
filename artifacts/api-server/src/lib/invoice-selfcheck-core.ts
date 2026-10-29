import QRCode from "qrcode";

import { upiIntentUrl } from "./book-pay-rules.ts";
import { invoiceContent, type InvoiceBooking } from "./invoice-rules.ts";
import { renderInvoicePdf } from "./invoice-pdf.ts";

/**
 * The invoice self-check's working parts, with no database or network, so
 * they are tested directly. invoice-selfcheck.ts schedules it, keeps the last
 * result and emails the owner.
 *
 * The test guest's name deliberately carries characters the PDF fonts cannot
 * draw (accents, Bengali, an emoji), the cause of an earlier failure.
 */

export const TEST_BOOKING: InvoiceBooking = {
  id: "self-check",
  reference: "RK-SELFTEST",
  source: "direct",
  status: "confirmed",
  guestName: "Śrī Test Guest অতিথি 🙂",
  guestPhone: "+91 00000 00000",
  checkIn: "2026-12-23",
  checkOut: "2026-12-25",
  guests: 2,
  pets: 1,
  grossPaise: 820_000,
  receivedPaise: 410_000,
};

export type CheckStep = { name: "invoice" | "confirmation"; ok: boolean; bytes?: number; ms: number; error?: string };
export type SelfCheckResult = { ok: boolean; checkedAt: string; steps: CheckStep[] };

/** What to tell the owner, given the previous and the new result. Pure. */
export function alertFor(previous: SelfCheckResult | null, next: SelfCheckResult): { subject: string; text: string } | null {
  const failing = next.steps.filter((step) => !step.ok);
  if (!next.ok && (previous === null || previous.ok)) {
    return {
      subject: "Raj Kuthir: invoice PDFs are failing",
      text: [
        "The hourly self-check could not make a test PDF, so guest invoices and booking confirmations are probably failing too.",
        "",
        ...failing.map((step) => `• ${step.name}: ${step.error ?? "failed"}`),
        "",
        `Checked at ${next.checkedAt}. Live status: https://rajkuthirhomestays.casa/api/health/invoices`,
        "You will get one more email when it works again.",
      ].join("\n"),
    };
  }
  if (next.ok && previous !== null && !previous.ok) {
    return {
      subject: "Raj Kuthir: invoice PDFs are working again",
      text: `The hourly self-check made a test invoice and a test booking confirmation successfully at ${next.checkedAt}.`,
    };
  }
  return null;
}

async function step(name: CheckStep["name"], make: () => Promise<Uint8Array>): Promise<CheckStep> {
  const started = Date.now();
  try {
    const pdf = await make();
    const isPdf = Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-";
    return isPdf
      ? { name, ok: true, bytes: pdf.length, ms: Date.now() - started }
      : { name, ok: false, ms: Date.now() - started, error: "the output is not a PDF" };
  } catch (error) {
    return { name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Makes the two test PDFs. Never throws. */
export async function runInvoiceSelfCheck(
  now = new Date(),
  upi: { id: string; name: string } = { id: "test@upi", name: "Raj Kuthir Homestays" },
): Promise<SelfCheckResult> {
  const content = invoiceContent({ booking: TEST_BOOKING, number: "RK/TEST/0000", issuedOn: now.toISOString().slice(0, 10), email: null });
  const steps = [
    await step("invoice", () => renderInvoicePdf(content)),
    await step("confirmation", async () => {
      const url = upiIntentUrl({ upiId: upi.id, payeeName: upi.name, amountPaise: content.balancePaise, note: "RK-SELFTEST" });
      const qrPng = new Uint8Array(await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 }));
      return renderInvoicePdf({ ...content, number: "RK-SELFTEST" }, { kind: "confirmation", payment: { upiId: upi.id, payeeName: upi.name, note: "RK-SELFTEST", qrPng } });
    }),
  ];
  return { ok: steps.every((s) => s.ok), checkedAt: now.toISOString(), steps };
}


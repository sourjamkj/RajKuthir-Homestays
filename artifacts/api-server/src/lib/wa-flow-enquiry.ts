import { pool } from "@workspace/db";
import { createWhatsappEnquiry } from "./enquiries-repo";
import { notifyOwner } from "./owner-alerts";
import { priceCheck } from "../routes/book";
import { parseWaFlowAnswers } from "./wa-flow-rules.ts";
import { sendText } from "./whatsapp-client";
import { logger } from "./logger";

export const FLOW_CONFIRMATION =
  "Thank you! 🌿 Your enquiry has been received. We're checking your dates and preparing your quotation. We'll contact you on WhatsApp shortly.";

let migrated = false;
async function ensureFlowMigration() {
  if (migrated) return;
  await pool.query(
    `ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS whatsapp_submission_id text`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS enquiries_whatsapp_submission_id_unique ON enquiries (whatsapp_submission_id)`,
  );
  migrated = true;
}

/** Saves the Meta-authenticated sender's enquiry exactly once; Flow fields never supply a phone number. */
export async function acceptWaFlowSubmission(input: {
  messageId: string;
  senderPhone: string;
  responseJson: unknown;
}): Promise<{
  accepted: boolean;
  reference: string;
  quotation: unknown;
  newlyCreated: boolean;
}> {
  const answers = parseWaFlowAnswers(input.responseJson);
  if (!answers) throw new Error("Invalid WhatsApp booking Flow response.");
  await ensureFlowMigration();
  const result = await createWhatsappEnquiry({
    name: "WhatsApp guest",
    phone: input.senderPhone,
    checkIn: answers.check_in,
    checkOut: answers.check_out,
    adults: answers.adults,
    children: answers.children,
    pets: answers.pet_count,
    whatsappSubmissionId: input.messageId,
  });

  let quotation: unknown = { status: "pending" };
  try {
    const priced = await priceCheck({
      checkIn: answers.check_in,
      checkOut: answers.check_out,
      adults: answers.adults,
      children: answers.children,
      pets: answers.pet_count,
    });
    quotation = priced.available
      ? {
          status: "quoted",
          available: true,
          nights: priced.nights,
          perNight: priced.perNight,
          totalPaise: priced.totalPaise,
          advancePaise: priced.advancePaise,
          balancePaise: priced.balancePaise,
          peak: priced.peak,
        }
      : { status: "unavailable", available: false, reason: priced.reason };
  } catch (error) {
    logger.error(
      { err: error, enquiryId: result.enquiry.id },
      "WhatsApp enquiry quotation is pending",
    );
  }

  if (result.created) {
    await notifyOwner({
      event: "enquiry",
      title: "New WhatsApp enquiry",
      body: `${input.senderPhone} · ${answers.check_in} to ${answers.check_out} · ${answers.adults + answers.children} guest${answers.adults + answers.children === 1 ? "" : "s"}${answers.pet_count ? ` · ${answers.pet_count} pet${answers.pet_count === 1 ? "" : "s"}` : ""}`,
      href: "/admin/guests#enquiries",
      dedupeKey: `wa-enquiry:${input.messageId}`,
    });
    // A send failure never cancels the enquiry. The message is sent once per unique Meta id.
    const sent = await sendText({
      to: input.senderPhone,
      text: FLOW_CONFIRMATION,
    });
    if (!sent.ok)
      logger.warn(
        { retryable: sent.retryable },
        "WhatsApp enquiry confirmation could not be sent",
      );
  }
  return {
    accepted: true,
    reference: result.enquiry.id,
    quotation,
    newlyCreated: result.created,
  };
}

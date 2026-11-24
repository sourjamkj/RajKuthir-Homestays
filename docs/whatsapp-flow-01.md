# WhatsApp Flow 01: booking enquiry

## Files and behavior

- Flow JSON 7.3: `artifacts/api-server/assets/wa-flow-01-booking-enquiry.json`
- Webhook: `POST /webhooks/whatsapp`, using the existing `WHATSAPP_APP_SECRET` signature check and `WHATSAPP_PHONE_NUMBER_ID` business-number check.
- A guest can start the form by sending `enquiry`, `booking enquiry`, `check dates`, `availability`, `plan my stay`, or `plan a stay`.
- Valid signed responses become enquiries in the existing owner Enquiries list. Dates and occupancy are passed to the existing availability and quote engine. Unavailable or minimum-stay dates do not receive a price. The submission creates no booking and blocks no inventory.

## Meta setup

1. In WhatsApp Manager, create a Flow named **Raj Kuthir Homestays – Sobuj Potro** and import `artifacts/api-server/assets/wa-flow-01-booking-enquiry.json`.
2. Validate it in the Flow builder, publish it, and copy the published Flow ID. Confirm the Flow is associated with the same WhatsApp business phone number configured on the api-server.
3. Set `WHATSAPP_BOOKING_FLOW_ID` on the api-server service to that Flow ID. Do not add it to Hermes or commit it as a secret.
4. Send `enquiry` from the configured pilot number and submit a future date range. Verify exactly one enquiry appears, the owner receives an `enquiry` alert, and the guest receives the exact acceptance confirmation.

The launch action runs only after the guest has messaged, inside WhatsApp's customer-service window. Meta configuration and publishing remain manual; this change does not access or alter the live Meta account.

## Database and Railway

The additive SQL in `artifacts/api-server/src/db/whatsapp-enquiry-migration.sql` adds a nullable unique idempotency key to `enquiries`. The webhook applies this additive change on first Flow use as a guard; run the SQL as a deployment migration as well. Existing enquiry rows are unaffected.

Required existing settings remain `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ENABLED=true`, and the pilot/autoreply controls. Add `WHATSAPP_BOOKING_FLOW_ID` after publishing the Flow. Keep `WHATSAPP_AUTOREPLY_ENABLED` and `WHATSAPP_TEST_NUMBERS` according to the current pilot policy. Deploy the branch through the normal Railway preview/review process; do not switch production settings until the owner approves.

## Safety and operation

- Invalid signatures return 401. Storage failures return 503 so Meta may retry.
- Meta's inbound `from` number is used for association; no guest-supplied Flow field can choose the enquiry phone.
- A unique WhatsApp message id makes enquiry creation and owner alerts idempotent. Flow submissions are never sent to Hermes; mixed batches forward only allowlisted non-Flow guest messages.
- Confirmation is sent only after the enquiry row is committed, and duplicate webhook deliveries do not send another confirmation.
- The returned quote is advisory. The owner still handles the enquiry and booking through the existing process.

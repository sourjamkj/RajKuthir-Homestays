# Guest pre-arrival onboarding

This feature adds a booking-specific guest verification flow without changing the existing `/welcome` Arrival Pack logic.

## Flow

1. Admin opens `/admin/guests` and finds a booking under **Guest check-in readiness**.
2. **Send Info** creates/refreshes a high-entropy, booking-specific onboarding link and opens WhatsApp with the guest-safe pre-arrival message.
3. The guest completes their details and uploads identity documents.
4. Documents are stored in PostgreSQL (`guest_documents.file_data`) with metadata and a `submitted` status.
5. Admin reviews the submission and marks the booking **Check-in ready** or **blocked**.
6. The verification deadline is automatically calculated as 48 hours before the property's 12:00 PM IST check-in time.

## Link format

Both links carry their token in the URL **fragment**, not the path:

```
https://rajkuthirhomestays.casa/pre-arrival#<token>
https://rajkuthirhomestays.casa/management-documents#<token>
```

A fragment is never transmitted to a server. A token in the path or query string would be written verbatim into the Railway proxy access log, sent to any third-party asset in a `Referer` header, and kept in browser history — and the management token opens scans of a guest's government ID. The page reads the fragment locally and exchanges it for data over POST. This mirrors the reasoning already applied to the booking reference in `routes/guest.ts`.

Both paths are registered in `seo.ts` as known **and** private, so each is served with a 200, `X-Robots-Tag: noindex, nofollow`, no canonical and no `og:url`. The bare path reveals nothing: without a fragment the page is an empty form.

## DigiLocker

The data model has a `source` field and the guest page is ready for a DigiLocker provider. The repository does **not** contain DigiLocker/API Setu credentials or a live OAuth integration, so the current implementation safely uses manual upload. Do not add DigiLocker client secrets to source control. Once approved requester/API credentials are available, implement the provider behind the onboarding submission boundary and store the returned document/reference rather than provider tokens.

## Check-in hours

Check-in is from **12:00 PM** and check-out by **11:00 AM**, Asia/Kolkata. These figures appear in four places and must move together: the house rules page, the `LodgingBusiness` structured data (`checkinTime` / `checkoutTime`), `CHECK_IN_LOCAL` in `guest-onboarding-repo.ts` (which anchors the 48-hour deadline), and `CHECK_IN_TIME` / `CHECK_OUT_TIME` in `AdminGuests.tsx` (which the guest's confirmation message quotes). A test in `seo.test.ts` asserts they agree.

## Documents

Uploads are currently stored as PostgreSQL `bytea` with an 8 MB per-document limit. This satisfies an own-database deployment but should be reviewed for database size/backup impact before large-scale use. The schema includes `deleted_at`, verification timestamps and source metadata to support retention/cleanup later.

## WhatsApp

The admin button uses a `wa.me` deep link and pre-fills a transactional guest message. It does not claim delivery status. The pre-arrival message deliberately excludes booking price, advance, balance, commission and other financial fields.

## Existing Arrival Pack

`/welcome`, `/api/guest/lookup`, `/api/guest/pack.pdf`, and the property-wide Guest Info pack remain unchanged. The new onboarding flow is separate from the Arrival Pack.


## Communication split

- **Guest WhatsApp:** includes the mandatory pre-arrival verification link and the guest-facing booking confirmation, including total booking amount, advance received and balance due when those booking ledger values are present.
- **Management WhatsApp/email:** contains only guest name, guest mobile number, check-in/check-out dates, uploaded ID document/status information, a secure document-access link, and verification/check-in readiness status. It deliberately excludes accommodation, guest count, pets, pricing, advance, balance, commission, tax and other payment information.
- Management access is a separate expiring bearer link; it is not the same credential used by the guest.
- The existing Arrival Pack flow is intentionally unchanged.
- Verification is due exactly 48 hours before the scheduled 12:00 PM check-in. After the deadline, the system blocks guest submission and surfaces check-in as blocked for management; it does not automatically cancel the booking or issue/refuse a refund.

## Migrations

Two files, both idempotent, both needed before the flow will run against a fresh database:

- `artifacts/api-server/src/db/guest-onboarding-migration.sql` — the enums plus `guests`, `booking_guests`, `guest_documents`, `guest_onboarding`
- `guest-management-access.sql` (repo root) — `guest_management_access`

A test asserts that every table the feature queries is created by one of them.

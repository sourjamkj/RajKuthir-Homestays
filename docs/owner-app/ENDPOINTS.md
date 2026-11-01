# Owner app: what each screen calls

Phase 0 inventory. Every path is under `/api`. All of them accept the web
console's cookie or a phone's `Authorization: Bearer rkd_…` token (Phase 1).
"New" marks what Phase 1 added; everything else already existed.

## Sign-in and phones (new)

| Call | What for |
|---|---|
| `POST /admin/app/login` `{password, deviceName, platform}` | Password in, a token for this phone out (shown once) |
| `POST /admin/app/logout` | This phone signs itself out |
| `PUT /admin/app/push-token` `{pushToken}` | Where this phone gets alerts (Expo push token) |
| `GET /admin/devices` | Signed-in phones |
| `DELETE /admin/devices/:id` | Sign a phone out (sensitive) |
| `GET /admin/me` | Signed in? `via: "web" \| "app"` |

## 1. Alerts and confirm payments

| Call | What for |
|---|---|
| `GET /admin/activity`, `POST /admin/activity/seen` | What happened since last look |
| `GET /admin/book-pay` | Holds and submitted payments |
| `GET /admin/book-pay/:id/screenshot` | The guest's payment screenshot |
| `POST /admin/book-pay/:id/confirm` / `reject` | Confirm (creates the booking, sends the confirmation) or reject |
| `PUT /admin/book-pay/settings` | Online booking on/off, advance %, hold length |
| `GET /enquiries`, `POST /enquiries/:id/advance-received` | Advances paid outside Book & Pay |

## 2. Calendar and blocking dates

| Call | What for |
|---|---|
| `GET /calendar/events` | All four calendars merged |
| `POST /calendar/block`, `DELETE /calendar/block/:id` | Block / free nights |
| `POST /calendar/sync`, `GET /calendar/sync-status` | Sync now, last result |
| `GET /rates` | Nightly price shown on each day |

## 3. Guests, enquiries and WhatsApp

| Call | What for |
|---|---|
| `GET /enquiries`, `PATCH /enquiries/:id`, `POST /enquiries/:id/quote` / `convert` / `book` | Enquiry inbox and actions |
| `GET /contacts`, `PATCH /contacts/:phone` | Guest list |
| `GET /admin/guest-stays` | Upcoming stays with ID-document status |
| `GET /admin/guest-stays/:bookingId/documents` (+ `/:documentId/file`) | ID documents |
| `POST /admin/guest-stays/:bookingId/verify` / `reject` / `onboarding` | Verify or reject documents, send the pre-arrival link |
| `GET /admin/bookings/:id/confirmation.pdf`, `GET /admin/bookings/:id/invoice.pdf` | PDFs to send |
| `POST /admin/bookings/:id/invoice/email` / `invoice/whatsapp` | Send the invoice |
| `GET /notifications` (now also `mode`) | WhatsApp outbox: drafts, pending, sent, failed |
| `POST /notifications/:id/approve` / `cancel` | Business API mode |
| `POST /notifications/:id/sent-manually` (new) | Manual mode: sent from my own WhatsApp |
| `POST /admin/review-requests/:id/approve` / `sent-manually` / `cancel` | Review requests |

## 4. Money

| Call | What for |
|---|---|
| `GET /ledger/summary` | Month totals |
| `GET /bookings`, `PATCH /bookings/:id`, `POST /admin/bookings/:id/paid-in-full` | Bookings and balances |
| `GET /expenses`, `POST /expenses`, `DELETE /expenses/:id` | Expenses |
| `GET /payouts`, `GET /admin/ota-documents` | OTA payouts and statements |

## 5. Settings (new)

| Call | What for |
|---|---|
| `GET /admin/settings` | Effective values, where each came from (console / railway / default), WhatsApp readiness, Railway variables set or missing |
| `PATCH /admin/settings` | Change settings; contacts and WhatsApp mode are sensitive |
| `GET /admin/audit` | Who changed what, from the web or the app |
| `GET/PUT /calendar/feed-sources` | OTA iCal URLs |
| `GET/POST/PATCH/DELETE /mail/accounts` | Connected mailboxes |
| `GET/PUT /admin/guest-info` | Arrival-pack details |

Sensitive changes need a fresh confirmation: the app asks for the fingerprint
before it can use its token at all; the web sends `confirmPassword`. A 403 with
`needsConfirmation: true` means "ask again".

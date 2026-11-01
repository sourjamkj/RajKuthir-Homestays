import { test } from "node:test";
import assert from "node:assert/strict";

import { datesTakenFor } from "./enquiry-clash.ts";

const open = { status: "contacted", checkIn: "2026-12-26", checkOut: "2026-12-27", convertedBookingId: null };
const block = { source: "manual", startDate: "2026-12-26", endDate: "2026-12-28", title: "Blocked" };

test("an open enquiry on blocked nights is flagged with what holds them", () => {
  assert.deepEqual(datesTakenFor(open, [block]), { startDate: "2026-12-26", endDate: "2026-12-28", label: "blocked by you" });
  assert.deepEqual(datesTakenFor({ ...open, status: "new" }, [{ ...block, source: "bookingCom", title: "Booked — Natasa" }]), {
    startDate: "2026-12-26",
    endDate: "2026-12-28",
    label: "Booked — Natasa",
  });
  assert.equal(datesTakenFor(open, [{ ...block, source: "airbnb", title: "Not available" }])?.label, "Airbnb");
});

test("free nights, touching ranges and closed or booked enquiries are not flagged", () => {
  assert.equal(datesTakenFor(open, []), null);
  // Check-out on the day a block starts is not a clash.
  assert.equal(datesTakenFor({ ...open, checkIn: "2026-12-25", checkOut: "2026-12-26" }, [block]), null);
  assert.equal(datesTakenFor({ ...open, status: "converted" }, [block]), null);
  assert.equal(datesTakenFor({ ...open, status: "closed" }, [block]), null);
  assert.equal(datesTakenFor({ ...open, convertedBookingId: "b1" }, [block]), null);
  assert.equal(datesTakenFor({ ...open, checkIn: null }, [block]), null);
  assert.equal(datesTakenFor({ ...open, checkOut: "2026-12-26" }, [block]), null);
});

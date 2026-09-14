import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTRA_ADULT_PAISE,
  EXTRA_CHILD_PAISE,
  PET_PAISE,
  RATE_CARD_MAX_GUESTS,
  breakdownOf,
  petCharge,
  stayTotalPaise,
  surchargePerNight,
} from "./party.ts";

/**
 * The billing-twice test is the one that matters. Everything else here is
 * boundary arithmetic; that one is the mistake a guest notices at check-in.
 */

const NIGHTS = ["2026-10-02", "2026-10-03", "2026-10-04"];

/** ₹2,610 / ₹2,900 / ₹3,190 / ₹3,770 / ₹4,350 — the real standing ladder. */
const CARD: Record<number, number> = {
  1: 261_000,
  2: 290_000,
  3: 319_000,
  4: 377_000,
  5: 435_000,
};
const nightlyRate = (_iso: string, guests: number) => CARD[guests] ?? 0;

test("party · a child is a guest, not a surcharge, inside the rate card", () => {
  // Two adults, two children. Four heads, four-guest rate, nothing added.
  // Charging ₹500 here as well would bill those children twice.
  const breakdown = breakdownOf({ adults: 2, children: 2, pets: 0 });

  assert.equal(breakdown.heads, 4);
  assert.equal(breakdown.ratedGuests, 4);
  assert.equal(breakdown.extraChildren, 0);
  assert.equal(breakdown.extraAdults, 0);
  assert.equal(surchargePerNight(breakdown), 0);

  assert.equal(
    stayTotalPaise({ nights: NIGHTS, breakdown, nightlyRate }),
    3 * 377_000,
  );
});

test("party · exactly five is still the rate card, with nothing on top", () => {
  assert.equal(RATE_CARD_MAX_GUESTS, 5);

  const breakdown = breakdownOf({ adults: 3, children: 2, pets: 0 });

  assert.equal(breakdown.heads, 5);
  assert.equal(breakdown.ratedGuests, 5);
  assert.equal(surchargePerNight(breakdown), 0);
});

test("party · the sixth head is where a surcharge starts, not the first child", () => {
  const five = breakdownOf({ adults: 5, children: 0, pets: 0 });
  const six = breakdownOf({ adults: 6, children: 0, pets: 0 });

  assert.equal(surchargePerNight(five), 0);
  assert.equal(surchargePerNight(six), EXTRA_ADULT_PAISE);
});

test("party · children absorb the overflow before adults do", () => {
  // Four adults, two children, six heads, one over. That head is a child at
  // ₹500 — the cheaper reading, and the one nobody argues with at check-in.
  const breakdown = breakdownOf({ adults: 4, children: 2, pets: 0 });

  assert.equal(breakdown.heads, 6);
  assert.equal(breakdown.extraChildren, 1);
  assert.equal(breakdown.extraAdults, 0);
  assert.equal(surchargePerNight(breakdown), EXTRA_CHILD_PAISE);
});

test("party · once the children run out, the rest are adult surcharges", () => {
  // Six adults, one child, seven heads, two over: the child plus one adult.
  const breakdown = breakdownOf({ adults: 6, children: 1, pets: 0 });

  assert.equal(breakdown.extraChildren, 1);
  assert.equal(breakdown.extraAdults, 1);
  assert.equal(
    surchargePerNight(breakdown),
    EXTRA_CHILD_PAISE + EXTRA_ADULT_PAISE,
  );
});

test("party · the surcharge lands on every night, not once", () => {
  const breakdown = breakdownOf({ adults: 7, children: 0, pets: 0 });

  assert.equal(breakdown.ratedGuests, 5);
  assert.equal(
    stayTotalPaise({ nights: NIGHTS, breakdown, nightlyRate }),
    3 * (435_000 + 2 * EXTRA_ADULT_PAISE),
  );
});

test("party · a pet is charged once for the stay, however many nights", () => {
  const breakdown = breakdownOf({ adults: 2, children: 0, pets: 1 });

  assert.equal(petCharge(breakdown), PET_PAISE);

  const three = stayTotalPaise({ nights: NIGHTS, breakdown, nightlyRate });
  const one = stayTotalPaise({ nights: ["2026-10-02"], breakdown, nightlyRate });

  // Three nights costs two more nights of room, and not a rupee more of pet.
  assert.equal(three - one, 2 * 290_000);
});

test("party · two pets are two charges", () => {
  assert.equal(petCharge(breakdownOf({ adults: 2, children: 0, pets: 2 })), 2 * PET_PAISE);
});

test("party · a pet does not count as a head", () => {
  const withPet = breakdownOf({ adults: 5, children: 0, pets: 1 });

  assert.equal(withPet.heads, 5);
  assert.equal(surchargePerNight(withPet), 0, "a pet triggered an occupancy surcharge");
});

test("party · a festival night keeps its override, with the surcharge on top", () => {
  // The override changes what the base night costs; the extra heads sit on
  // whatever that is rather than replacing it.
  const festival = (iso: string, guests: number) =>
    iso === "2026-10-03" ? 600_000 : (CARD[guests] ?? 0);

  const breakdown = breakdownOf({ adults: 6, children: 0, pets: 0 });

  assert.equal(
    stayTotalPaise({ nights: NIGHTS, breakdown, nightlyRate: festival }),
    435_000 + 600_000 + 435_000 + 3 * EXTRA_ADULT_PAISE,
  );
});

test("party · missing and nonsense counts are treated as none, never negative", () => {
  for (const party of [
    { adults: null, children: null, pets: null },
    { adults: -3, children: -1, pets: -2 },
    { adults: 2.7, children: 0, pets: 0 },
  ]) {
    const breakdown = breakdownOf(party);
    assert.ok(breakdown.heads >= 0);
    assert.ok(surchargePerNight(breakdown) >= 0);
    assert.ok(petCharge(breakdown) >= 0);
  }

  // 2.7 adults is two adults, not three — never round a guest up into a charge.
  assert.equal(breakdownOf({ adults: 2.7, children: 0, pets: 0 }).heads, 2);
});

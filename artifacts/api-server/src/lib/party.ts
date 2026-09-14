/**
 * Who is in the party, and what that adds to the bill.
 *
 * The villa's standing rates cover occupancies of one to five. This file is
 * about everything either side of that: children, pets, and parties larger
 * than the rate card goes.
 *
 * The rule that matters, and the one most easily got wrong: a child COUNTS
 * AS A GUEST. Two adults and two children are a party of four and pay the
 * four-guest rate, with nothing added. The per-child charge is not a charge
 * for bringing a child — it is what an extra head costs once the party is
 * bigger than five. Charging both the occupancy rate and a child fee for the
 * same person is billing them twice, and it is the mistake this module exists
 * to prevent.
 *
 * Past five, each additional head is priced by who they are: a child under
 * eight is the cheaper rate. Children fill the overflow before adults do, so
 * four adults and two children pay one child surcharge rather than one adult
 * surcharge — the guest gets the better of the two readings, which is also
 * the reading nobody argues with at check-in.
 *
 * Pets are the exception to all of it: one charge for the visit, not per
 * night, because what a pet costs is the extra clean afterwards and that
 * happens once however long they stay.
 */

/** Occupancies the rate card itself covers. Beyond this, surcharges apply. */
export const RATE_CARD_MAX_GUESTS = 5;

/** A "child" for pricing. Eight and over is a full guest at the normal rate. */
export const CHILD_UNDER_AGE = 8;

/** Per extra head per night, in paise. */
export const EXTRA_ADULT_PAISE = 55_000; // ₹550
export const EXTRA_CHILD_PAISE = 50_000; // ₹500

/** Per pet, once for the whole stay, in paise. */
export const PET_PAISE = 70_000; // ₹700

export type Party = {
  adults: number | null;
  children: number | null;
  pets: number | null;
};

export type PartyBreakdown = {
  /** Everyone sleeping here, children included. */
  heads: number;
  /** The occupancy the standing rate card is read at: heads, capped at five. */
  ratedGuests: number;
  /** Heads past five, priced separately. */
  extraChildren: number;
  extraAdults: number;
  pets: number;
};

function whole(value: number | null): number {
  const parsed = Math.floor(Number(value ?? 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function breakdownOf(party: Party): PartyBreakdown {
  const adults = whole(party.adults);
  const children = whole(party.children);
  const pets = whole(party.pets);

  const heads = adults + children;
  const overflow = Math.max(0, heads - RATE_CARD_MAX_GUESTS);

  // Children absorb the overflow first — the cheaper surcharge — and adults
  // only once the children run out.
  const extraChildren = Math.min(children, overflow);
  const extraAdults = overflow - extraChildren;

  return {
    heads,
    ratedGuests: Math.min(heads, RATE_CARD_MAX_GUESTS),
    extraChildren,
    extraAdults,
    pets,
  };
}

/** What the extra heads add to every night of the stay, in paise. */
export function surchargePerNight(breakdown: PartyBreakdown): number {
  return (
    breakdown.extraChildren * EXTRA_CHILD_PAISE +
    breakdown.extraAdults * EXTRA_ADULT_PAISE
  );
}

/** What the pets add to the stay as a whole, in paise. Not per night. */
export function petCharge(breakdown: PartyBreakdown): number {
  return breakdown.pets * PET_PAISE;
}

/**
 * The whole stay: the nightly rate for the rated occupancy, plus the extra
 * heads on every night, plus the pets once.
 *
 * `nightlyRate` is passed in rather than looked up, so this stays pure and
 * the festival overrides keep working untouched — an override changes what
 * the base night costs, and the surcharges sit on top of whatever that is.
 */
export function stayTotalPaise(input: {
  nights: string[];
  breakdown: PartyBreakdown;
  nightlyRate: (isoDate: string, guests: number) => number;
}): number {
  const perNightExtra = surchargePerNight(input.breakdown);

  const nightly = input.nights.reduce(
    (total, isoDate) =>
      total + input.nightlyRate(isoDate, input.breakdown.ratedGuests) + perNightExtra,
    0,
  );

  return nightly + petCharge(input.breakdown);
}

/**
 * The charges in words, for the booking page and the house rules.
 *
 * Kept here beside the numbers so the page and the bill cannot drift apart —
 * a site that advertises ₹500 while the server charges ₹550 is worse than a
 * site that says nothing.
 */
export function chargesNote(): string[] {
  return [
    `Children under ${CHILD_UNDER_AGE} count as guests — a family of four with two little ones is a party of four, at the four-guest rate.`,
    `Above ${RATE_CARD_MAX_GUESTS} guests, each extra person is ₹${EXTRA_ADULT_PAISE / 100} a night, or ₹${EXTRA_CHILD_PAISE / 100} for a child under ${CHILD_UNDER_AGE}.`,
    `Pets are ₹${PET_PAISE / 100} for the stay, not per night.`,
  ];
}

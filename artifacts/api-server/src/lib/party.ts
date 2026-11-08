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
 * Pets are charged by the length of the stay (owner's policy, Nov 2026). Up
 * to two nights is one flat charge per pet for the whole stay, because what
 * a pet costs then is the extra clean afterwards: ₹1,000 for a single pet on
 * one night, ₹750 each otherwise (two or more pets, or a two-night stay).
 * From three nights it is ₹375 per pet per night.
 */

/** Occupancies the rate card itself covers. Beyond this, surcharges apply. */
export const RATE_CARD_MAX_GUESTS = 5;

/** A "child" for pricing. Eight and over is a full guest at the normal rate. */
export const CHILD_UNDER_AGE = 8;

/**
 * The refundable security deposit, in paise: paid at check-in, returned at
 * check-out after a quick check. The owner's rule (Nov 2026): every
 * follow-up and guest notice must state it.
 */
export const SECURITY_DEPOSIT_PAISE = 250_000; // ₹2,500

/** The deposit in words — the same sentence everywhere it is stated. */
export function securityDepositNote(): string {
  return `Refundable security deposit: ₹${(SECURITY_DEPOSIT_PAISE / 100).toLocaleString("en-IN")}, paid at check-in and returned at check-out`;
}

/** Per extra head per night, in paise. */
export const EXTRA_ADULT_PAISE = 55_000; // ₹550
export const EXTRA_CHILD_PAISE = 50_000; // ₹500

/** One pet, one night — once for the stay, in paise. */
export const PET_SHORT_STAY_PAISE = 100_000; // ₹1,000
/** Per pet for the whole stay when two or more pets come, or the stay is two nights, in paise. */
export const PET_SHORT_STAY_MULTI_PAISE = 75_000; // ₹750
/** Per pet per night once the stay is this many nights or longer. */
export const PET_NIGHTLY_FROM_NIGHTS = 3;
/** Per pet per night for stays of three nights or more, in paise. */
export const PET_NIGHTLY_PAISE = 37_500; // ₹375

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

/**
 * What the pets add to the stay as a whole, in paise: one pet for one night
 * ₹1,000; two or more pets, or a two-night stay, ₹750 per pet for the stay;
 * from three nights, ₹375 per pet per night.
 */
export function petCharge(breakdown: PartyBreakdown, nights: number): number {
  if (breakdown.pets <= 0 || nights <= 0) return 0;
  const shortStay = breakdown.pets === 1 && nights === 1 ? PET_SHORT_STAY_PAISE : PET_SHORT_STAY_MULTI_PAISE;
  const perPet = nights >= PET_NIGHTLY_FROM_NIGHTS ? PET_NIGHTLY_PAISE * nights : shortStay;
  return breakdown.pets * perPet;
}

/**
 * The whole stay: the nightly rate for the rated occupancy, plus the extra
 * heads on every night, plus the pets (priced by the length of the stay).
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

  return nightly + petCharge(input.breakdown, input.nights.length);
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
    petChargeNote(),
    `${securityDepositNote()}.`,
  ];
}

/** The pet charge in words — the same sentence on every page that states it. */
export function petChargeNote(): string {
  return `Pets: ₹${(PET_SHORT_STAY_PAISE / 100).toLocaleString("en-IN")} for one pet for one night; ₹${PET_SHORT_STAY_MULTI_PAISE / 100} each for the stay with two or more pets or a two-night stay; from ${PET_NIGHTLY_FROM_NIGHTS} nights, ₹${PET_NIGHTLY_PAISE / 100} each per night.`;
}

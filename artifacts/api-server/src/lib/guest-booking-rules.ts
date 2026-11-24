/**
 * A guest-agent hold must match every material detail of the quote the guest
 * accepted. Any date, party, total or advance drift requires a fresh yes.
 */
export type AcceptedGuestQuote = {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  pets: number;
  totalPaise: number;
  advancePaise: number;
};

export function acceptedQuoteMatches(
  accepted: AcceptedGuestQuote,
  current: AcceptedGuestQuote,
): boolean {
  const fields: Array<keyof AcceptedGuestQuote> = [
    "checkIn",
    "checkOut",
    "adults",
    "children",
    "pets",
    "totalPaise",
    "advancePaise",
  ];
  return fields.every((field) =>
    typeof accepted[field] === "number"
      ? Number.isSafeInteger(accepted[field]) && accepted[field] === current[field]
      : accepted[field] === current[field],
  );
}

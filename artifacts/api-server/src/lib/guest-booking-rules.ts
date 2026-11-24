/**
 * The guest agent must only start a hold for the exact total and advance the
 * guest accepted. A rate change between quote and hold requires a fresh yes.
 */
export function acceptedQuoteMatches(input: {
  acceptedTotalPaise: number;
  acceptedAdvancePaise: number;
}, current: { totalPaise: number; advancePaise: number }): boolean {
  return Number.isSafeInteger(input.acceptedTotalPaise)
    && Number.isSafeInteger(input.acceptedAdvancePaise)
    && input.acceptedTotalPaise === current.totalPaise
    && input.acceptedAdvancePaise === current.advancePaise;
}

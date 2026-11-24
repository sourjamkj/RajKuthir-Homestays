export type WaFlowAnswers = {
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  bringing_pets: boolean;
  pet_count: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

/** Flow payloads encode number and boolean fields as strings on some clients. */
export function parseWaFlowAnswers(
  raw: unknown,
  today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
): WaFlowAnswers | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const allowed = new Set([
    "check_in",
    "check_out",
    "adults",
    "children",
    "bringing_pets",
    "pet_count",
    "flow_token",
  ]);
  if (Object.keys(data).some((key) => !allowed.has(key))) return null;
  if (
    data.flow_token !== undefined &&
    (typeof data.flow_token !== "string" || data.flow_token.length > 512)
  )
    return null;
  const count = (input: unknown, min: number, max: number): number | null => {
    const n =
      typeof input === "number"
        ? input
        : typeof input === "string" && /^\d+$/.test(input)
          ? Number(input)
          : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const checkIn = data.check_in;
  const checkOut = data.check_out;
  const adults = count(data.adults, 1, 5);
  const children = count(data.children, 0, 5);
  const petsValue = data.bringing_pets;
  const bringingPets =
    petsValue === true || petsValue === "true" || petsValue === "yes";
  const noPets =
    petsValue === false || petsValue === "false" || petsValue === "no";
  const suppliedPetCount = noPets
    ? data.pet_count === undefined
      ? 0
      : count(data.pet_count, 0, 0)
    : count(data.pet_count, 1, 4);
  if (
    !validDate(checkIn) ||
    !validDate(checkOut) ||
    checkIn < today ||
    checkOut <= checkIn ||
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) /
      86400000 >
      30 ||
    adults === null ||
    children === null ||
    adults + children > 5 ||
    (!bringingPets && !noPets) ||
    (bringingPets && suppliedPetCount === null) ||
    (noPets && suppliedPetCount !== 0)
  )
    return null;
  return {
    check_in: checkIn,
    check_out: checkOut,
    adults,
    children,
    bringing_pets: bringingPets,
    pet_count: bringingPets ? suppliedPetCount! : 0,
  };
}

export function expectedPhoneNumberIdMatches(
  actual: unknown,
  expected = process.env["WHATSAPP_PHONE_NUMBER_ID"]?.trim(),
): boolean {
  return Boolean(expected && typeof actual === "string" && actual === expected);
}

/**
 * Day or night at the villa: NOAA sunrise/sunset for Santiniketan, worked out
 * in the browser for the visitor's moment, always on India's clock.
 *
 * index.html carries a copy of sunTimes() as a pre-paint script (it has to run
 * before React loads, so it cannot import this file). daylight.test.ts checks
 * the two agree.
 */

export const VILLA = { lat: 23.68, lon: 87.68 };

/** Sunrise and sunset in minutes after UTC midnight of `date`'s UTC day (official zenith 90.833°). */
export function sunTimes(date: Date, lat = VILLA.lat, lon = VILLA.lon): { rise: number; set: number } {
  const rad = Math.PI / 180;
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
  return { rise: 720 - 4 * (lon + ha) - eq, set: 720 - 4 * (lon - ha) - eq };
}

const utcMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;

export function isNight(now: Date = new Date()): boolean {
  const { rise, set } = sunTimes(now);
  const m = utcMinutes(now);
  return m < rise || m >= set;
}

/** Minutes until today's sunset, or null after it (the evening has come). */
export function minutesToSunset(now: Date = new Date()): number | null {
  const m = utcMinutes(now);
  const { rise, set } = sunTimes(now);
  return m >= rise && m < set ? set - m : null;
}

/** Guest pages follow the sun; the owner's console and printable documents stay light. */
export function followsDaylight(pathname: string, basePath = "/"): boolean {
  const path = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\/+/, "");
  return !/^(admin|invoice|management-documents)(\/|$)/.test(path.replace(/^\/+/, ""));
}

const clock = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const span = (m: number) => {
  const r = Math.max(1, Math.round(m));
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m`;
};

/** "Santiniketan · 3:42 pm · lights on in 1h 12m", from the villa's own sunset. */
export function sunsetLine(now = new Date()): string {
  const time = clock.format(now).toLowerCase();
  const left = minutesToSunset(now);
  return left === null
    ? `Santiniketan · ${time} · the lights are on`
    : `Santiniketan · ${time} · lights on in ${span(left)}`;
}

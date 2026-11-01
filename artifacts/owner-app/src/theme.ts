/** The site's palette: forest greens on cream, terracotta for anything wrong. */
export const color = {
  bg: '#f5eadb',
  card: '#fffaf3',
  ink: '#1d3a2f',
  brand: '#2d6658',
  muted: '#6b7a72',
  line: '#e2d6c4',
  terracotta: '#a65e45',
  amber: '#8a6320',
  olive: '#7a8065',
  white: '#ffffff',
  whatsapp: '#1f7a4d',
};

export const space = (n: number) => n * 4;

export const rupees = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Dec" from "2026-12-26". */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** "26 Dec 2026". */
export function longDate(iso: string | null): string {
  if (!iso) return '—';
  return `${shortDate(iso)} ${iso.slice(0, 4)}`;
}

/** "1 Nov, 12:43 PM" in IST for a timestamp. */
export function when(at: string): string {
  const d = new Date(new Date(at).getTime() + 330 * 60_000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Today in IST as YYYY-MM-DD. */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

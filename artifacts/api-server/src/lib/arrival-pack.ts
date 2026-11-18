import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The printed arrival poster, served to guests who have proved a live booking.
 *
 * It lives OUTSIDE artifacts/raj-kuthir/public deliberately. Anything in that
 * folder is copied to the site root and served at a plain URL to anyone who
 * asks — and this PDF carries the Wi-Fi QR code (which encodes the network
 * credentials) plus the personal mobile numbers of the caretaker, electrician,
 * plumber, cafe and toto driver. It has to come through the same gate as the
 * rest of the pack, so it is streamed from here after a reference check.
 *
 * Resolved against several candidate paths for the same reason app.ts does:
 * the process may be started from the repo root or from the service directory,
 * and from src or from dist.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export const PACK_CANDIDATES = [
  process.env.ARRIVAL_PACK_PDF,
  path.resolve(process.cwd(), "assets/arrival-pack.pdf"),
  path.resolve(process.cwd(), "artifacts/api-server/assets/arrival-pack.pdf"),
  path.resolve(here, "../../assets/arrival-pack.pdf"),
  path.resolve(here, "../../../assets/arrival-pack.pdf"),
].filter(Boolean) as string[];

export function findPackPdf(): string | null {
  return PACK_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The public pages that are prerendered to HTML at build time. Must be exactly
 * the sitemap's routes (api-server seo.ts PUBLIC_ROUTES) — a test holds the
 * two lists together. Private routes are never prerendered.
 */
export const PRERENDER_ROUTES = [
  '/',
  '/pet-friendly-homestay-shantiniketan',
  '/gallery',
  '/our-story',
  '/places-to-visit-in-shantiniketan',
  '/homestay-near-sonajhuri-haat',
  '/homestay-near-visva-bharati',
  '/shantiniketan-weekend-trip-from-kolkata',
  '/shantiniketan-2-day-itinerary',
  '/house-rules',
  '/rates',
  '/poush-mela-stay-shantiniketan',
  '/basanta-utsav-stay-shantiniketan',
  '/cafe-soi-shantiniketan',
] as const;

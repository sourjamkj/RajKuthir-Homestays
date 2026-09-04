/**
 * Site-wide constants shared by the public homepage and the standalone public
 * routes.
 *
 * These used to live in App.tsx. They moved here so a page component can use
 * them without importing App.tsx — which would be circular, since App.tsx
 * imports every page.
 */

/** Vite's base URL with the trailing slash removed, so `${basePath}/x` never doubles up. */
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// EDITABLE OWNER CONFIG: update rate, contact details and planning notes here.
export const CONFIG = {
  name: 'RAJ KUTHIR HOMESTAYS',
  chapter: 'SOBUJ POTRO',
  place: 'Bolpur / Shantiniketan, West Bengal',
  ratePerNight: 3500,
  advanceShare: 0.3,
  hostPhone: '+91 62903 99165',
  caretakerPhone: '+91 78726 85558',
  mapsUrl: 'https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5',
  instagramUrl: 'https://www.instagram.com/rajkuthirhomestays?igsh=MTBkOWljNTZmbWttdg==',
  reviewUrl: 'https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac',
  attractions: [
    { title: 'Sonajhuri', distance: '~4 km', note: 'Editable planning note' },
    { title: 'Local market / main attraction', distance: '~3 km', note: 'Editable planning note' },
  ],
} as const;

// Photos and documents live in artifacts/raj-kuthir/public/ and Vite copies that
// folder to the site root verbatim, so they are referenced by URL rather than
// `import`. (An ESM `import '../public/External%20Villa%20Morning.jpg'` does not
// resolve: Rollup/Vite never percent-decode import specifiers, and importing out
// of public/ is unsupported — this is what left the live build broken once.)
// `basePath` keeps the URLs correct when the app is served under a sub-path.
export const asset = (file: string) => `${basePath}/${file}`;

export const phoneHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

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

/**
 * EDITABLE OWNER CONFIG: contact details and planning notes.
 *
 * There is deliberately NO nightly rate here. Prices live in the database and
 * are served by /api/rates, editable from Admin → Rates; a constant in this
 * file would be a second source of truth that nobody remembers to update, and
 * a stale price on the public page undercuts or contradicts the OTA listings.
 * When the live plan has not loaded, the page says "check availability &
 * current rate" rather than showing a figure we have not verified.
 */
export const CONFIG = {
  name: 'RAJ KUTHIR HOMESTAYS',
  chapter: 'SOBUJ POTRO',
  place: 'Bolpur / Shantiniketan, West Bengal',
  advanceShare: 0.3,
  hostPhone: '+91 62903 99165',
  caretakerPhone: '+91 78726 85558',
  mapsUrl: 'https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5',
  instagramUrl: 'https://www.instagram.com/rajkuthirhomestays?igsh=MTBkOWljNTZmbWttdg==',
  /** The Maps listing — where a visitor goes to READ what guests have said. */
  reviewUrl: 'https://maps.app.goo.gl/Ptrm6eaXuXNoiXBbA?g_st=ac',
  /**
   * Google's own "write a review" deep link for this listing. It opens the
   * review box directly instead of dropping someone on the listing to find it,
   * which is the difference between a guest leaving a review and meaning to.
   */
  leaveReviewUrl: 'https://g.page/r/CR9H9DboJM75EBM/review',
} as const;

/**
 * The neighbourhood, grouped by how far a guest is willing to travel for it.
 *
 * Distances are BY ROAD from the villa (23.7170, 87.6657) and rounded — a
 * guest planning a day out needs "about twenty minutes", not three decimals.
 *
 * The two station figures are computed from published coordinates: Prantik at
 * 23.6951, 87.6939 and Bolpur Shantiniketan at 23.6578, 87.6981. Worth knowing
 * that Prantik is the closer of the two by some margin, which surprises most
 * guests — they book to Bolpur out of habit.
 *
 * Everything else is a local estimate and easy to correct: change the string,
 * nothing else depends on it.
 */
export const NEIGHBOURHOOD = [
  {
    group: 'Getting here',
    note: 'Prantik is nearer, and quieter. Bolpur is where the fast trains stop.',
    places: [
      {
        title: 'Prantik station',
        distance: '~5 km',
        note: 'The closer halt — about fifteen minutes by toto',
      },
      {
        title: 'Bolpur Shantiniketan station',
        distance: '~9 km',
        note: 'Vande Bharat, Darjeeling Mail, Kanchanjunga Express',
      },
      {
        title: 'Andal airport (Kazi Nazrul Islam)',
        distance: '~70 km',
        note: 'The nearest airport, roughly two hours by road',
      },
      {
        title: 'Kolkata airport',
        distance: '~160 km',
        note: 'Four to five hours by car, or the train to Bolpur',
      },
    ],
  },
  {
    group: 'The Tagore campus',
    note: 'The reason most people come, and all of it within a short ride.',
    places: [
      {
        title: 'Visva-Bharati & Rabindra Bhavan',
        distance: '~6 km',
        note: "Tagore's university and the museum in his own houses",
      },
      {
        title: 'Upasana Griha & Chhatimtala',
        distance: '~6 km',
        note: 'The glass prayer hall, and where the school began',
      },
      {
        title: 'Kala Bhavana',
        distance: '~6 km',
        note: 'The art school — murals, sculpture, open studios',
      },
    ],
  },
  {
    group: 'Close by',
    note: 'Half-day outings. A toto will take you and wait.',
    places: [
      {
        title: 'Sonajhuri Khoai Haat',
        distance: '~4 km',
        note: 'Forest market — Saturdays, often Sundays too, from about 2pm',
      },
      {
        title: 'Kopai River',
        distance: '~4 km',
        note: "The 'Amader chhoto nodi' of the poem",
      },
      {
        title: 'Ballavpur Wildlife Sanctuary',
        distance: '~6 km',
        note: 'Deer park and birds — best early morning',
      },
      {
        title: 'Srijani Shilpagram',
        distance: '~7 km',
        note: 'Crafts and dwellings from across eastern India',
      },
      {
        title: 'Amar Kutir',
        distance: '~8 km',
        note: 'Leatherwork, batik and kantha at the Sriniketan co-operative',
      },
    ],
  },
  {
    group: 'Worth the drive',
    note: 'Full-day trips. Ask the caretaker to arrange a car.',
    places: [
      {
        title: 'Kankalitala',
        distance: '~9 km',
        note: 'One of the 51 Shakta piths, on the bank of the Kopai',
      },
      {
        title: 'Joydev Kenduli',
        distance: '~40 km',
        note: "Baul country — the fair is in January, at Makar Sankranti",
      },
      {
        title: 'Bakreshwar',
        distance: '~55 km',
        note: 'Hot springs and a Shakta pith',
      },
      {
        title: 'Tarapith',
        distance: '~75 km',
        note: 'The Tara temple and its cremation ground',
      },
      {
        title: 'Bishnupur',
        distance: '~77 km',
        note: 'Terracotta temples and Baluchari weaving',
      },
      {
        title: 'Massanjore Dam',
        distance: '~70 km',
        note: 'Across the Jharkhand border, on the Mayurakshi',
      },
    ],
  },
] as const;

// Photos and documents live in artifacts/raj-kuthir/public/ and Vite copies that
// folder to the site root verbatim, so they are referenced by URL rather than
// `import`. (An ESM `import '../public/External%20Villa%20Morning.jpg'` does not
// resolve: Rollup/Vite never percent-decode import specifiers, and importing out
// of public/ is unsupported — this is what left the live build broken once.)
// `basePath` keeps the URLs correct when the app is served under a sub-path.
export const asset = (file: string) => `${basePath}/${file}`;

export const phoneHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/**
 * Fire a GA4 event, or do nothing at all.
 *
 * The analytics tag is injected by the server only when a measurement ID is
 * configured (see api-server/src/lib/seo.ts), so `gtag` is frequently absent —
 * in development, in preview builds, and on every admin page. The optional
 * call means the site behaves identically either way and a missing tag can
 * never throw in the middle of a booking enquiry.
 *
 * NEVER pass personal data. No name, phone, email or free-text request may be
 * sent to GA4: it breaks Google's terms and it is a privacy problem. Counts,
 * dates and placement labels only.
 */
export function track(name: string, params: Record<string, unknown> = {}): void {
  (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.(
    'event',
    name,
    params,
  );
}

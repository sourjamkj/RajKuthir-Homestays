/**
 * Per-page metadata, injected into index.html on the way out.
 *
 * WHY THIS EXISTS
 *
 * The site is a client-rendered SPA: app.ts answered every non-API GET with the
 * same index.html, so every URL on the domain returned byte-identical HTML —
 * one title, one description, one Open Graph image, all of them the homepage's.
 * Pages set `document.title` in a useEffect, which only runs after JavaScript
 * does.
 *
 * That is fine for a person and useless for a crawler. Facebook, WhatsApp and
 * X do not execute JavaScript at all, so every link ever shared — of any page —
 * previews as the homepage. In this market WhatsApp is how an accommodation
 * link actually travels, so that alone is worth fixing. Google does render JS,
 * but on a delay and unreliably, and it treats the served HTML as the primary
 * signal.
 *
 * Injecting server-side costs one string replace per request and makes every
 * page genuinely distinct to crawlers, without adding a rendering framework.
 *
 * THIS FILE IS THE ROUTE TABLE OF RECORD.
 *
 * `CLIENT_ROUTES` below must mirror the <Route> list in
 * artifacts/raj-kuthir/src/App.tsx. A path missing from it still renders (the
 * SPA shell is served either way) but is answered with a 404 status. When you
 * add a route to App.tsx, add it here in the same change.
 */

export const SITE_ORIGIN = "https://rajkuthirhomestays.casa";

/**
 * Google Analytics, read from the environment rather than hardcoded.
 *
 * A GA4 measurement ID is a public identifier, not a secret, so the reason to
 * keep it out of the source is different: a hardcoded tag would also fire from
 * local and preview builds, quietly polluting production data with your own
 * traffic, and it would track the owner console alongside the guest site.
 *
 * Reading it here means analytics is off by default. With the variable unset
 * the site emits no tag and makes no request to Google at all — which is what
 * makes this safe to ship before the property exists.
 */
/** Measurement IDs look like G-XXXXXXXXXX. Validated because it goes into a
 *  <script> tag: a malformed or injected value must never be echoed there. */
const GA_ID_PATTERN = /^G-[A-Z0-9]{4,15}$/;

function analyticsTag(noindex: boolean | undefined): string[] {
  // Never track the owner console or the guest arrival pack.
  if (noindex) return [];

  // Read per call rather than at module load, so the behaviour is testable
  // and a variable change takes effect on restart without a rebuild.
  const id = process.env.GA4_MEASUREMENT_ID;
  if (!id || !GA_ID_PATTERN.test(id)) return [];

  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];` +
      `function gtag(){dataLayer.push(arguments)}` +
      `gtag('js',new Date());gtag('config','${id}');</script>`,
  ];
}

/**
 * The share card image.
 *
 * Landscape 1600x900 — WhatsApp, Facebook and X all crop tall images badly.
 * The dimensions are measured from the file itself, not assumed: declaring
 * them lets a scraper lay out the large card before it has fetched the image,
 * which is the difference between a rich preview and a bare link on a slow
 * connection.
 */
const DEFAULT_OG_IMAGE = {
  url: `${SITE_ORIGIN}/villa-night.jpg`,
  width: 1600,
  height: 900,
  alt: "Raj Kuthir Homestays, Sobuj Potro — the villa lit up after sundown",
} as const;

export type OgImage = {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
};

export type PageMeta = {
  title: string;
  description: string;
  ogImage?: OgImage;
  /** Kept out of the sitemap and marked noindex. */
  noindex?: boolean;
  /**
   * The date this page's visible content last changed, as YYYY-MM-DD.
   *
   * Bump it by hand when you change the copy, and only then. This used to be
   * generated as "today" on every request, which meant the sitemap claimed all
   * three pages had changed every single day for as long as the site was up.
   * Google's documented response to a lastmod it judges unreliable is to
   * ignore the field for the whole site, so an always-fresh date is worse than
   * no date at all. A slightly stale one costs nothing — it only means Google
   * is in no hurry to come back.
   *
   * Every page in the sitemap must carry one; a test asserts that, that the
   * form is right, and that nothing claims a date in the future.
   */
  lastmod?: string;
  /** Omitted from the sitemap when absent. */
  changefreq?: string;
  priority?: string;
  /**
   * Emitted as FAQPage structured data.
   *
   * Google requires FAQ markup to match what a visitor can actually read on
   * the page, so these must stay identical to the rendered questions and
   * answers. A test asserts every question here appears verbatim in the page
   * component; do not add an entry without adding it to the page too.
   */
  faq?: { q: string; a: string }[];
};

/**
 * The FAQ shown on /pet-friendly-homestay-shantiniketan, verbatim.
 * Source of truth for the visible copy is
 * artifacts/raj-kuthir/src/pages/PetFriendly.tsx — keep the two in step.
 */
const PET_FRIENDLY_FAQ = [
  {
    q: 'Are pets actually allowed, or just tolerated?',
    a: 'Genuinely allowed. Pets are written into our published house rules, not granted as an exception at the door. Tell us who is coming when you enquire so the caretaker can have the house ready.',
  },
  {
    q: 'Is the garden fenced?',
    a: 'We are not going to tell you the garden is escape-proof, because that depends entirely on your dog. Message us before you travel and describe them honestly — how they are off-lead, whether they bolt — and we will tell you plainly what to expect rather than guess on a web page.',
  },
  {
    q: 'Is there an extra charge for bringing a pet?',
    a: 'Confirm it with us when you enquire — rates vary by dates and occupancy, so anything quoted here would be out of date. What is already published is the damage side: pet damage or soiling is charged from ₹1,000, and that is on the house rules page along with everything else.',
  },
  {
    q: 'Can we leave our dog in the villa while we go out?',
    a: 'The whole villa is yours, so there is no lobby or corridor to worry about. The thing to think about is noise: the bungalows here sit close together and their owners live in them, so a dog that barks when left alone is a real problem. Talk to the caretaker about your plans for the day.',
  },
  {
    q: 'How do we get there with a pet?',
    a: 'There is parking on the premises if you drive, which most guests travelling with a dog prefer. By train, Prantik station is about 5 km away and Bolpur Shantiniketan about 9 km — Prantik is the closer of the two, which surprises most people.',
  },
  {
    q: 'Where do we eat if we would rather not leave the pet alone?',
    a: 'Cafe Soi is on the premises. The villa also has a refrigerator, microwave, water filter and basic utensils for simple meals, home-cooked food can be arranged through the caretaker, and Zomato delivers to the area subject to the usual conditions.',
  },
];

/**
 * Written for a person deciding where to stay, not for a keyword counter.
 * Titles stay under ~60 characters and descriptions under ~155 so neither is
 * truncated in results.
 */
export const PAGES: Record<string, PageMeta> = {
  "/": {
    title: "Private 2BHK Villa in Shantiniketan | Raj Kuthir Homestays",
    description:
      "An entire two-bedroom villa with a private garden in Bolpur, Shantiniketan. Pet-friendly, family-friendly, and bookable direct with the owner.",
    lastmod: "2026-09-11",
    changefreq: "weekly",
    priority: "1.0",
  },
  "/pet-friendly-homestay-shantiniketan": {
    title: "Pet-Friendly Villa in Shantiniketan | Raj Kuthir Homestays",
    description:
      "Bring the dog. A private two-bedroom villa with its own garden in Bolpur, Shantiniketan — the whole house is yours, and pets are in our published house rules.",
    ogImage: {
      url: `${SITE_ORIGIN}/villa-day.jpg`,
      width: 1536,
      height: 1024,
      alt: "Raj Kuthir Homestays, Sobuj Potro, seen from the garden in daylight",
    },
    lastmod: "2026-09-10",
    changefreq: "monthly",
    priority: "0.9",
    faq: PET_FRIENDLY_FAQ,
  },
  "/gallery": {
    title: "Villa Photos in Shantiniketan | Raj Kuthir Homestays",
    description:
      "Every room, the garden and the walk outside \u2014 photographs of Sobuj Potro, the two-bedroom villa at Raj Kuthir Homestays in Bolpur, Shantiniketan.",
    ogImage: {
      url: `${SITE_ORIGIN}/External%20Villa%20Morning.jpg`,
      width: 1448,
      height: 1086,
      alt: "Raj Kuthir Homestays, Sobuj Potro, from the garden on a clear morning",
    },
    lastmod: "2026-09-11",
    changefreq: "monthly",
    priority: "0.6",
  },
  "/house-rules": {
    title: "House Rules | Raj Kuthir Homestays, Shantiniketan",
    description:
      "Check-in and check-out times, our pet and smoking policy, and what we ask of guests — published in full before you book, so nothing is a surprise.",
    lastmod: "2026-09-04",
    changefreq: "yearly",
    priority: "0.4",
  },

  // Guest-only. Nothing here should ever appear in a search result.
  "/welcome": {
    title: "Your stay | Raj Kuthir Homestays",
    description: "Arrival details for guests with a confirmed booking.",
    noindex: true,
  },
};

/** Admin and any private area: never indexed, never in the sitemap. */
const PRIVATE_PREFIXES = ["/admin", "/sign-in", "/welcome"];

/**
 * Every path App.tsx has a <Route> for. Anything else is a genuine 404 and is
 * answered as one — see the note at the top of this file.
 *
 * `/sign-in` is matched as a prefix because App.tsx registers it as
 * `/sign-in/*?` (a legacy path kept so old bookmarks still land somewhere).
 */
const CLIENT_ROUTES = new Set([
  "/",
  "/gallery",
  "/house-rules",
  "/pet-friendly-homestay-shantiniketan",
  "/welcome",
  "/admin",
  "/admin/login",
  "/admin/earnings",
  "/admin/rates",
  "/admin/guests",
  "/admin/guest-info",
]);

const CLIENT_ROUTE_PREFIXES = ["/sign-in"];

export function isPrivatePath(pathname: string): boolean {
  const path = normalisePath(pathname);
  return PRIVATE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** True when the SPA has a route for this path. Drives the HTTP status. */
export function isKnownPath(pathname: string): boolean {
  const path = normalisePath(pathname);

  if (CLIENT_ROUTES.has(path)) return true;

  return CLIENT_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Trailing slashes collapsed, so /house-rules/ and /house-rules are one page. */
export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Owner console and other private areas that have no page entry of their own. */
const PRIVATE_META: PageMeta = {
  title: "Owner console | Raj Kuthir Homestays",
  description: "Private area. Sign-in required.",
  noindex: true,
};

/** Anything with no route at all. Served with a 404 status by app.ts. */
const NOT_FOUND_META: PageMeta = {
  title: "Page not found | Raj Kuthir Homestays",
  description:
    "This page does not exist. Head back to the homestay for rooms, rates and availability.",
  noindex: true,
};

export function metaFor(pathname: string): PageMeta {
  const path = normalisePath(pathname);

  const exact = PAGES[path];
  if (exact) return exact;

  // Private but not separately described (e.g. /admin/rates).
  if (isPrivatePath(path)) return PRIVATE_META;

  // No route at all. Never invite indexing of something we did not describe.
  return NOT_FOUND_META;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Structured data, using ONLY facts that are already on the site or in the
 * owner's own listings.
 *
 * Deliberately absent: aggregateRating, review counts, priceRange, star
 * rating, room dimensions, occupancy, opening hours and any amenity not
 * already published. Inventing any of those is a structured-data violation and
 * can cost the rich result entirely — and none of them are verified.
 *
 * The coordinates are the ones Google itself returns for the property's own
 * Maps listing, so they are not a guess. The images are the three largest
 * photographs in public/, at three different aspect ratios; anything under
 * 1200px on its long edge is left out, since Google ignores it anyway.
 */
function jsonLd(pathname: string): string {
  const path = normalisePath(pathname);

  const lodging = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    "@id": `${SITE_ORIGIN}/#lodging`,
    name: "Raj Kuthir Homestays – Sobuj Potro",
    url: SITE_ORIGIN,
    telephone: "+916290399165",
    image: [
      `${SITE_ORIGIN}/villa-night.jpg`,
      `${SITE_ORIGIN}/villa-day.jpg`,
      `${SITE_ORIGIN}/villa.jpg`,
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Bolpur",
      addressRegion: "West Bengal",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 23.7170162,
      longitude: 87.6656757,
    },
    petsAllowed: true,
    sameAs: [
      "https://www.instagram.com/rajkuthirhomestays/",
      "https://maps.app.goo.gl/D1tUUb3JfpVdcHwu5",
    ],
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_ORIGIN}/#website`,
    url: SITE_ORIGIN,
    name: "Raj Kuthir Homestays",
    publisher: { "@id": `${SITE_ORIGIN}/#lodging` },
  };

  const graph: unknown[] = [lodging, website];

  /**
   * FAQPage, only when the page genuinely renders those questions. Marking up
   * questions a visitor cannot see is a structured-data violation and Google
   * will drop the rich result for the whole page, not just the FAQ.
   */
  const faq = metaFor(path).faq;
  if (faq?.length) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${SITE_ORIGIN}${path}#faq`,
      mainEntity: faq.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }

  if (path !== "/") {
    graph.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "@id": `${SITE_ORIGIN}${path}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: `${SITE_ORIGIN}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: metaFor(path).title.split("|")[0]!.trim(),
          item: `${SITE_ORIGIN}${path}`,
        },
      ],
    });
  }

  // </script> inside JSON would close the tag early.
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

/**
 * Rewrites the <head> of the built index.html for one request.
 *
 * The build already emits a title, description, canonical and social tags for
 * the homepage; those are stripped and replaced rather than duplicated, since
 * two titles is worse than one wrong one. The strip pattern deliberately
 * catches og:image:width / og:image:height / og:image:alt as well, so those are
 * re-emitted here rather than being left behind pointing at the old image.
 */
export function injectMeta(html: string, pathname: string): string {
  const path = normalisePath(pathname);
  const meta = metaFor(path);
  const canonical = `${SITE_ORIGIN}${path === "/" ? "/" : path}`;
  const image = meta.ogImage ?? DEFAULT_OG_IMAGE;

  const head = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    meta.noindex
      ? `<meta name="robots" content="noindex, nofollow" />`
      : `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Raj Kuthir Homestays" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:image" content="${image.url}" />`,
    image.width ? `<meta property="og:image:width" content="${image.width}" />` : "",
    image.height
      ? `<meta property="og:image:height" content="${image.height}" />`
      : "",
    image.alt
      ? `<meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`
      : "",
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${image.url}" />`,
    image.alt
      ? `<meta name="twitter:image:alt" content="${escapeHtml(image.alt)}" />`
      : "",
    meta.noindex
      ? ""
      : `<script type="application/ld+json">${jsonLd(path)}</script>`,
    ...analyticsTag(meta.noindex),
  ]
    .filter(Boolean)
    .join("\n    ");

  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(
      /\s*<meta\s+(?:name|property)="(?:description|robots|og:[^"]*|twitter:[^"]*)"[^>]*>/gi,
      "",
    )
    .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, "")
    // Any JSON-LD baked into the build would compete with the block below.
    .replace(
      /\s*<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(/<\/head>/i, `  ${head}\n  </head>`);
}

/**
 * Only pages we have deliberately described, and never a private one.
 *
 * Takes no clock: every date in here comes from the page's own `lastmod`, so
 * the same commit always produces the same sitemap and a page is only ever
 * announced as changed when it actually has.
 */
export function sitemapXml(): string {
  const urls = Object.entries(PAGES)
    .filter(([path, meta]) => !meta.noindex && !isPrivatePath(path))
    .map(([path, meta]) =>
      [
        "  <url>",
        `    <loc>${SITE_ORIGIN}${path === "/" ? "/" : path}</loc>`,
        meta.lastmod ? `    <lastmod>${meta.lastmod}</lastmod>` : "",
        meta.changefreq ? `    <changefreq>${meta.changefreq}</changefreq>` : "",
        meta.priority ? `    <priority>${meta.priority}</priority>` : "",
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

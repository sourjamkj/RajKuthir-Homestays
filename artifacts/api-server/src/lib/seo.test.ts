import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAGES,
  SITE_ORIGIN,
  injectMeta,
  isKnownPath,
  isPrivatePath,
  metaFor,
  normalisePath,
  sitemapXml,
} from "./seo.ts";

/**
 * Verification suite for the server-rendered metadata layer.
 *
 * These are not unit tests of convenience — they are the evidence that every
 * public URL is genuinely distinct to a crawler, that nothing private can leak
 * into an index, and that the structured data claims only facts we hold.
 *
 * Run with:  node --test src/lib/
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const clientRoot = path.join(repoRoot, "artifacts/raj-kuthir");

/** The real source index.html — the same <head> Vite carries into the build. */
const BASE_HTML = readFileSync(path.join(clientRoot, "index.html"), "utf8");

const ROBOTS_TXT = readFileSync(
  path.join(clientRoot, "public/robots.txt"),
  "utf8",
);

const APP_TSX = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");

/** The rendered pet-friendly landing page, read so FAQ markup can be checked
 *  against copy a visitor can actually see. */
const PET_PAGE_TSX = readFileSync(
  path.join(clientRoot, "src/pages/PetFriendly.tsx"),
  "utf8",
);

const PUBLIC_ROUTES = [
  "/",
  "/house-rules",
  "/pet-friendly-homestay-shantiniketan",
];
const PRIVATE_ROUTES = [
  "/welcome",
  "/admin",
  "/admin/login",
  "/admin/earnings",
  "/admin/rates",
  "/admin/guests",
  "/admin/guest-info",
  "/sign-in",
  "/sign-in/anything",
];
const UNKNOWN_ROUTES = ["/nope", "/blog/post-1", "/house-rules-extra"];

// ---------------------------------------------------------------- helpers

const render = (route: string) => injectMeta(BASE_HTML, route);

function all(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((m) => m[1] ?? "");
}

const titles = (html: string) => all(html, /<title>([\s\S]*?)<\/title>/gi);
const metaByName = (html: string, name: string) =>
  all(html, new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "gi"));
const metaByProp = (html: string, prop: string) =>
  all(
    html,
    new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, "gi"),
  );
const canonicals = (html: string) =>
  all(html, /<link\s+rel="canonical"\s+href="([^"]*)"/gi);
const ldBlocks = (html: string) =>
  all(
    html,
    /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
  );

const graphFor = (route: string): any[] => {
  const blocks = ldBlocks(render(route));
  assert.equal(blocks.length, 1, `${route}: expected exactly one JSON-LD block`);
  return JSON.parse(blocks[0]!);
};

// =========================================================== POINT 1
// Every public route produces genuinely route-specific metadata.

test("point 1 · every public route has a complete, non-empty tag set", () => {
  for (const route of PUBLIC_ROUTES) {
    const html = render(route);

    for (const [label, values] of [
      ["title", titles(html)],
      ["description", metaByName(html, "description")],
      ["canonical", canonicals(html)],
      ["og:title", metaByProp(html, "og:title")],
      ["og:description", metaByProp(html, "og:description")],
      ["og:image", metaByProp(html, "og:image")],
    ] as const) {
      assert.equal(values.length, 1, `${route}: expected exactly one ${label}`);
      assert.ok(values[0]!.trim().length > 0, `${route}: ${label} is empty`);
    }
  }
});

test("point 1 · no two public routes share a title, description or canonical", () => {
  const seen = { title: new Set(), description: new Set(), canonical: new Set() };

  for (const route of PUBLIC_ROUTES) {
    const html = render(route);
    const row = {
      title: titles(html)[0]!,
      description: metaByName(html, "description")[0]!,
      canonical: canonicals(html)[0]!,
    };

    for (const key of ["title", "description", "canonical"] as const) {
      assert.ok(
        !seen[key].has(row[key]),
        `${route}: ${key} duplicates another public route (${row[key]})`,
      );
      seen[key].add(row[key]);
    }
  }
});

test("point 1 · og and twitter tags mirror the page, not the homepage", () => {
  for (const route of PUBLIC_ROUTES) {
    const html = render(route);
    const title = titles(html)[0]!;
    const description = metaByName(html, "description")[0]!;

    assert.equal(metaByProp(html, "og:title")[0], title);
    assert.equal(metaByProp(html, "og:description")[0], description);
    assert.equal(metaByName(html, "twitter:title")[0], title);
    assert.equal(metaByName(html, "twitter:description")[0], description);
    assert.equal(metaByProp(html, "og:url")[0], canonicals(html)[0]);
  }
});

test("point 1 · the build's homepage tags are replaced, never duplicated", () => {
  // The source index.html ships a homepage title, description, canonical and a
  // full og/twitter set. A house-rules render must carry none of them.
  const html = render("/house-rules");

  assert.equal(titles(html).length, 1);
  assert.equal(metaByName(html, "description").length, 1);
  assert.equal(canonicals(html).length, 1);
  assert.equal(metaByProp(html, "og:image").length, 1);
  assert.equal(metaByProp(html, "og:image:width").length, 1);
  assert.equal(metaByProp(html, "og:image:height").length, 1);
  assert.equal(metaByProp(html, "og:image:alt").length, 1);

  assert.ok(
    !html.includes("Pet-Friendly Homestay in Shantiniketan"),
    "the build's homepage title survived into an inner page",
  );
});

test("point 1 · canonicals are absolute, https and trailing-slash normalised", () => {
  assert.equal(canonicals(render("/"))[0], `${SITE_ORIGIN}/`);
  assert.equal(
    canonicals(render("/house-rules"))[0],
    `${SITE_ORIGIN}/house-rules`,
  );
  assert.equal(
    canonicals(render("/house-rules/"))[0],
    canonicals(render("/house-rules"))[0],
    "/house-rules/ and /house-rules must canonicalise to one URL",
  );
  assert.equal(normalisePath("/house-rules///"), "/house-rules");
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath(""), "/");
});

test("point 1 · titles and descriptions fit the SERP without truncation", () => {
  for (const [route, meta] of Object.entries(PAGES)) {
    assert.ok(
      meta.title.length <= 65,
      `${route}: title is ${meta.title.length} chars and will be cut off`,
    );
    assert.ok(
      meta.description.length <= 160,
      `${route}: description is ${meta.description.length} chars and will be cut off`,
    );
  }
});

test("point 1 · the share image is declared with real dimensions", () => {
  const html = render("/");
  assert.equal(
    metaByProp(html, "og:image")[0],
    `${SITE_ORIGIN}/villa-night.jpg`,
  );
  // Measured from the file itself, not assumed.
  assert.equal(metaByProp(html, "og:image:width")[0], "1600");
  assert.equal(metaByProp(html, "og:image:height")[0], "900");
  assert.ok(metaByProp(html, "og:image:alt")[0]!.length > 10);
  assert.equal(metaByName(html, "twitter:card")[0], "summary_large_image");
});

// =========================================================== POINT 2
// The sitemap contains only intended, indexable URLs.

test("point 2 · the sitemap lists exactly the public, indexable pages", () => {
  const xml = sitemapXml();
  const locs = all(xml, /<loc>([^<]*)<\/loc>/g);

  assert.deepEqual(locs.sort(), [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/house-rules`,
    `${SITE_ORIGIN}/pet-friendly-homestay-shantiniketan`,
  ]);
  assert.equal(new Set(locs).size, locs.length, "duplicate <loc> in sitemap");
});

test("point 2 · nothing private or noindex can reach the sitemap", () => {
  const xml = sitemapXml();

  for (const route of PRIVATE_ROUTES) {
    assert.ok(
      !xml.includes(`${SITE_ORIGIN}${route}`),
      `private route ${route} appears in the sitemap`,
    );
  }

  for (const loc of all(xml, /<loc>([^<]*)<\/loc>/g)) {
    const route = loc.replace(SITE_ORIGIN, "") || "/";
    assert.ok(!isPrivatePath(route), `${route} is private but listed`);
    assert.ok(isKnownPath(route), `${route} is listed but has no client route`);
    assert.ok(!metaFor(route).noindex, `${route} is noindex but listed`);
  }
});

test("point 2 · the sitemap is well-formed and correctly namespaced", () => {
  const xml = sitemapXml();

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(
    xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
  );
  assert.equal(
    (xml.match(/<url>/g) ?? []).length,
    (xml.match(/<\/url>/g) ?? []).length,
    "unbalanced <url> elements",
  );
  for (const lastmod of all(xml, /<lastmod>([^<]*)<\/lastmod>/g)) {
    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, "lastmod is not W3C date form");
  }
  for (const priority of all(xml, /<priority>([^<]*)<\/priority>/g)) {
    const value = Number(priority);
    assert.ok(value >= 0 && value <= 1, `priority ${priority} out of range`);
  }
});

test("point 2 · every listed page declares its own lastmod", () => {
  const xml = sitemapXml();
  const urls = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];

  assert.ok(urls.length > 0, "sitemap has no <url> entries at all");
  for (const url of urls) {
    const loc = url.match(/<loc>([^<]*)<\/loc>/)?.[1];
    assert.match(
      url,
      /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/,
      `${loc} has no usable lastmod`,
    );
  }

  // The value must come from the page, not from a clock. Two calls a day
  // apart have to agree, or we are back to telling Google that everything
  // changed today — which is the fastest way to have the field ignored.
  for (const [route, meta] of Object.entries(PAGES)) {
    if (meta.noindex || isPrivatePath(route)) continue;
    assert.ok(meta.lastmod, `${route} is in the sitemap with no lastmod`);
    assert.ok(
      xml.includes(`<lastmod>${meta.lastmod}</lastmod>`),
      `${route}'s lastmod ${meta.lastmod} is not what the sitemap emitted`,
    );
  }
});

test("point 2 · no page claims to have changed in the future", () => {
  // A lastmod ahead of now is the other way to lose the signal: a crawler
  // that reads a future date treats the whole file as untrustworthy.
  const today = new Date().toISOString().slice(0, 10);

  for (const [route, meta] of Object.entries(PAGES)) {
    if (!meta.lastmod) continue;
    assert.match(
      meta.lastmod,
      /^\d{4}-\d{2}-\d{2}$/,
      `${route} lastmod "${meta.lastmod}" is not a W3C date`,
    );
    assert.ok(
      !Number.isNaN(Date.parse(meta.lastmod)),
      `${route} lastmod "${meta.lastmod}" is not a real date`,
    );
    assert.ok(
      meta.lastmod <= today,
      `${route} claims to have changed on ${meta.lastmod}, which is after ${today}`,
    );
  }
});

test("point 2 · a noindex page carries no lastmod to leak", () => {
  for (const [route, meta] of Object.entries(PAGES)) {
    if (!meta.noindex) continue;
    assert.ok(
      !meta.lastmod,
      `${route} is noindex but carries a lastmod — it will never be emitted`,
    );
  }
});

// =========================================================== POINT 3
// robots.txt excludes every private area.

test("point 3 · robots.txt disallows every private area and the API", () => {
  for (const rule of ["/admin", "/sign-in", "/welcome", "/api/"]) {
    assert.match(
      ROBOTS_TXT,
      new RegExp(`^Disallow: ${rule.replace("/", "\\/")}\\s*$`, "m"),
      `robots.txt is missing "Disallow: ${rule}"`,
    );
  }
});

test("point 3 · every private prefix in code has a matching robots rule", () => {
  // Cross-check, so adding a private area to seo.ts without touching
  // robots.txt fails here rather than showing up in a search result.
  for (const route of PRIVATE_ROUTES) {
    const top = `/${normalisePath(route).split("/")[1]}`;
    assert.ok(
      ROBOTS_TXT.includes(`Disallow: ${top}`),
      `private route ${route} has no robots.txt rule for ${top}`,
    );
  }
});

test("point 3 · robots.txt declares the sitemap on this origin", () => {
  assert.match(
    ROBOTS_TXT,
    new RegExp(`^Sitemap: ${SITE_ORIGIN}/sitemap\\.xml\\s*$`, "m"),
  );
});

test("point 3 · the sign-in route really is /sign-in, not /signin", () => {
  // Guards against disallowing a path that does not exist while the real one
  // stays open.
  assert.ok(APP_TSX.includes('path="/sign-in'), "App.tsx no longer has /sign-in");
  assert.ok(!/path="\/signin"/.test(APP_TSX), "App.tsx now has a /signin route");
  assert.ok(isPrivatePath("/sign-in"));
  assert.ok(isPrivatePath("/sign-in/callback"));
});

// =========================================================== POINT 4
// LodgingBusiness structured data claims only verified facts.

test("point 4 · LodgingBusiness carries the facts we hold", () => {
  const lodging = graphFor("/").find(
    (node: any) => node["@type"] === "LodgingBusiness",
  );

  assert.ok(lodging, "no LodgingBusiness node");
  assert.equal(lodging.name, "Raj Kuthir Homestays – Sobuj Potro");
  assert.equal(lodging.url, SITE_ORIGIN);
  assert.equal(lodging.telephone, "+916290399165");
  assert.equal(lodging.petsAllowed, true);
  assert.equal(lodging.address["@type"], "PostalAddress");
  assert.equal(lodging.address.addressLocality, "Bolpur");
  assert.equal(lodging.address.addressRegion, "West Bengal");
  assert.equal(lodging.address.addressCountry, "IN");
  assert.equal(lodging.geo.latitude, 23.7170162);
  assert.equal(lodging.geo.longitude, 87.6656757);
});

test("point 4 · nothing unverified is asserted about the property", () => {
  const forbidden = [
    "aggregateRating",
    "ratingValue",
    "reviewCount",
    "review",
    "priceRange",
    "starRating",
    "openingHours",
    "openingHoursSpecification",
    "checkinTime",
    "checkoutTime",
    "numberOfRooms",
    "occupancy",
    "maximumAttendeeCapacity",
    "amenityFeature",
    "floorSize",
    "streetAddress",
    "postalCode",
    "makesOffer",
    "offers",
  ];

  for (const route of PUBLIC_ROUTES) {
    const raw = JSON.stringify(graphFor(route));
    for (const key of forbidden) {
      assert.ok(
        !raw.includes(`"${key}"`),
        `${route}: structured data asserts "${key}", which is not verified`,
      );
    }
  }
});

test("point 4 · every image and sameAs URL is absolute and https", () => {
  const lodging = graphFor("/").find(
    (n: any) => n["@type"] === "LodgingBusiness",
  );

  assert.ok(Array.isArray(lodging.image) && lodging.image.length >= 1);
  for (const url of [...lodging.image, ...lodging.sameAs, lodging.url]) {
    assert.match(url, /^https:\/\//, `${url} is not an absolute https URL`);
  }
  // Referenced files must exist in public/, or the card shows a broken image.
  for (const url of lodging.image) {
    const file = url.replace(`${SITE_ORIGIN}/`, "");
    assert.ok(
      readFileSync(path.join(clientRoot, "public", file)).length > 0,
      `${file} is referenced by the structured data but missing from public/`,
    );
  }
});

// =========================================================== POINT 5
// JSON-LD is syntactically valid with nothing duplicated or conflicting.

test("point 5 · JSON-LD parses and is safely escaped", () => {
  for (const route of PUBLIC_ROUTES) {
    const block = ldBlocks(render(route))[0]!;

    assert.doesNotThrow(() => JSON.parse(block), `${route}: JSON-LD is invalid`);
    assert.ok(
      !block.includes("</script"),
      `${route}: a literal </script> would close the tag early`,
    );

    for (const node of JSON.parse(block)) {
      assert.equal(node["@context"], "https://schema.org");
      assert.ok(typeof node["@type"] === "string" && node["@type"].length > 0);
    }
  }
});

test("point 5 · no duplicate or conflicting nodes in the graph", () => {
  for (const route of PUBLIC_ROUTES) {
    const graph = graphFor(route);

    const ids = graph.map((n: any) => n["@id"]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${route}: duplicate @id`);

    for (const type of ["LodgingBusiness", "WebSite"]) {
      assert.equal(
        graph.filter((n: any) => n["@type"] === type).length,
        1,
        `${route}: expected exactly one ${type} node`,
      );
    }
  }
});

test("point 5 · a JSON-LD block already in the build is replaced, not joined", () => {
  const polluted = BASE_HTML.replace(
    "</head>",
    '<script type="application/ld+json">{"@type":"Hotel","priceRange":"$$"}</script></head>',
  );
  const html = injectMeta(polluted, "/");

  assert.equal(ldBlocks(html).length, 1, "two competing JSON-LD blocks");
  assert.ok(!html.includes('"Hotel"'), "the stale Hotel node survived");
  assert.ok(!html.includes("priceRange"), "a priceRange claim survived");
});

test("point 5 · breadcrumbs appear on inner pages only", () => {
  const home = graphFor("/");
  assert.ok(!home.some((n: any) => n["@type"] === "BreadcrumbList"));

  const inner = graphFor("/house-rules");
  const crumb = inner.find((n: any) => n["@type"] === "BreadcrumbList");
  assert.ok(crumb, "no BreadcrumbList on /house-rules");
  assert.equal(crumb.itemListElement.length, 2);
  assert.equal(crumb.itemListElement[0].item, `${SITE_ORIGIN}/`);
  assert.equal(
    crumb.itemListElement[1].item,
    `${SITE_ORIGIN}/house-rules`,
  );
  assert.equal(crumb.itemListElement[0].position, 1);
  assert.equal(crumb.itemListElement[1].position, 2);
});

// ====================================================== FAQ MARKUP
// FAQPage is only legitimate when a visitor can read the same questions.

test("faq · every marked-up question appears verbatim on the rendered page", () => {
  const faq = PAGES["/pet-friendly-homestay-shantiniketan"]!.faq;
  assert.ok(faq?.length, "the pet-friendly page declares no FAQ");

  for (const { q, a } of faq) {
    assert.ok(
      PET_PAGE_TSX.includes(q),
      `FAQ markup asks "${q}" but PetFriendly.tsx does not render it`,
    );
    assert.ok(
      PET_PAGE_TSX.includes(a),
      `the answer to "${q}" is marked up but not rendered — Google treats that as a violation`,
    );
  }
});

test("faq · FAQPage is emitted, well-formed, and only where it belongs", () => {
  const graph = graphFor("/pet-friendly-homestay-shantiniketan");
  const faqNode = graph.find((n: any) => n["@type"] === "FAQPage");

  assert.ok(faqNode, "no FAQPage node on the pet-friendly page");
  assert.equal(faqNode.mainEntity.length, 6);

  for (const entry of faqNode.mainEntity) {
    assert.equal(entry["@type"], "Question");
    assert.ok(entry.name.length > 5);
    assert.equal(entry.acceptedAnswer["@type"], "Answer");
    assert.ok(entry.acceptedAnswer.text.length > 20);
  }

  // Pages without a visible FAQ must not carry the markup.
  for (const route of ["/", "/house-rules"]) {
    assert.ok(
      !graphFor(route).some((n: any) => n["@type"] === "FAQPage"),
      `${route} publishes FAQPage markup without a visible FAQ`,
    );
  }
});

test("faq · the landing page makes no claim we cannot stand behind", () => {
  // The owner explicitly ruled these out as unverified. If one ever appears in
  // the page copy, this fails before it reaches a guest deciding whether their
  // dog can travel.
  const forbidden = [
    "fenced garden",
    "securely fenced",
    "escape proof",
    "pet bed",
    "pet bowl",
    "veterinary",
    "vet on call",
    "bonfire",
    "no extra charge for pets",
    "any breed",
    "unlimited pets",
  ];

  const copy = PET_PAGE_TSX.toLowerCase();
  for (const claim of forbidden) {
    assert.ok(
      !copy.includes(claim),
      `PetFriendly.tsx claims "${claim}", which is not verified`,
    );
  }

  // ...and no superlatives anywhere on the page.
  assert.ok(
    !/\b(best|no\.? ?1|cheapest|finest|top[- ]rated|award[- ]winning|luxurious)\b/i.test(
      PET_PAGE_TSX.replace(/leading-\[?[\w./%-]+\]?/g, ""),
    ),
    "PetFriendly.tsx contains an unsupported superlative",
  );
});

// ====================================================== ANALYTICS
// The tag is environment-gated: absent unless an ID is configured, and never
// on a private page.

const gaTags = (html: string) =>
  (html.match(/googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)/g) ?? []);

test("analytics · nothing is emitted when no measurement ID is configured", () => {
  const previous = process.env.GA4_MEASUREMENT_ID;
  delete process.env.GA4_MEASUREMENT_ID;
  try {
    for (const route of [...PUBLIC_ROUTES, ...PRIVATE_ROUTES]) {
      const html = render(route);
      assert.equal(gaTags(html).length, 0, `${route}: emitted a tag with no ID set`);
      assert.ok(
        !html.includes("googletagmanager"),
        `${route}: contacts Google with analytics unconfigured`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.GA4_MEASUREMENT_ID;
    else process.env.GA4_MEASUREMENT_ID = previous;
  }
});

test("analytics · a configured ID is emitted on public pages only", () => {
  const previous = process.env.GA4_MEASUREMENT_ID;
  process.env.GA4_MEASUREMENT_ID = "G-TESTID12345";
  try {
    for (const route of PUBLIC_ROUTES) {
      const html = render(route);
      assert.equal(gaTags(html).length, 1, `${route}: expected exactly one tag`);
      assert.ok(html.includes("gtag('config','G-TESTID12345')"));
    }

    // The owner console and the guest arrival pack are never tracked.
    for (const route of PRIVATE_ROUTES) {
      assert.equal(
        gaTags(render(route)).length,
        0,
        `${route} is private but carries the analytics tag`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.GA4_MEASUREMENT_ID;
    else process.env.GA4_MEASUREMENT_ID = previous;
  }
});

test("analytics · a malformed ID is refused rather than echoed into a script", () => {
  const previous = process.env.GA4_MEASUREMENT_ID;
  try {
    for (const bad of [
      "",
      "UA-12345-1",
      "G-",
      "not-an-id",
      "G-ABC'); alert(1); //",
      "<script>alert(1)</script>",
    ]) {
      process.env.GA4_MEASUREMENT_ID = bad;
      const html = render("/");
      assert.equal(
        gaTags(html).length,
        0,
        `a malformed ID (${JSON.stringify(bad)}) was emitted`,
      );
      assert.ok(!html.includes("alert(1)"), "script injection reached the page");
    }
  } finally {
    if (previous === undefined) delete process.env.GA4_MEASUREMENT_ID;
    else process.env.GA4_MEASUREMENT_ID = previous;
  }
});

// =========================================================== POINT 8
// Private and unknown pages cannot become indexable.

test("point 8 · every private route is noindex and carries no structured data", () => {
  for (const route of PRIVATE_ROUTES) {
    const html = render(route);

    assert.ok(isPrivatePath(route), `${route} is not classified as private`);
    assert.equal(
      metaByName(html, "robots")[0],
      "noindex, nofollow",
      `${route} is not noindex`,
    );
    assert.equal(
      ldBlocks(html).length,
      0,
      `${route} publishes structured data`,
    );
  }
});

test("point 8 · unknown routes are noindex and are not treated as pages", () => {
  for (const route of UNKNOWN_ROUTES) {
    const html = render(route);

    assert.equal(metaByName(html, "robots")[0], "noindex, nofollow");
    assert.equal(ldBlocks(html).length, 0);
    assert.ok(!isKnownPath(route), `${route} is wrongly treated as a route`);
    assert.match(titles(html)[0]!, /Page not found/);
  }
});

test("point 8 · trailing slashes and sub-paths cannot slip past the private check", () => {
  for (const variant of [
    "/admin/",
    "/admin//",
    "/admin/rates",
    "/welcome/",
    "/sign-in/",
    "/sign-in/callback",
  ]) {
    assert.ok(isPrivatePath(variant), `${variant} escaped the private check`);
    assert.equal(metaByName(render(variant), "robots")[0], "noindex, nofollow");
  }

  // ...and a public page that merely starts with the same letters must not be
  // caught by it.
  assert.ok(!isPrivatePath("/administration-of-tagore"));
  assert.ok(!isPrivatePath("/welcomes"));
});

test("point 8 · public routes are the only ones inviting a crawler", () => {
  for (const route of PUBLIC_ROUTES) {
    assert.equal(
      metaByName(render(route), "robots")[0],
      "index, follow, max-image-preview:large",
    );
  }
});

// =========================================================== ROUTE PARITY
// seo.ts is the route table of record; prove it still matches App.tsx.

test("route parity · every <Route> in App.tsx is known to seo.ts", () => {
  const declared = [...APP_TSX.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1]!)
    // wouter wildcards: /sign-in/*? means the prefix itself plus anything under it
    .map((p) => p.replace(/\/\*\??$/, ""));

  assert.ok(declared.length >= 9, "App.tsx route list looks truncated");

  for (const route of declared) {
    assert.ok(
      isKnownPath(route),
      `App.tsx routes ${route} but seo.ts would answer it with a 404 status`,
    );
  }
});

test("route parity · every public page in seo.ts is a real client route", () => {
  for (const route of Object.keys(PAGES)) {
    assert.ok(
      isKnownPath(route),
      `seo.ts describes ${route} but App.tsx has no route for it — it would 404`,
    );
  }
});

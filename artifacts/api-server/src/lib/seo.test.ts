import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MOBILE_PATTERN } from "./phone.ts";
import {
  PAGES,
  SITE_ORIGIN,
  VERIFIED_AMENITIES,
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

/** The gallery page, read so every photograph can be checked for alt text and
 *  measured dimensions. */
const GALLERY_PAGE_TSX = readFileSync(
  path.join(clientRoot, "src/pages/Gallery.tsx"),
  "utf8",
);

/** app.ts, read so the wiring that serves the homepage can be asserted. */
const APP_TS = readFileSync(path.join(here, "../app.ts"), "utf8");

/**
 * Every indexable page, derived from the route table rather than typed out.
 *
 * This used to be a hand-written list of three while seo.ts had grown to six,
 * so every test iterating it — unique titles, complete tags, nothing
 * unverified — silently skipped /gallery, /our-story and the places page.
 * Deriving it means a new page is covered the moment it is described.
 */
const PUBLIC_ROUTES = Object.entries(PAGES)
  .filter(([route, meta]) => !meta.noindex && !isPrivatePath(route))
  .map(([route]) => route);
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
  // The real shell is neutral now, but a shell that DID carry the homepage's
  // tags — an older build, a careless edit — must still come out clean.
  const polluted = BASE_HTML.replace(
    "</head>",
    [
      "<title>Homepage title</title>",
      '<meta name="description" content="Homepage description" />',
      `<link rel="canonical" href="${SITE_ORIGIN}/" />`,
      `<meta property="og:url" content="${SITE_ORIGIN}/" />`,
      '<link rel="preload" as="image" href="/villa-night.jpg" />',
      "</head>",
    ].join("\n"),
  );
  const html = injectMeta(polluted, "/house-rules");

  assert.equal(titles(html).length, 1);
  assert.equal(metaByName(html, "description").length, 1);
  assert.equal(canonicals(html).length, 1);
  assert.equal(canonicals(html)[0], `${SITE_ORIGIN}/house-rules`);
  assert.equal(metaByProp(html, "og:url").length, 1);
  assert.equal(metaByProp(html, "og:image").length, 1);
  assert.equal(metaByProp(html, "og:image:width").length, 1);
  assert.equal(metaByProp(html, "og:image:height").length, 1);
  assert.equal(metaByProp(html, "og:image:alt").length, 1);

  assert.ok(!html.includes("Homepage title"), "a stale title survived");
  assert.ok(!html.includes("Homepage description"), "a stale description survived");
  assert.ok(!/rel="preload"/.test(html), "the homepage preload leaked into an inner page");
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
    `${SITE_ORIGIN}/gallery`,
    `${SITE_ORIGIN}/house-rules`,
    `${SITE_ORIGIN}/our-story`,
    `${SITE_ORIGIN}/pet-friendly-homestay-shantiniketan`,
    `${SITE_ORIGIN}/places-to-visit-in-shantiniketan`,
    `${SITE_ORIGIN}/rates`,
  ]);
  assert.equal(new Set(locs).size, locs.length, "duplicate <loc> in sitemap");
});

test("point 2 · every sitemap entry is loc and lastmod, and nothing else", () => {
  const xml = sitemapXml();
  const urls = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];

  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.match(url, /<loc>[^<]+<\/loc>/);
    assert.match(url, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    const children = [...url.matchAll(/<(\w+)>/g)].map((m) => m[1]).filter((t) => t !== "url");
    assert.deepEqual(children, ["loc", "lastmod"], `unexpected sitemap fields: ${url}`);
  }
  assert.ok(!xml.includes("<changefreq>"), "the sitemap still emits changefreq");
  assert.ok(!xml.includes("<priority>"), "the sitemap still emits priority");
});

test("point 2 · lastmod stays hand-maintained, with the homepage at its content date", () => {
  assert.equal(PAGES["/"]!.lastmod, "2026-09-14");
  // Not today's date on every page: if every lastmod were identical the field
  // would read as generated, which is how Google learns to ignore it.
  const dates = new Set(
    PUBLIC_ROUTES.map((route) => PAGES[route]!.lastmod),
  );
  assert.ok(dates.size > 1, "every page claims the same lastmod");
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
// robots.txt blocks the API, and lets crawlers read the private pages' noindex.

/** Every Disallow path in robots.txt, as written. */
const DISALLOWED = ROBOTS_TXT.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^disallow:/i.test(line))
  .map((line) => line.replace(/^disallow:\s*/i, ""));

/** Would robots.txt stop a crawler fetching this path? Prefix match, as crawlers do. */
const blockedByRobots = (route: string) =>
  DISALLOWED.some((rule) => rule !== "" && route.startsWith(rule));

test("point 3 · robots.txt keeps the API out", () => {
  assert.ok(DISALLOWED.includes("/api/"), 'robots.txt is missing "Disallow: /api/"');
  assert.ok(blockedByRobots("/api/rates"));
});

test("point 3 · robots.txt does not hide a private page's noindex from the crawler", () => {
  // A Disallow and a noindex on the same URL cancel each other out: the
  // crawler is forbidden to fetch the page, so it never reads the noindex, and
  // a disallowed URL linked from elsewhere can be indexed from the link alone.
  // The private areas are protected by sign-in and booking references, and
  // kept out of the index by the noindex below — not by robots.txt.
  for (const route of PRIVATE_ROUTES) {
    assert.ok(
      !blockedByRobots(route),
      `robots.txt blocks ${route}, so a crawler can never see that it is noindex`,
    );
    assert.equal(
      metaByName(render(route), "robots")[0],
      "noindex, nofollow",
      `${route} must still say noindex in the page itself`,
    );
  }
});

test("point 3 · private routes also send X-Robots-Tag, for crawlers that skip the HTML", () => {
  assert.match(
    APP_TS,
    /if \(isPrivatePath\(req\.path\)\) \{\s*res\.setHeader\("X-Robots-Tag", "noindex, nofollow"\);/,
    "app.ts no longer sends X-Robots-Tag: noindex on private routes",
  );
});

test("point 3 · no public page is blocked by robots.txt", () => {
  for (const route of PUBLIC_ROUTES) {
    assert.ok(!blockedByRobots(route), `robots.txt blocks public page ${route}`);
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
  assert.equal(lodging.geo.latitude, 23.7170162);
  assert.equal(lodging.geo.longitude, 87.6656757);
});

test("point 4 · the address is exactly the one the owner verified", () => {
  for (const route of PUBLIC_ROUTES) {
    const lodging = graphFor(route).find(
      (node: any) => node["@type"] === "LodgingBusiness",
    );
    assert.deepEqual(
      lodging.address,
      {
        "@type": "PostalAddress",
        streetAddress: "Dopati 148, Bolpur, Potro Bunglow, Sobuj, Bandh Nabagram",
        addressLocality: "Bolpur",
        addressRegion: "West Bengal",
        postalCode: "731235",
        addressCountry: "IN",
      },
      `${route}: address drifted from the verified one`,
    );
    // The Plus Code is a location code, not part of a street address.
    assert.ok(
      !JSON.stringify(lodging.address).includes("PM88"),
      `${route}: the Plus Code leaked into the postal address`,
    );
  }
});

test("point 4 · an Organization exists, once, and WebSite names it as publisher", () => {
  for (const route of PUBLIC_ROUTES) {
    const graph = graphFor(route);
    const orgs = graph.filter((n: any) => n["@type"] === "Organization");
    assert.equal(orgs.length, 1, `${route}: expected exactly one Organization`);

    const org = orgs[0];
    assert.equal(org["@id"], `${SITE_ORIGIN}/#organization`);
    assert.equal(org.name, "Raj Kuthir Homestays");
    assert.equal(org.url, `${SITE_ORIGIN}/`);

    const website = graph.find((n: any) => n["@type"] === "WebSite");
    assert.deepEqual(website.publisher, { "@id": org["@id"] });

    // Everything that points at the Organization points at a node that exists.
    const raw = JSON.stringify(graph);
    const ids = new Set(graph.map((n: any) => n["@id"]));
    for (const [, ref] of raw.matchAll(/\{"@id":"([^"]+)"\}/g)) {
      assert.ok(ids.has(ref), `${route}: reference to ${ref}, which is not in the graph`);
    }
  }
});

test("point 4 · LodgingBusiness describes the villa with the owner's confirmed figures", () => {
  const lodging = graphFor("/").find(
    (n: any) => n["@type"] === "LodgingBusiness",
  );

  assert.equal(lodging.checkinTime, "12:00:00+05:30");
  assert.equal(lodging.checkoutTime, "11:00:00+05:30");
  assert.deepEqual(lodging.parentOrganization, { "@id": `${SITE_ORIGIN}/#organization` });

  const villa = lodging.containsPlace;
  assert.equal(villa["@type"], "House");
  assert.equal(villa.numberOfBedrooms, 2);
  assert.equal(villa.numberOfBathroomsTotal, 2);
  assert.deepEqual(villa.bed, [
    { "@type": "BedDetails", numberOfBeds: 2, typeOfBed: "King bed" },
  ]);

  // The check-in and check-out times are the published ones.
  const rules = readFileSync(path.join(clientRoot, "src/pages/HouseRules.tsx"), "utf8");
  assert.ok(rules.includes("Check-in from 12:00 PM, check-out by 11:00 AM."));

  // And every room figure is written on the homepage, where a guest reads it.
  const copy = APP_TSX.toLowerCase();
  for (const phrase of ["two bedrooms, two king beds", "two bathrooms", "air conditioning in both bedrooms"]) {
    assert.ok(copy.includes(phrase), `the homepage no longer says "${phrase}"`);
  }
});

test("point 4 · no rating, review or VacationRental markup, anywhere", () => {
  for (const route of [...PUBLIC_ROUTES, ...PRIVATE_ROUTES, ...UNKNOWN_ROUTES]) {
    const html = render(route);
    for (const banned of ["aggregateRating", "VacationRental", '"Review"', "ratingValue"]) {
      assert.ok(!html.includes(banned), `${route}: emits ${banned}`);
    }
  }
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
    // numberOfRooms counts living and dining rooms too; the verified figure is
    // bedrooms, stated as numberOfBedrooms on the villa.
    "numberOfRooms",
    "occupancy",
    "maximumAttendeeCapacity",
    // amenityFeature is NOT banned outright: it is permitted, but only for
    // amenities the page publishes — see the dedicated test below, which is
    // stricter than a blanket ban because it checks each entry is real.
    "floorSize",
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

    for (const type of ["Organization", "LodgingBusiness", "WebSite"]) {
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

/** Which component renders which route, for the parity checks below. */
const PAGE_COMPONENTS: Record<string, string> = {
  "/pet-friendly-homestay-shantiniketan": "src/pages/PetFriendly.tsx",
  "/places-to-visit-in-shantiniketan": "src/pages/PlacesToVisit.tsx",
};

test("faq · every marked-up question appears verbatim on the rendered page", () => {
  const withFaq = Object.entries(PAGES).filter(([, meta]) => meta.faq?.length);
  assert.ok(withFaq.length >= 2, "expected at least two pages to carry an FAQ");

  for (const [route, meta] of withFaq) {
    const component = PAGE_COMPONENTS[route];
    assert.ok(
      component,
      `${route} declares an FAQ but PAGE_COMPONENTS does not say which file renders it`,
    );
    const source = readFileSync(path.join(clientRoot, component), "utf8");

    for (const { q, a } of meta.faq!) {
      assert.ok(
        source.includes(q),
        `FAQ markup for ${route} asks "${q}" but ${component} does not render it`,
      );
      assert.ok(
        source.includes(a),
        `the answer to "${q}" on ${route} is marked up but not rendered — Google treats that as a violation`,
      );
    }
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
    // Nothing of the homepage's identity, and no URL offered for indexing.
    assert.equal(canonicals(html).length, 0, `${route}: a 404 must not declare a canonical`);
    assert.equal(metaByProp(html, "og:url").length, 0);
    assert.ok(!html.includes(PAGES["/"]!.title), `${route}: carries the homepage title`);
    assert.ok(!html.includes(PAGES["/"]!.description), `${route}: carries the homepage description`);
  }
});

test("point 8 · unknown routes are answered with a real 404 status", () => {
  assert.match(
    APP_TS,
    /if \(!isKnownPath\(req\.path\)\) \{\s*res\.status\(404\);/,
    "app.ts no longer sets a 404 status for unknown routes",
  );
});

test("point 8 · a noindex page offers no canonical or og:url to index", () => {
  for (const route of PRIVATE_ROUTES) {
    const html = render(route);
    assert.equal(canonicals(html).length, 0, `${route} is noindex but declares a canonical`);
    assert.equal(metaByProp(html, "og:url").length, 0, `${route} is noindex but declares og:url`);
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

// =========================================================== POINT 9
// The homepage actually reaches the middleware that describes it.

test("point 9 · express.static does not answer / with the raw index.html", () => {
  // This is the one that bit us. express.static's default `index` option
  // serves index.html for a bare "/" straight off disk, so the homepage —
  // alone among every route — went out with the build's placeholder title, no
  // JSON-LD and no analytics tag, while /house-rules and the pet page were
  // injected correctly. The option must stay off.
  const call = APP_TS.match(/express\.static\([^)]*\)/s);

  assert.ok(call, "app.ts no longer calls express.static — update this test");
  assert.match(
    call[0],
    /index:\s*false/,
    "express.static is mounted without `index: false`, so / will be served " +
      "from disk and never reach injectMeta",
  );
});

test("point 9 · the homepage's own metadata is not the pet page's", () => {
  // The symptom that gave the bug away: / was serving the pet page's title.
  // Two URLs competing for one phrase is worth failing a build over.
  const titles = Object.entries(PAGES)
    .filter(([route, meta]) => !meta.noindex && !isPrivatePath(route))
    .map(([, meta]) => meta.title);

  assert.equal(
    new Set(titles).size,
    titles.length,
    "two indexable pages share a <title>",
  );
});

// =========================================================== POINT 10
// The gallery page: every photograph described, measured and deferred.

test("point 10 · every gallery photograph has alt text and real dimensions", () => {
  const entries = [...GALLERY_PAGE_TSX.matchAll(
    /\{\s*file: '([^']+)',\s*title: '([^']*)',\s*alt: '([^']*)',\s*width: (\d+),\s*height: (\d+),\s*\}/g,
  )];

  assert.ok(entries.length >= 10, `only ${entries.length} photographs parsed`);

  for (const [, file, title, alt, width, height] of entries) {
    assert.ok(title!.length > 2, `${file} has no caption`);
    assert.ok(
      alt!.length > 20,
      `${file} has alt text too short to describe it: "${alt}"`,
    );
    assert.ok(
      Number(width) > 0 && Number(height) > 0,
      `${file} has no usable dimensions`,
    );
    // A file listed here but missing from public/ is a broken image in prod.
    const onDisk = path.join(clientRoot, "public", decodeURIComponent(file!));
    assert.ok(
      readFileSync(onDisk).length > 0,
      `${file} is in the gallery but not in public/`,
    );
  }
});

test("point 10 · the homepage links to the gallery rather than inlining it", () => {
  assert.match(
    APP_TSX,
    /GALLERY_TEASER/,
    "the homepage no longer renders the gallery teaser",
  );
  assert.match(
    APP_TSX,
    /\$\{basePath\}\/gallery/,
    "the homepage has no link through to /gallery",
  );
  assert.ok(
    !APP_TSX.includes("filteredGallery"),
    "the old filtered gallery is still on the homepage",
  );
});

// =========================================================== POINT 11
// The enquiry form's phone rule is the same in the browser and on the server.

test("point 11 · the browser and the server agree on what a phone number is", () => {
  // Two copies of a validation rule always drift. When they do, the visible
  // symptom is a guest being told their number is fine and the enquiry
  // silently 400ing — or worse, the reverse. This is the guard.
  const attribute = /pattern="((?:[^"\\]|\\.)*)"/.exec(APP_TSX)?.[1];
  assert.ok(attribute, "the phone input no longer carries a pattern attribute");

  const browser = new RegExp(`^(?:${attribute})$`);
  const server = new RegExp(`^(?:${MOBILE_PATTERN})$`);

  const cases = [
    ["9876543210", true],
    ["+919876543210", true],
    ["91 9876543210", true],
    ["09876543210", true],
    ["6123456789", true],
    ["5123456789", false],  // Indian mobiles do not start below 6
    ["987654321", false],   // nine digits
    ["98765432101", false], // eleven
    ["1234567890", false],
    ["not a number", false],
    ["", false],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(
      browser.test(input),
      expected,
      `the browser pattern disagrees on "${input}"`,
    );
    assert.equal(
      server.test(input),
      expected,
      `the server pattern disagrees on "${input}"`,
    );
  }
});

// ========================================================== PHASE 1
// Search intent, verified amenities, headings, images and robots hygiene.

/**
 * The file that renders each indexable page.
 *
 * None of these pages import a shared component that renders its own heading
 * or image (only the crash fallback in error-boundary.tsx does), so scanning a
 * page's own source is an accurate picture of what it renders, not an
 * approximation. A test below fails if a public route is missing from here.
 */
const RENDERED_BY: Record<string, string> = {
  "/": "src/App.tsx",
  "/gallery": "src/pages/Gallery.tsx",
  "/our-story": "src/pages/OurStory.tsx",
  "/places-to-visit-in-shantiniketan": "src/pages/PlacesToVisit.tsx",
  "/house-rules": "src/pages/HouseRules.tsx",
  "/pet-friendly-homestay-shantiniketan": "src/pages/PetFriendly.tsx",
  "/rates": "src/pages/Rates.tsx",
};

const sourceOf = (route: string) =>
  readFileSync(path.join(clientRoot, RENDERED_BY[route]!), "utf8");

/**
 * Every <img ... /> in a source file, whole.
 *
 * Scans by hand rather than with one regex, tracking { } depth, so a JSX
 * expression such as alt={`…`} or width={photo.width} cannot end the tag
 * early and hide the attributes after it.
 */
function imgTags(source: string): string[] {
  const tags: string[] = [];
  let start = 0;
  while ((start = source.indexOf("<img", start)) !== -1) {
    const next = source[start + 4];
    if (!next || !/\s/.test(next)) {
      start += 4;
      continue;
    }
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === "/" && source[end + 1] === ">") break;
    }
    tags.push(source.slice(start, end + 2));
    start = end + 2;
  }
  return tags;
}

const hasAttr = (tag: string, name: string) =>
  new RegExp(`\\s${name}=`).test(tag);
const literalAlt = (tag: string) => tag.match(/\salt="([^"]*)"/)?.[1];

test("intent · every indexable page declares one primary search intent", () => {
  for (const route of PUBLIC_ROUTES) {
    const primary = PAGES[route]!.intent?.primary;
    assert.ok(primary?.trim(), `${route}: no primary search intent declared`);
  }
});

test("intent · no two pages compete for the same query", () => {
  // Primary and secondary alike: a page's secondary is still a query it is
  // trying to rank for, so it must not also be another page's target.
  const owner = new Map<string, string>();
  for (const route of PUBLIC_ROUTES) {
    const { primary, secondary = [] } = PAGES[route]!.intent!;
    for (const query of [primary, ...secondary]) {
      const key = query.toLowerCase().trim();
      assert.ok(
        !owner.has(key),
        `"${query}" is targeted by both ${owner.get(key)} and ${route}`,
      );
      owner.set(key, route);
    }
  }
});

test("amenities · every amenityFeature is something the homepage publishes", () => {
  const lodging = graphFor("/").find(
    (n: any) => n["@type"] === "LodgingBusiness",
  );
  const emitted = lodging.amenityFeature.map((f: any) => f.name);
  assert.deepEqual(emitted, [...VERIFIED_AMENITIES]);

  const copy = APP_TSX.toLowerCase();
  for (const name of VERIFIED_AMENITIES) {
    assert.ok(
      copy.includes(name.toLowerCase()),
      `"${name}" is marked up but not stated anywhere on the homepage`,
    );
  }
  for (const feature of lodging.amenityFeature) {
    assert.equal(feature["@type"], "LocationFeatureSpecification");
    assert.equal(feature.value, true);
  }
});

test("amenities · nothing the owner has not confirmed is claimed", () => {
  // Air conditioning, the bathrooms and the king beds were confirmed by the
  // owner and are now written on the homepage, so the markup may say them.
  // Anything below has not been confirmed and must not appear.
  for (const route of PUBLIC_ROUTES) {
    const raw = JSON.stringify(graphFor(route)).toLowerCase();
    for (const term of [
      "queen bed",
      "single bed",
      "sofa bed",
      "swimming pool",
      "breakfast",
      "free cancellation",
    ]) {
      assert.ok(
        !raw.includes(term),
        `${route}: structured data claims "${term}", which the site does not state`,
      );
    }
  }
});

test("breadcrumbs · inner pages use a short name of their own, not the title", () => {
  for (const route of PUBLIC_ROUTES.filter((r) => r !== "/")) {
    const crumb = graphFor(route).find(
      (n: any) => n["@type"] === "BreadcrumbList",
    );
    assert.ok(crumb, `${route}: no BreadcrumbList`);
    const name = crumb.itemListElement[1].name;
    assert.equal(name, PAGES[route]!.breadcrumb, `${route}: breadcrumb name drifted`);
    assert.ok(
      !name.includes("|") && name.length <= 30,
      `${route}: breadcrumb "${name}" reads like a page title`,
    );
  }
});

test("headings · every indexable page is mapped to the file that renders it", () => {
  for (const route of PUBLIC_ROUTES) {
    assert.ok(
      RENDERED_BY[route],
      `${route}: add it to RENDERED_BY so its headings and images are checked`,
    );
  }
});

test("headings · every indexable page has exactly one h1", () => {
  for (const route of PUBLIC_ROUTES) {
    const count = (sourceOf(route).match(/<h1[\s>]/g) ?? []).length;
    assert.equal(count, 1, `${route}: renders ${count} <h1> elements`);
  }
});

test("headings · levels open with h1 and never skip on the way down", () => {
  for (const route of PUBLIC_ROUTES) {
    const levels = [...sourceOf(route).matchAll(/<h([1-6])[\s>]/g)].map((m) =>
      Number(m[1]),
    );
    assert.equal(levels[0], 1, `${route}: the first heading is h${levels[0]}`);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(
        levels[i]! <= levels[i - 1]! + 1,
        `${route}: an h${levels[i - 1]} is followed by an h${levels[i]}`,
      );
    }
  }
});

test("images · every image on a public page has alt text and real dimensions", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const tag of imgTags(sourceOf(route))) {
      for (const attr of ["alt", "width", "height"]) {
        assert.ok(
          hasAttr(tag, attr),
          `${route}: <img> without ${attr}: ${tag.slice(0, 90)}`,
        );
      }
      const alt = literalAlt(tag);
      if (alt !== undefined) {
        assert.ok(alt.trim().length > 0, `${route}: an <img> has empty alt text`);
        assert.ok(alt.length <= 125, `${route}: alt text is ${alt.length} chars`);
      }
    }
  }
});

test("images · no two images on a page share the same written alt text", () => {
  for (const route of PUBLIC_ROUTES) {
    const alts = imgTags(sourceOf(route))
      .map(literalAlt)
      .filter((a): a is string => a !== undefined);
    const repeated = alts.filter((a, i) => alts.indexOf(a) !== i);
    assert.deepEqual(
      repeated,
      [],
      `${route}: alt text repeated — each image should say what it shows`,
    );
  }
});

test("images · every image declares a loading strategy and async decoding", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const tag of imgTags(sourceOf(route))) {
      assert.ok(
        hasAttr(tag, "loading"),
        `${route}: <img> without loading: ${tag.slice(0, 90)}`,
      );
      assert.ok(
        /\sdecoding="async"/.test(tag),
        `${route}: <img> without decoding="async": ${tag.slice(0, 90)}`,
      );
    }
  }
});

test("images · only the LCP image is fetched at high priority", () => {
  for (const route of PUBLIC_ROUTES) {
    const high = imgTags(sourceOf(route)).filter((t) =>
      /fetchPriority="high"/.test(t),
    ).length;
    assert.ok(high <= 1, `${route}: ${high} images marked fetchPriority="high"`);
  }
  // The homepage hero is its largest contentful paint, so it keeps priority.
  const hero = imgTags(APP_TSX).find((t) => t.includes("IMG.villaNight"));
  assert.ok(hero, "the homepage hero image is missing");
  assert.ok(/fetchPriority="high"/.test(hero!), "the hero lost fetchPriority");
  assert.ok(/loading="eager"/.test(hero!), "the hero is no longer eager");
});

test("robots · does not block the CSS, JavaScript or images a crawler renders with", () => {
  const rules = ROBOTS_TXT.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^disallow:/i.test(line))
    .map((line) => line.replace(/^disallow:\s*/i, ""));

  for (const rule of rules) {
    assert.ok(
      !/^\/assets|\.(js|css|jpe?g|png|webp|svg)|\*/i.test(rule),
      `robots.txt blocks "${rule}", which Google needs to render the page`,
    );
  }
});

// ========================================================== PHASE 2
// Homepage entity, fallback shell, preload, titles, internal links, rates.

test("homepage · exactly one h1, and it says what and where the place is", () => {
  const h1s = [...APP_TSX.matchAll(/<h1[\s>][^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(h1s.length, 1, `App.tsx renders ${h1s.length} <h1> elements`);
  // The text a crawler reads: inline tags (the nowrap span, the italic) removed.
  const text = h1s[0]![1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(text, "Private 2-Bedroom Villa in Shantiniketan");

  // It is the hero's display heading, not a small label.
  const h1Tag = h1s[0]![0]!;
  assert.match(h1Tag, /className="font-journal text-\[clamp\(/, "the h1 lost the hero display type");
  assert.ok(!/font-mono-ui|text-\[9px\]/.test(h1Tag), "the h1 is styled as an eyebrow again");

  // The tagline is kept, directly after the heading, as a paragraph.
  assert.match(
    APP_TSX,
    /<\/h1>\s*<p className="[^"]*font-journal[^"]*">\s*Stay for the <em className="text-secondary">unhurried<\/em> hours\.\s*<\/p>/,
  );
  assert.ok(
    !/<h[1-6][^>]*>\s*Stay for the/.test(APP_TSX),
    "the tagline is marked up as a heading again",
  );
});

test("pet faq · the pet charge is described from the rate plan, never priced on the page", () => {
  const answer = PAGES["/pet-friendly-homestay-shantiniketan"]!.faq!.find((item) =>
    item.q === "Is there an extra charge for bringing a pet?",
  )!.a;

  // No longer tells the guest the charge is unpublished — the rates page and
  // the booking section both show it.
  assert.ok(!/anything quoted here would be out of date/.test(answer));
  assert.match(answer, /current rate plan/);
  assert.match(answer, /rates page/);
  assert.match(answer, /not per night/);

  // The only rupee figure is the published damage minimum, not a pet price.
  const rupees = [...answer.matchAll(/₹\s?\d(?:[\d,]*\d)?/g)].map((m) => m[0]);
  assert.deepEqual(rupees, ["₹1,000"]);
  assert.ok(PET_PAGE_TSX.includes(answer), "the visible answer and the markup differ");
});

test("homepage · title, description and social tags are the approved ones", () => {
  const html = render("/");
  const title = "Raj Kuthir Homestays | Private Villa in Shantiniketan";
  const description =
    "Stay at Raj Kuthir Homestays, a private 2-bedroom pet-friendly villa with AC, garden and parking in Bolpur, Shantiniketan, West Bengal.";

  assert.deepEqual(titles(html), [title]);
  assert.deepEqual(metaByName(html, "description"), [description]);
  assert.deepEqual(canonicals(html), [`${SITE_ORIGIN}/`]);
  assert.deepEqual(metaByProp(html, "og:title"), [title]);
  assert.deepEqual(metaByProp(html, "og:description"), [description]);
  assert.deepEqual(metaByName(html, "twitter:title"), [title]);
  assert.deepEqual(metaByName(html, "twitter:description"), [description]);
});

test("routes · titles match the approved wording", () => {
  assert.equal(PAGES["/pet-friendly-homestay-shantiniketan"]!.title, "Pet-Friendly Homestay in Shantiniketan | Raj Kuthir");
  assert.equal(PAGES["/places-to-visit-in-shantiniketan"]!.title, "Places to Visit in Shantiniketan | Raj Kuthir Homestays");
  assert.equal(PAGES["/gallery"]!.title, "Raj Kuthir Homestays Gallery | Shantiniketan Villa");
  assert.equal(PAGES["/our-story"]!.title, "Our Story | Raj Kuthir Homestays, Shantiniketan");
});

test("routes · every indexable page has its own self-referencing canonical", () => {
  for (const route of PUBLIC_ROUTES) {
    const expected = `${SITE_ORIGIN}${route === "/" ? "/" : route}`;
    for (const variant of route === "/" ? ["/"] : [route, `${route}/`]) {
      const html = render(variant);
      assert.deepEqual(canonicals(html), [expected], `${variant}: wrong canonical`);
      assert.deepEqual(metaByProp(html, "og:url"), [expected], `${variant}: wrong og:url`);
    }
    if (route !== "/") {
      assert.notEqual(canonicals(render(route))[0], `${SITE_ORIGIN}/`);
    }
  }
});

test("routes · the title a page sets in the browser is the one the server sent", () => {
  // Google renders JavaScript. A useEffect that swaps in a different title
  // quietly replaces the server's one in what gets indexed.
  for (const route of PUBLIC_ROUTES.filter((r) => r !== "/")) {
    const set = sourceOf(route).match(/document\.title = '([^']+)'/)?.[1];
    assert.equal(set, PAGES[route]!.title, `${route}: document.title differs from seo.ts`);
  }
});

test("fallback · index.html carries nothing a non-homepage route could inherit", () => {
  // app.ts sends this file untouched if injectMeta throws. Whatever is in it
  // then goes out on every URL, so it must not name any one page.
  assert.equal(canonicals(BASE_HTML).length, 0, "index.html declares a canonical");
  assert.equal(metaByProp(BASE_HTML, "og:url").length, 0, "index.html declares og:url");
  assert.equal(metaByName(BASE_HTML, "description").length, 0, "index.html carries a description");
  assert.equal(metaByProp(BASE_HTML, "og:description").length, 0);
  assert.equal(metaByName(BASE_HTML, "twitter:description").length, 0);
  assert.ok(!/<link\s+rel="preload"/.test(BASE_HTML), "index.html preloads an image for every route");

  for (const route of PUBLIC_ROUTES) {
    assert.ok(
      !titles(BASE_HTML).includes(PAGES[route]!.title),
      `index.html's title is ${route}'s own title`,
    );
  }
  assert.deepEqual(titles(BASE_HTML), ["Raj Kuthir Homestays"]);
});

test("fallback · app.ts falls back to that neutral shell, not to a rendered page", () => {
  assert.match(
    APP_TS,
    /catch \(error\) \{[\s\S]*?res\.sendFile\(indexHtmlPath\);/,
    "the injection fallback changed — re-check what it can leak",
  );
});

test("viewport · pinch-zoom is not disabled", () => {
  const viewport = BASE_HTML.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1];
  assert.equal(viewport, "width=device-width, initial-scale=1.0");
  assert.ok(!/maximum-scale|user-scalable/.test(BASE_HTML));
});

test("preload · the homepage preloads its LCP image, and only the homepage", () => {
  const preloads = (html: string) =>
    [...html.matchAll(/<link rel="preload" as="image" href="([^"]+)"[^>]*>/g)];

  const home = preloads(render("/"));
  assert.equal(home.length, 1, "the homepage should preload exactly one image");
  assert.equal(home[0]![1], "/villa-night.jpg");
  assert.match(home[0]![0], /type="image\/jpeg"/);
  assert.match(home[0]![0], /fetchpriority="high"/);

  // It is the file the hero actually renders, eagerly and at high priority.
  assert.match(APP_TSX, /villaNight: asset\('villa-night\.jpg'\)/);

  for (const route of [...PUBLIC_ROUTES.filter((r) => r !== "/"), ...PRIVATE_ROUTES, ...UNKNOWN_ROUTES]) {
    assert.equal(preloads(render(route)).length, 0, `${route} preloads the homepage hero`);
  }
});

test("links · every other public page links to the pet-friendly page", () => {
  const target = "${basePath}/pet-friendly-homestay-shantiniketan`";
  for (const route of PUBLIC_ROUTES.filter((r) => r !== "/pet-friendly-homestay-shantiniketan")) {
    assert.ok(sourceOf(route).includes(target), `${route} has no link to the pet-friendly page`);
  }
  // ...and at least as often as they link to the house rules.
  const count = (needle: string) =>
    PUBLIC_ROUTES.reduce((n, r) => n + sourceOf(r).split(needle).length - 1, 0);
  assert.ok(
    count(target) >= count("${basePath}/house-rules`"),
    "the pet-friendly page has fewer internal links than the house rules",
  );
});

test("links · the homepage header sends 'Pet Friendly' to the page, not an anchor", () => {
  assert.match(
    APP_TSX,
    /\{ label: 'Pet Friendly', href: `\$\{basePath\}\/pet-friendly-homestay-shantiniketan` \}/,
  );
});

test("links · the pet page links back to the stay and on to places, photos and rates", () => {
  const source = sourceOf("/pet-friendly-homestay-shantiniketan");
  for (const href of [
    "${basePath}/`",
    "${basePath}/#booking`",
    "${basePath}/places-to-visit-in-shantiniketan`",
    "${basePath}/gallery`",
    "${basePath}/rates`",
  ]) {
    assert.ok(source.includes(href), `the pet page has no link to ${href}`);
  }
});

test("rates · the rates page reads the one rate plan and types no prices of its own", () => {
  const source = sourceOf("/rates");
  assert.match(source, /import \{[^}]*useRatePlan[^}]*\} from '@\/lib\/rates';/);
  assert.ok(!/₹\s?\d/.test(source), "Rates.tsx contains a hard-coded rupee amount");
  assert.ok(!/(?:Rs\.?|INR)\s?\d/.test(source), "Rates.tsx contains a hard-coded price");
  // The route exists on both sides.
  assert.ok(APP_TSX.includes('<Route path="/rates" component={Rates} />'));
  assert.ok(isKnownPath("/rates"));
  assert.ok(!isPrivatePath("/rates"));
});

test("places · no unverified travel time, and the core sights stay covered", () => {
  const source = sourceOf("/places-to-visit-in-shantiniketan");
  const site = readFileSync(path.join(clientRoot, "src/lib/site.ts"), "utf8");
  assert.ok(!/five minutes from Prantik/i.test(source), "a travel time contradicts lib/site.ts");
  // The page renders NEIGHBOURHOOD from lib/site.ts, so that is where the
  // places themselves are written.
  assert.match(source, /NEIGHBOURHOOD\.map/);
  for (const topic of ["Sonajhuri", "Visva-Bharati", "Rabindra Bhavan", "Khoai"]) {
    assert.ok(site.includes(topic), `the places page no longer covers ${topic}`);
  }
});

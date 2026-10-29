import assert from "node:assert/strict";
import test from "node:test";

import { prerenderFileFor, staticCacheControl, withPrerender, wwwRedirectTarget } from "./site-host.ts";

test("site host · www goes permanently to the bare domain, path and query kept", () => {
  assert.equal(wwwRedirectTarget("www.rajkuthirhomestays.casa", "/rates?x=1"), "https://rajkuthirhomestays.casa/rates?x=1");
  assert.equal(wwwRedirectTarget("WWW.RajKuthirHomestays.casa:443", "/"), "https://rajkuthirhomestays.casa/");
  assert.equal(wwwRedirectTarget("rajkuthirhomestays.casa", "/"), null);
  assert.equal(wwwRedirectTarget("localhost:5055", "/"), null);
  assert.equal(wwwRedirectTarget(undefined, "/"), null);
});

test("site host · hashed assets for a year, public files for a day, HTML never", () => {
  assert.equal(staticCacheControl("assets/index-DKPv_A2d.js"), "public, max-age=31536000, immutable");
  assert.equal(staticCacheControl("assets/index-abc.css"), "public, max-age=31536000, immutable");
  assert.equal(staticCacheControl("villa-night.jpg"), "public, max-age=86400");
  assert.equal(staticCacheControl("index.html"), "no-cache");
});

test("site host · prerendered HTML goes inside the empty root, once", () => {
  const shell = '<html><body><div id="root"></div><script src="/a.js"></script></body></html>';
  assert.equal(withPrerender(shell, "<main><h1>Hi $& $1</h1></main>"), '<html><body><div id="root"><main><h1>Hi $& $1</h1></main></div><script src="/a.js"></script></body></html>');
  assert.equal(withPrerender(shell, null), shell);
  assert.equal(withPrerender("<div id=\"root\">x</div>", "<p>y</p>"), "<div id=\"root\">x</div>");
});

test("site host · prerender file names", () => {
  assert.equal(prerenderFileFor("/"), "index.html");
  assert.equal(prerenderFileFor("/rates"), "rates.html");
  assert.equal(prerenderFileFor("/pet-friendly-homestay-shantiniketan"), "pet-friendly-homestay-shantiniketan.html");
});

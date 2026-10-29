import assert from "node:assert/strict";
import test from "node:test";

import { staticCacheControl, wwwRedirectTarget } from "./site-host.ts";

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

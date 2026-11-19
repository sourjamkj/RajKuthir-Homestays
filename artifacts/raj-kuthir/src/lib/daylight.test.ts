import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { followsDaylight, isNight, minutesToSunset, sunTimes, sunsetLine } from "./daylight.ts";

const ist = (m: number) => { const t = Math.round(m + 330); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

test("Santiniketan sunrise and sunset through the year", () => {
  const at = (d: string) => sunTimes(new Date(`${d}T06:00:00Z`));
  assert.deepEqual([ist(at("2026-11-19").rise), ist(at("2026-11-19").set)], ["05:56", "16:54"]);
  assert.deepEqual([ist(at("2026-06-21").rise), ist(at("2026-06-21").set)], ["04:53", "18:29"]);
  assert.deepEqual([ist(at("2026-12-25").rise), ist(at("2026-12-25").set)], ["06:19", "16:59"]);
});

test("day, night and the countdown", () => {
  assert.equal(isNight(new Date("2026-11-19T09:16:00Z")), false); // 2:46 pm IST
  assert.equal(isNight(new Date("2026-11-19T15:00:00Z")), true); // 8:30 pm IST
  assert.equal(isNight(new Date("2026-11-19T23:00:00Z")), true); // 4:30 am IST next day
  assert.equal(Math.round(minutesToSunset(new Date("2026-11-19T09:16:00Z"))!), 128);
  assert.equal(minutesToSunset(new Date("2026-11-19T15:00:00Z")), null);
});

test("the hero's sunset line", () => {
  assert.equal(sunsetLine(new Date("2026-11-19T09:16:00Z")), "Santiniketan · 2:46 pm · lights on in 2h 08m");
  assert.equal(sunsetLine(new Date("2026-11-19T11:00:00Z")), "Santiniketan · 4:30 pm · lights on in 24 min");
  assert.equal(sunsetLine(new Date("2026-11-19T15:00:00Z")), "Santiniketan · 8:30 pm · the lights are on");
});

test("guest pages follow the sun; admin and documents do not", () => {
  for (const p of ["/", "/gallery", "/pay", "/poush-mela-stay-shantiniketan"]) assert.equal(followsDaylight(p), true, p);
  for (const p of ["/admin", "/admin/rates", "/invoice", "/management-documents"]) assert.equal(followsDaylight(p), false, p);
});

test("the pre-paint script in index.html agrees with this module", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const code = html.match(/<script>([\s\S]*?data-daylight[\s\S]*?)<\/script>/)?.[1];
  assert.ok(code, "pre-paint script found");
  for (const [iso, path] of [["2026-11-19T09:16:00Z", "/"], ["2026-11-19T15:00:00Z", "/gallery"], ["2026-11-19T15:00:00Z", "/admin"], ["2026-06-21T12:50:00Z", "/rates"]] as const) {
    const attrs: Record<string, string> = {};
    const RealDate = Date;
    const FakeDate = class extends RealDate { constructor(...a: []) { super(...(a.length ? a : [iso])); } static now() { return new RealDate(iso).getTime(); } };
    vm.runInNewContext(code, { Date: FakeDate, Math, JSON, location: { pathname: path }, sessionStorage: { getItem: () => null }, document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } } });
    const want = followsDaylight(path) ? (isNight(new Date(iso)) ? "night" : "day") : undefined;
    assert.equal(attrs["data-daylight"], want, `${iso} ${path}`);
  }
});

test("a visitor's Lights choice holds only while the sun is in the same state", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const code = html.match(/<script>([\s\S]*?data-daylight[\s\S]*?)<\/script>/)![1]!;
  const run = (iso: string, stored: unknown) => {
    const attrs: Record<string, string> = {};
    const RealDate = Date;
    const FakeDate = class extends RealDate { constructor(...a: []) { super(...(a.length ? a : [iso])); } };
    vm.runInNewContext(code, { Date: FakeDate, Math, JSON, location: { pathname: "/" }, sessionStorage: { getItem: () => (stored === null ? null : JSON.stringify(stored)) }, document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } } });
    return attrs["data-daylight"];
  };
  const afternoon = "2026-11-19T09:16:00Z", evening = "2026-11-19T15:00:00Z";
  assert.equal(run(afternoon, { mode: "night", sun: "day" }), "night"); // switched on this afternoon
  assert.equal(run(evening, { mode: "night", sun: "day" }), "night"); // the sun caught up anyway
  assert.equal(run(evening, { mode: "day", sun: "day" }), "night"); // afternoon choice expires at sunset
  assert.equal(run(evening, { mode: "day", sun: "night" }), "day"); // switched off this evening
  assert.equal(run(afternoon, "garbage"), "day");
});

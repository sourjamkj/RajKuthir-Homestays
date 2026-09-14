import assert from "node:assert/strict";
import test from "node:test";

import { firstConflict, isAvailable, rangesOverlap } from "./availability.ts";

/**
 * Two ways to get this wrong, and they cost opposite things. Too loose and
 * the villa is double-booked. Too strict and every changeover day rejects a
 * real guest — which is silent, so it is the one that goes unnoticed.
 */

/** 2 Oct to 5 Oct: the nights of the 2nd, 3rd and 4th. */
const TAKEN = [{ startDate: "2026-10-02", endDate: "2026-10-05" }];

test("availability · clear dates before and after are available", () => {
  assert.ok(isAvailable({ startDate: "2026-09-28", endDate: "2026-10-02" }, TAKEN));
  assert.ok(isAvailable({ startDate: "2026-10-05", endDate: "2026-10-08" }, TAKEN));
});

test("availability · a guest arriving the day another leaves is fine", () => {
  // The whole point of half-open ranges. Rejecting this loses a booking on
  // every single changeover day, and nobody would ever see why.
  assert.ok(
    isAvailable({ startDate: "2026-10-05", endDate: "2026-10-07" }, TAKEN),
    "a back-to-back arrival was refused",
  );
  assert.ok(
    isAvailable({ startDate: "2026-09-30", endDate: "2026-10-02" }, TAKEN),
    "a back-to-back departure was refused",
  );
});

test("availability · a stay that lands inside taken dates is refused", () => {
  assert.equal(isAvailable({ startDate: "2026-10-03", endDate: "2026-10-04" }, TAKEN), false);
});

test("availability · overlapping either edge is refused", () => {
  // Arrives before, leaves during.
  assert.equal(isAvailable({ startDate: "2026-09-30", endDate: "2026-10-03" }, TAKEN), false);
  // Arrives during, leaves after.
  assert.equal(isAvailable({ startDate: "2026-10-04", endDate: "2026-10-08" }, TAKEN), false);
});

test("availability · a stay swallowing the taken range whole is refused", () => {
  assert.equal(isAvailable({ startDate: "2026-09-25", endDate: "2026-10-20" }, TAKEN), false);
});

test("availability · the conflict is named, so the guest can be told", () => {
  const conflict = firstConflict(
    { startDate: "2026-10-03", endDate: "2026-10-06" },
    TAKEN,
  );

  assert.deepEqual(conflict, TAKEN[0]);
});

test("availability · with nothing booked, everything is available", () => {
  assert.ok(isAvailable({ startDate: "2026-10-03", endDate: "2026-10-04" }, []));
  assert.equal(firstConflict({ startDate: "2026-10-03", endDate: "2026-10-04" }, []), null);
});

test("availability · the first of several conflicts is the one returned", () => {
  const many = [
    { startDate: "2026-11-01", endDate: "2026-11-03" },
    { startDate: "2026-10-02", endDate: "2026-10-05" },
  ];

  assert.deepEqual(
    firstConflict({ startDate: "2026-10-01", endDate: "2026-11-10" }, many),
    many[0],
  );
});

test("availability · a zero-length or backwards stay conflicts with nothing", () => {
  // Not this module's job to reject it — the quote already refuses these with
  // a reason, and inventing a second, different complaint here would just
  // make the guest read two errors about the same mistake.
  assert.equal(firstConflict({ startDate: "2026-10-03", endDate: "2026-10-03" }, TAKEN), null);
  assert.equal(firstConflict({ startDate: "2026-10-06", endDate: "2026-10-03" }, TAKEN), null);
});

test("availability · overlap is symmetric", () => {
  const a = { startDate: "2026-10-02", endDate: "2026-10-05" };
  const b = { startDate: "2026-10-04", endDate: "2026-10-09" };

  assert.equal(rangesOverlap(a, b), rangesOverlap(b, a));
  assert.ok(rangesOverlap(a, b));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_REPLIES_PER_HOUR, historyToMessages, parseStayArgs, shouldAgentReply, wantsHuman } from "./wa-agent-rules.ts";

test("history alternates, starts with the guest, merges runs and drops empty bodies", () => {
  const messages = historyToMessages([
    { direction: "outbound", text: "Your booking is confirmed" },
    { direction: "inbound", text: "Hi" },
    { direction: "inbound", text: "Is 17 Dec free?" },
    { direction: "inbound", text: null },
    { direction: "outbound", text: "Let me check" },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "Hi\nIs 17 Dec free?" },
    { role: "assistant", content: "Let me check" },
  ]);
});

test("the agent stays quiet while the owner has the chat, past the hourly limit, and for non-text", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const base = { state: "bot" as const, mutedUntil: null, now, repliesLastHour: 0, hasText: true };
  assert.deepEqual(shouldAgentReply(base), { reply: true });
  assert.equal(shouldAgentReply({ ...base, state: "human", mutedUntil: new Date("2026-11-23T00:00:00Z") }).reply, false);
  assert.equal(shouldAgentReply({ ...base, state: "human", mutedUntil: new Date("2026-11-21T00:00:00Z") }).reply, true, "a handover expires");
  assert.equal(shouldAgentReply({ ...base, repliesLastHour: MAX_REPLIES_PER_HOUR }).reply, false);
  assert.equal(shouldAgentReply({ ...base, hasText: false }).reply, false);
});

test("stay arguments are checked before anything is priced or held", () => {
  const today = "2026-11-22";
  assert.deepEqual(parseStayArgs({ check_in: "2026-12-17", check_out: "2026-12-19", adults: 4, pets: 1 }, today), {
    ok: true,
    stay: { checkIn: "2026-12-17", checkOut: "2026-12-19", adults: 4, children: 0, pets: 1 },
  });
  assert.equal(parseStayArgs({ check_in: "17 Dec", check_out: "2026-12-19", adults: 2 }, today).ok, false);
  assert.equal(parseStayArgs({ check_in: "2026-11-01", check_out: "2026-11-03", adults: 2 }, today).ok, false, "past");
  assert.equal(parseStayArgs({ check_in: "2026-12-19", check_out: "2026-12-17", adults: 2 }, today).ok, false, "backwards");
  assert.equal(parseStayArgs({ check_in: "2026-12-17", check_out: "2026-12-19" }, today).ok, false, "no adults");
});

test("asking for a person is recognised in English, Bengali and Hindi", () => {
  for (const text of ["Can I talk to the owner?", "call me please", "মালিকের সাথে কথা বলতে চাই", "मुझे बात करनी है"]) assert.ok(wantsHuman(text), text);
  assert.ok(!wantsHuman("Is the villa free on 17 Dec?"));
});

test("the menu: greetings open it, every row has an answer, ids read as titles for the model", async () => {
  const { MENU_ROWS, isGreeting, isMenuId, menuAnswer, readableText } = await import("./wa-agent-rules.ts");
  for (const text of ["Hi", "hii!", "Hello", "menu", "Good morning", "নমস্কার"]) assert.ok(isGreeting(text), text);
  for (const text of ["Hi, is 17 Dec free?", "hello can I bring my dog"]) assert.ok(!isGreeting(text), text);
  for (const row of MENU_ROWS) {
    assert.ok(row.title.length <= 24 && row.description.length <= 72, row.id);
    assert.ok(isMenuId(row.id));
    const answer = menuAnswer(row.id);
    assert.ok(answer.kind === "human" || answer.text.length > 20, row.id);
  }
  assert.equal(readableText("menu_photos"), '(chose "Photos of the villa" from the menu)');
  assert.equal(readableText("plain text"), "plain text");
});

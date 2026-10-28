import { logger } from "./logger";
import {
  checkDraft,
  draftSystemPrompt,
  draftUserPrompt,
  fallbackDraft,
  finishDraft,
  type PlaceSpelling,
} from "./review-rules";

/**
 * Drafts a reply to one Google review with a small, fast Claude model, then
 * holds the draft to review-rules.ts's checkDraft. A draft that breaks a
 * rule gets one retry with the problems spelled out; if it still breaks one,
 * or there is no ANTHROPIC_API_KEY, or the call fails, the rule-abiding
 * fallback from review-rules.ts is used instead. Nothing here posts anything.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

export function isDrafterConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]?.trim());
}

async function callModel(system: string, user: string): Promise<string> {
  const key = process.env["ANTHROPIC_API_KEY"]!.trim();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env["REVIEW_DRAFT_MODEL"]?.trim() || DEFAULT_MODEL,
      max_tokens: 400,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json().catch(() => ({}))) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  const text = body.content?.find((part) => part.type === "text")?.text?.trim();
  if (!text) throw new Error("The model returned no text.");
  return text;
}

export type DraftInput = {
  reviewerName: string | null;
  rating: number;
  reviewText: string | null;
  stayedWithPet: boolean;
  recentReplies: string[];
  spelling: PlaceSpelling;
};

export type DraftResult = {
  text: string;
  /** "model", or "fallback" with the reason — shown to the owner. */
  via: "model" | "fallback";
  note: string | null;
};

export async function draftReply(input: DraftInput): Promise<DraftResult> {
  const fallback = (note: string): DraftResult => ({
    text: fallbackDraft(input),
    via: "fallback",
    note,
  });

  if (!isDrafterConfigured()) return fallback("Simple draft — ANTHROPIC_API_KEY is not set, so no model was used.");

  const system = draftSystemPrompt(input.spelling);
  let problems: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callModel(system, draftUserPrompt({ ...input, problems }));
      const draft = finishDraft(raw, input.spelling);
      problems = checkDraft({ draft, reviewText: input.reviewText, rating: input.rating, recentReplies: input.recentReplies });
      if (!problems.length) return { text: draft, via: "model", note: null };
      logger.info({ attempt, problems }, "Review draft broke a rule; retrying");
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : error }, "Review draft call failed");
      return fallback("Simple draft — the drafting model could not be reached.");
    }
  }
  return fallback(`Simple draft — the model's draft broke a rule twice (${problems.join(" ")}).`);
}

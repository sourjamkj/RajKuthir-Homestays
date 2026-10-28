import { logger } from "./logger";
import { starRating } from "./review-rules";

/**
 * Where Google reviews come from and where replies go.
 *
 * Behind an interface so the provider can change without touching the
 * screens or the drafting: the Business Profile API today, possibly
 * something else later.
 */

export type FetchedReview = {
  reviewId: string;
  reviewerName: string | null;
  rating: number;
  text: string | null;
  createdAt: Date;
  /** A reply already on Google (written in the Google app, say). */
  existingReply: string | null;
};

export type PostResult = { ok: true } | { ok: false; error: string; manual?: boolean };

export interface ReviewSource {
  readonly kind: "gbp" | "manual";
  /** The most recent reviews on the listing. The caller drops ones it already has. */
  fetchNewReviews(): Promise<FetchedReview[]>;
  postReply(reviewId: string, text: string): Promise<PostResult>;
}

/* ---------------------------- Business Profile --------------------------- */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://mybusiness.googleapis.com/v4";

type GbpConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountId: string;
  locationId: string;
};

function gbpConfig(): GbpConfig | null {
  const read = (key: string) => process.env[key]?.trim() || null;
  const clientId = read("GBP_CLIENT_ID");
  const clientSecret = read("GBP_CLIENT_SECRET");
  const refreshToken = read("GBP_REFRESH_TOKEN");
  const accountId = read("GBP_ACCOUNT_ID");
  const locationId = read("GBP_LOCATION_ID");
  if (!clientId || !clientSecret || !refreshToken || !accountId || !locationId) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    // Accept "accounts/123" or "123", "locations/456" or "456".
    accountId: accountId.replace(/^accounts\//, ""),
    locationId: locationId.replace(/^.*locations\//, ""),
  };
}

export function isGbpConfigured(): boolean {
  return gbpConfig() !== null;
}

class GbpReviewSource implements ReviewSource {
  readonly kind = "gbp" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: GbpConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !body.access_token) {
      throw new Error(`Google sign-in failed: ${body.error ?? `HTTP ${response.status}`}`);
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private reviewsUrl(): string {
    return `${API_BASE}/accounts/${encodeURIComponent(this.config.accountId)}/locations/${encodeURIComponent(this.config.locationId)}/reviews`;
  }

  async fetchNewReviews(): Promise<FetchedReview[]> {
    const token = await this.accessToken();
    const out: FetchedReview[] = [];
    let pageToken: string | undefined;

    // Two pages of 50 is plenty every six hours for one property.
    for (let page = 0; page < 2; page += 1) {
      const url = new URL(this.reviewsUrl());
      url.searchParams.set("pageSize", "50");
      url.searchParams.set("orderBy", "updateTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        reviews?: Array<{
          reviewId?: string;
          reviewer?: { displayName?: string };
          starRating?: string;
          comment?: string;
          createTime?: string;
          reviewReply?: { comment?: string };
        }>;
        nextPageToken?: string;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(`Google reviews: ${body.error?.message ?? `HTTP ${response.status}`}`);

      for (const review of body.reviews ?? []) {
        const rating = starRating(review.starRating);
        if (!review.reviewId || !rating) continue;
        out.push({
          reviewId: review.reviewId,
          reviewerName: review.reviewer?.displayName ?? null,
          rating,
          text: review.comment?.trim() || null,
          createdAt: review.createTime ? new Date(review.createTime) : new Date(),
          existingReply: review.reviewReply?.comment?.trim() || null,
        });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async postReply(reviewId: string, text: string): Promise<PostResult> {
    try {
      const token = await this.accessToken();
      const response = await fetch(`${this.reviewsUrl()}/${encodeURIComponent(reviewId)}/reply`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: text }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { ok: true };
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      return { ok: false, error: body.error?.message ?? `HTTP ${response.status}` };
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : error }, "Posting a Google review reply failed");
      return { ok: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }
}

/* -------------------------------- manual -------------------------------- */

/**
 * Without API access: the owner pastes reviews into /admin, and "posting"
 * means copying the approved reply and pasting it on the listing.
 */
class ManualReviewSource implements ReviewSource {
  readonly kind = "manual" as const;

  async fetchNewReviews(): Promise<FetchedReview[]> {
    return [];
  }

  async postReply(): Promise<PostResult> {
    return { ok: false, manual: true, error: "Copy the reply and paste it on the listing, then press Mark posted." };
  }
}

let cached: { key: string; source: ReviewSource } | null = null;

/** The Business Profile API when all five GBP_* variables are set, else manual. */
export function getReviewSource(): ReviewSource {
  const config = gbpConfig();
  const key = config ? `${config.clientId}:${config.accountId}:${config.locationId}` : "manual";
  if (!cached || cached.key !== key) {
    cached = { key, source: config ? new GbpReviewSource(config) : new ManualReviewSource() };
  }
  return cached.source;
}

import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type UnifiedAd,
  type DateRangeInput,
  type TimeIncrement,
} from "../types";
import { classifyTiktokError } from "@/lib/tiktok/errors";

/**
 * TikTok adapter — Phase 7 Session 1 SCAFFOLD per ADR-020.
 *
 * This scaffold establishes the adapter shape + factory.ts integration
 * point. Session 2 wires the actual /report/integrated/get/ and
 * /ad/get/ fetchers via api.ts + normalize.ts. Session 3 adds pixel
 * conversion attribution + the perf gate.
 *
 * Per ADR-020 §Decision 6 (thin-boundary 3-layer):
 *   - src/lib/tiktok/api.ts        → HTTP layer (TIKTOK_API_VERSION pin)
 *   - src/lib/tiktok/normalize.ts  → TikTok-shape → UnifiedAd (Session 2)
 *   - src/lib/ads/providers/tiktok.ts → this file (adapter)
 *
 * Per ADR-020 §Decision 9: errors classified at the wrap boundary
 * (withReauthMapping) and converted to ReauthRequiredError when they
 * match TikTok's auth-class error codes. Non-auth errors re-throw
 * for upstream handling (route → 500 → client retry).
 */
export class TiktokAdapter implements AdProviderAdapter {
  readonly provider = "tiktok" as const;

  /**
   * @param refreshToken Long-lived OAuth refresh token from
   *   platform_credentials. TikTok's refresh_token has a 1-year
   *   lifetime; the adapter exchanges for a fresh access_token
   *   internally per call (or batches per session — Session 2 design).
   * @param advertiserId Bare numeric advertiser_id (NO prefix per
   *   ADR-020 §Decision 10).
   * @param accountInfo name + currency + timezone from
   *   connections.metadata, plumbed at factory.ts time.
   */
  constructor(
    private refreshToken: string,
    private advertiserId: string,
    private accountInfo: {
      name: string;
      currency: string;
      timezone: string;
    }
  ) {}

  /**
   * Outermost wrap for SDK-class errors. Converts TikTok auth-class
   * errors into ReauthRequiredError (widened from ADR-017 to cover
   * "google" | "tiktok"). Non-auth errors re-throw unchanged.
   *
   * Mirrors GoogleAdsAdapter.withReauthMapping precedent.
   */
  private async withReauthMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const reauth = classifyTiktokError(err);
      if (reauth) throw reauth;
      throw err;
    }
  }

  async getAccount(): Promise<UnifiedAccount> {
    return {
      id: this.advertiserId,
      provider: "tiktok",
      name: this.accountInfo.name,
      currency: this.accountInfo.currency,
      timezone: this.accountInfo.timezone,
      status: "active",
    };
  }

  // -----------------------------------------------------------------
  // Session 2 stubs — return empty arrays for now. The route handlers
  // can already wire to this adapter without breaking (empty data
  // renders empty UI), and Session 2 fills these in with real fetchers.
  // -----------------------------------------------------------------

  async getCampaigns(): Promise<UnifiedCampaign[]> {
    return this.withReauthMapping(async () => {
      // TODO Session 2: GET /campaign/get/ via tiktok/api.ts
      console.warn(
        "[tiktok-adapter] getCampaigns not yet implemented — Session 2 wires the fetcher"
      );
      return [];
    });
  }

  async getAccountInsights(
    _range: DateRangeInput,
    _timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    return this.withReauthMapping(async () => {
      void _range;
      void _timeIncrement;
      // TODO Session 2: POST /report/integrated/get/ with data_level=AUC_ADVERTISER
      console.warn(
        "[tiktok-adapter] getAccountInsights not yet implemented — Session 2 wires the fetcher"
      );
      return [];
    });
  }

  async getCampaignInsights(
    _range: DateRangeInput,
    _timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    return this.withReauthMapping(async () => {
      void _range;
      void _timeIncrement;
      // TODO Session 2: POST /report/integrated/get/ with data_level=AUC_CAMPAIGN
      console.warn(
        "[tiktok-adapter] getCampaignInsights not yet implemented — Session 2 wires the fetcher"
      );
      return [];
    });
  }

  async getAds(_range: DateRangeInput): Promise<UnifiedAd[]> {
    return this.withReauthMapping(async () => {
      void _range;
      // TODO Session 2: GET /ad/get/ + POST /report/integrated/get/ at AUC_AD level,
      // then normalize via tiktok/normalize.ts. Session 3 adds pixel
      // conversion attribution (complete_payment + total_purchase_value).
      console.warn(
        "[tiktok-adapter] getAds not yet implemented — Session 2 wires the fetcher"
      );
      return [];
    });
  }
}

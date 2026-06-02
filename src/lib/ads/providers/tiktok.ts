import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type UnifiedAd,
  type UnifiedAdTiktok,
  type DateRangeInput,
  type TimeIncrement,
} from "../types";
import {
  getAccountInsights as fetchTiktokAccountInsights,
  getCampaignInsights as fetchTiktokCampaignInsights,
  getAdInsights as fetchTiktokAdInsights,
  getAds as fetchTiktokAds,
  getCampaigns as fetchTiktokCampaigns,
  fetchInsightsLifetime,
  resolveRangeToDates,
  type TiktokCampaignRow,
  type TiktokReportRow,
} from "@/lib/tiktok/api";
import {
  collapseTiktokStatus,
  extractCampaignIdFromRow,
  normalizeReportRowToInsight,
  normalizeTiktokAdToUnified,
} from "@/lib/tiktok/normalize";
import { classifyTiktokError } from "@/lib/tiktok/errors";

/**
 * TikTok adapter — Phase 7 Session 2 Commit 2b-3 wiring.
 *
 * Wires api.ts fetchers + normalize.ts mappers into the
 * AdProviderAdapter interface. Per ADR-020 §Decision 6 (thin-boundary
 * 3-layer): this file is the consumer of api.ts (HTTP) + normalize.ts
 * (shape-mapping). It contains NO endpoint URLs, NO shape literals,
 * NO metric-name knowledge — only orchestration (parallel fetch +
 * Map joins + map + filter).
 *
 * Per ADR-020 §Decision 9: errors classified at the wrap boundary
 * (withReauthMapping) and converted to ReauthRequiredError when they
 * match TikTok's auth-class error codes. Non-auth errors re-throw
 * for upstream handling (route → 500 → client retry).
 *
 * Per ADR-005: currency flows from /advertiser/info/ (probe-time) →
 * connections.metadata.currency → factory → accountInfo.currency →
 * every mapper call. JST USD canary path verified end-to-end.
 */

// ═══════════════════════════════════════════════════════════════════
// File-private join helpers — used by getCampaignInsights + getAds.
// Pure functions; no `this` dependency. Defensive against the
// silently-dropped-mode-3 edge (TiktokAdRow.campaign_id may be
// undefined; we skip those rows in the lookup).
// ═══════════════════════════════════════════════════════════════════

interface CampaignLookupEntry {
  name: string;
  objectiveType: string;
  status: UnifiedCampaign["status"];
}

function buildCampaignLookup(
  campaigns: TiktokCampaignRow[]
): Map<string, CampaignLookupEntry> {
  const lookup = new Map<string, CampaignLookupEntry>();
  for (const c of campaigns) {
    if (!c.campaign_id) continue;
    lookup.set(c.campaign_id, {
      name: c.campaign_name?.trim() ?? "",
      objectiveType: c.objective_type ?? "",
      status: collapseTiktokStatus(c.operation_status, c.secondary_status),
    });
  }
  return lookup;
}

function buildInsightLookup(
  insights: TiktokReportRow[],
  dimensionKey: "ad_id" | "campaign_id"
): Map<string, TiktokReportRow> {
  const lookup = new Map<string, TiktokReportRow>();
  for (const row of insights) {
    const id = row.dimensions?.[dimensionKey];
    if (id) lookup.set(id, row);
  }
  return lookup;
}

export class TiktokAdapter implements AdProviderAdapter {
  readonly provider = "tiktok" as const;

  /**
   * @param accessToken Long-lived TikTok access_token per ADR-020 §13b
   *   (no refresh cycle in Marketing API v1.3). Stored in
   *   platform_credentials.refresh_token per §13c (generic credential
   *   slot — same pattern Meta uses). The factory reads it via the
   *   shared getRefreshTokenForUser helper.
   * @param advertiserId Bare numeric advertiser_id (NO prefix per
   *   ADR-020 §Decision 10).
   * @param accountInfo name + currency + timezone from
   *   connections.metadata. currency is per-account (verified 4 SAR + 1
   *   USD across 5 active advertisers on the test apparatus —
   *   2026-05-31 probe). The JST USD account is the empirical canary
   *   against any hardcoded-SAR regression per ADR-005.
   */
  constructor(
    private accessToken: string,
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

  /**
   * Map /campaign/get/ rows → UnifiedCampaign[]. createdTime +
   * updatedTime default to "" (CAMPAIGN_FIELDS doesn't fetch
   * create_time/modify_time — same precedent as the Google adapter,
   * which also defaults these; no UI consumer renders them today).
   */
  private normalizeCampaign = (c: TiktokCampaignRow): UnifiedCampaign => ({
    id: c.campaign_id ?? "",
    provider: "tiktok",
    name: c.campaign_name?.trim() ?? "",
    status: collapseTiktokStatus(c.operation_status, c.secondary_status),
    objective: c.objective_type ?? "",
    // dailyBudget / lifetimeBudget / startTime / stopTime — deferred
    // (CAMPAIGN_FIELDS minimal set; add when a UI consumer needs them).
    createdTime: "", // Google-adapter precedent (providers/google.ts:575-576)
    updatedTime: "",
  });

  async getCampaigns(): Promise<UnifiedCampaign[]> {
    return this.withReauthMapping(async () => {
      const rows = await fetchTiktokCampaigns(
        this.accessToken,
        this.advertiserId
      );
      return rows.map(this.normalizeCampaign);
    });
  }

  async getAccountInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    return this.withReauthMapping(async () => {
      // Daily-breakdown (time_increment) deferred to v2 enhancement —
      // TikTok api.ts 2a single-call shape doesn't currently support it.
      void timeIncrement;

      // Lifetime dispatch per ADR-020 §Lifetime: TikTok's 365-day
      // per-request cap forces a chunked-fetch + client-side merge to
      // get true lifetime semantics. Non-lifetime ranges keep the
      // existing single-call path byte-for-byte.
      const rows =
        range === "lifetime"
          ? await fetchInsightsLifetime(
              this.accessToken,
              this.advertiserId,
              fetchTiktokAccountInsights
            )
          : await fetchTiktokAccountInsights(
              this.accessToken,
              this.advertiserId,
              range
            );

      const { since, until } = resolveRangeToDates(range);
      return rows.map((row) =>
        normalizeReportRowToInsight(row, {
          currency: this.accountInfo.currency,
          dateStart: since,
          dateStop: until,
          level: "account",
        })
      );
    });
  }

  async getCampaignInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    return this.withReauthMapping(async () => {
      void timeIncrement;

      // Parallel fetch — campaigns lookup is independent of insights.
      // Lifetime dispatch per ADR-020 §Lifetime applies ONLY to the
      // insight-fetcher element; fetchTiktokCampaigns ignores `range`
      // entirely (returns full inventory) so it stays on its single
      // path regardless of preset.
      const [insightRows, campaigns] = await Promise.all([
        range === "lifetime"
          ? fetchInsightsLifetime(
              this.accessToken,
              this.advertiserId,
              fetchTiktokCampaignInsights
            )
          : fetchTiktokCampaignInsights(
              this.accessToken,
              this.advertiserId,
              range
            ),
        fetchTiktokCampaigns(this.accessToken, this.advertiserId),
      ]);

      const campaignLookup = buildCampaignLookup(campaigns);
      const { since, until } = resolveRangeToDates(range);

      return insightRows.map((row) => {
        const campaignId = extractCampaignIdFromRow(row);
        const info = campaignId ? campaignLookup.get(campaignId) : undefined;
        return normalizeReportRowToInsight(row, {
          currency: this.accountInfo.currency,
          dateStart: since,
          dateStop: until,
          level: "campaign",
          campaignName: info?.name,
          status: info?.status,
        });
      });
    });
  }

  async getAds(range: DateRangeInput): Promise<UnifiedAd[]> {
    return this.withReauthMapping(async () => {
      // Three parallel fetches — /ad/get/ + AUCTION_AD report + /campaign/get/.
      // Campaigns feed the per-ad objectiveType + campaignName via the
      // campaign_id join (TikTok /ad/get/ doesn't expose objective at
      // the ad row level).
      //
      // Lifetime dispatch per ADR-020 §Lifetime applies ONLY to the
      // insight-fetcher element; fetchTiktokAds and fetchTiktokCampaigns
      // both ignore `range` (full inventory) so they stay on their
      // single path regardless of preset.
      const [adRows, insightRows, campaigns] = await Promise.all([
        fetchTiktokAds(this.accessToken, this.advertiserId, range),
        range === "lifetime"
          ? fetchInsightsLifetime(
              this.accessToken,
              this.advertiserId,
              fetchTiktokAdInsights
            )
          : fetchTiktokAdInsights(this.accessToken, this.advertiserId, range),
        fetchTiktokCampaigns(this.accessToken, this.advertiserId),
      ]);

      const insightLookup = buildInsightLookup(insightRows, "ad_id");
      const campaignLookup = buildCampaignLookup(campaigns);

      const unifiedAds: UnifiedAdTiktok[] = [];
      for (const adRow of adRows) {
        const insightRow = adRow.ad_id
          ? insightLookup.get(adRow.ad_id)
          : undefined;
        const campaignInfo = adRow.campaign_id
          ? campaignLookup.get(adRow.campaign_id)
          : undefined;
        unifiedAds.push(
          normalizeTiktokAdToUnified(adRow, insightRow, {
            currency: this.accountInfo.currency,
            campaignName: campaignInfo?.name,
            objectiveType: campaignInfo?.objectiveType ?? "",
          })
        );
      }

      // Filter to ads with activity in window — mirrors Meta's
      // unifiedAds.filter(spend > 0 || impressions > 0) pattern. Keeps
      // cache lean (IMAA's 201 ads → ~21 with activity per page-1 probe
      // scan). Dormant ads still exist on the platform but don't
      // surface in the dashboard's per-period view.
      return unifiedAds.filter(
        (ad) => ad.spend > 0 || ad.impressions > 0
      );
    });
  }
}

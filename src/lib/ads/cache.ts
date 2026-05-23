import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Bump this when UnifiedAd or UnifiedInsight schema changes incompatibly.
 * Forces all callers to miss the cache and refetch with the new shape.
 *
 * History:
 * - v1: initial (implicit)
 * - v2: Phase 4.8 M5 — UnifiedAd gained headlines, descriptions, currency,
 *       imageUrl, carouselImages. UnifiedInsight gained status (M4) and
 *       currency. Old cache entries lack these fields.
 * - v3: Phase 4.8 M6 — UnifiedAd gained extensions (sitelinks, callouts,
 *       structured snippets). Pre-v3 entries lack this field. See ADR-012.
 */
const CACHE_SCHEMA_VERSION = "v3";

const CACHE_TTL_MINUTES = 15;

// Insights SWR windows. fresh_until / stale_until are plain columns now
// (Postgres rejected GENERATED expressions with INTERVAL), so writes set
// them explicitly.
const INSIGHTS_FRESH_MINUTES = 15;
const INSIGHTS_STALE_HOURS = 24;

// Creatives cache (separate table) — different TTLs because /me/ads is heavier
const CREATIVES_FRESH_MINUTES = 30;
const CREATIVES_STALE_HOURS = 24;

export type AdProvider = "meta" | "google" | "tiktok" | "snapchat";

export type CacheStatus = "fresh" | "stale";

export interface SWRCacheResult<T> {
  data: T;
  status: CacheStatus;
  fetchedAt: Date;
}

// =================================================================
// Legacy single-TTL helpers (used by /api/ads/campaigns).
// insights_cache has fresh_until + stale_until as plain NOT NULL columns —
// setCachedData writes them alongside fetched_at so the SWR-aware queries
// below see consistent timestamps.
// =================================================================

/**
 * Suffix the caller's cache_key with the current schema version so that
 * post-bump reads/writes hit a fresh row. Old v1 rows become unreachable.
 */
const versionedKey = (cacheKey: string): string =>
  `${cacheKey}:${CACHE_SCHEMA_VERSION}`;

export async function getCachedData<T>(
  connectionId: number,
  provider: AdProvider,
  cacheKey: string
): Promise<T | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("insights_cache")
    .select("data, expires_at")
    .eq("connection_id", connectionId)
    .eq("provider", provider)
    .eq("cache_key", versionedKey(cacheKey))
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !data) return null;

  return data.data as T;
}

export async function setCachedData<T>(
  connectionId: number,
  provider: AdProvider,
  cacheKey: string,
  data: T
): Promise<void> {
  const supabase = await createClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MINUTES * 60 * 1000);
  const freshUntil = new Date(
    now.getTime() + INSIGHTS_FRESH_MINUTES * 60 * 1000
  );
  const staleUntil = new Date(
    now.getTime() + INSIGHTS_STALE_HOURS * 60 * 60 * 1000
  );

  await supabase.from("insights_cache").upsert(
    {
      connection_id: connectionId,
      provider,
      cache_key: versionedKey(cacheKey),
      data: data as Json,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      fresh_until: freshUntil.toISOString(),
      stale_until: staleUntil.toISOString(),
    },
    {
      onConflict: "connection_id,provider,cache_key",
    }
  );
}

export async function invalidateCache(
  connectionId: number,
  provider: AdProvider
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("insights_cache")
    .delete()
    .eq("connection_id", connectionId)
    .eq("provider", provider);
}

// =================================================================
// SWR helpers — used by /api/ads/insights (and any future SWR consumers
// of insights_cache). Returns null when stale_until has passed; otherwise
// returns the row plus its freshness status.
// =================================================================

export async function getCachedDataSWR<T>(
  connectionId: number,
  provider: AdProvider,
  cacheKey: string
): Promise<SWRCacheResult<T> | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("insights_cache")
    .select("data, fetched_at, fresh_until, stale_until")
    .eq("connection_id", connectionId)
    .eq("provider", provider)
    .eq("cache_key", versionedKey(cacheKey))
    .maybeSingle();

  if (error || !data) return null;

  const now = new Date();
  const freshUntil = new Date(data.fresh_until);
  const staleUntil = new Date(data.stale_until);

  if (now >= staleUntil) return null; // too old to use even as stale

  return {
    data: data.data as T,
    status: now < freshUntil ? "fresh" : "stale",
    fetchedAt: new Date(data.fetched_at),
  };
}

// =================================================================
// Creatives SWR cache (separate table — per-user-per-account-per-range)
// =================================================================

export async function getCachedCreatives<T>(params: {
  userId: string;
  provider: AdProvider;
  accountId: string;
  dateRange: string;
}): Promise<SWRCacheResult<T> | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("creatives_cache")
    .select("data, fetched_at, fresh_until, stale_until")
    .eq("user_id", params.userId)
    .eq("provider", params.provider)
    .eq("account_id", params.accountId)
    .eq("date_range", versionedKey(params.dateRange))
    .maybeSingle();

  if (error || !data) return null;

  const now = new Date();
  const freshUntil = new Date(data.fresh_until);
  const staleUntil = new Date(data.stale_until);

  if (now >= staleUntil) return null;

  return {
    data: data.data as T,
    status: now < freshUntil ? "fresh" : "stale",
    fetchedAt: new Date(data.fetched_at),
  };
}

export async function setCachedCreatives<T>(params: {
  userId: string;
  provider: AdProvider;
  accountId: string;
  dateRange: string;
  data: T;
}): Promise<void> {
  const supabase = await createClient();
  const now = new Date();
  const freshUntil = new Date(
    now.getTime() + CREATIVES_FRESH_MINUTES * 60 * 1000
  );
  const staleUntil = new Date(
    now.getTime() + CREATIVES_STALE_HOURS * 60 * 60 * 1000
  );

  await supabase.from("creatives_cache").upsert(
    {
      user_id: params.userId,
      provider: params.provider,
      account_id: params.accountId,
      date_range: versionedKey(params.dateRange),
      data: params.data as unknown as Json,
      fetched_at: now.toISOString(),
      fresh_until: freshUntil.toISOString(),
      stale_until: staleUntil.toISOString(),
    },
    {
      onConflict: "user_id,provider,account_id,date_range",
    }
  );
}

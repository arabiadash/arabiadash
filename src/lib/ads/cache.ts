import { createClient } from "@/lib/supabase/server";

const CACHE_TTL_MINUTES = 15;

export type AdProvider = "meta" | "google" | "tiktok" | "snapchat";

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
    .eq("cache_key", cacheKey)
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

  await supabase.from("insights_cache").upsert(
    {
      connection_id: connectionId,
      provider,
      cache_key: cacheKey,
      data: data as object,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
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

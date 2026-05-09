import { createClient } from "@/lib/supabase/server";

const CACHE_TTL_MINUTES = 15;

export async function getCachedData<T>(
  connectionId: number,
  cacheKey: string
): Promise<T | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("meta_insights_cache")
    .select("data, expires_at")
    .eq("connection_id", connectionId)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !data) return null;

  return data.data as T;
}

export async function setCachedData<T>(
  connectionId: number,
  cacheKey: string,
  data: T
): Promise<void> {
  const supabase = await createClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MINUTES * 60 * 1000);

  await supabase.from("meta_insights_cache").upsert(
    {
      connection_id: connectionId,
      cache_key: cacheKey,
      data: data as object,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    {
      onConflict: "connection_id,cache_key",
    }
  );
}

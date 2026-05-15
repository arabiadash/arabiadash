import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Get the user's default workspace ID.
 *
 * Every user has exactly one default workspace (enforced by partial unique
 * index workspaces_one_default_per_user). This helper is the bridge while
 * Phase 4.4b builds the workspace switcher UI — for now, new connections
 * land in the default workspace automatically.
 *
 * Phase 4.4b will replace this with "active workspace from user session"
 * lookup, but the function signature stays the same.
 *
 * Returns null only if something is structurally wrong (user with no
 * default workspace). Callers should treat null as an error condition.
 */
export async function getDefaultWorkspaceId(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("[workspaces/getDefaultWorkspaceId] DB error:", error);
    return null;
  }

  return data?.id ?? null;
}

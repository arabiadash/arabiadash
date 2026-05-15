import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Minimal workspace shape used by UI surfaces. Derived from the generated
 * Row type so a schema change shows up at the call site, not silently.
 */
export type Workspace = Pick<
  Database["public"]["Tables"]["workspaces"]["Row"],
  "id" | "name" | "icon" | "is_default"
>;

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

/**
 * Get every workspace owned by the user, sorted default-first then
 * alphabetical by name. Drives the switcher dropdown.
 *
 * Returns [] on DB error rather than throwing — the switcher shows
 * "loading" rather than crashing a server-rendered page.
 */
export async function getUserWorkspaces(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, icon, is_default")
    .eq("user_id", userId);

  if (error) {
    console.error("[workspaces/getUserWorkspaces] DB error:", {
      message: error.message,
      code: error.code,
    });
    return [];
  }

  return (data ?? []).slice().sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Create a default workspace for a user. Used by the auto-heal branch in
 * resolveActiveWorkspace when a user somehow has zero workspaces (signup
 * flow + DB constraints should prevent this, but we guard against it).
 *
 * Throws only if the INSERT itself fails — that's a real DB problem worth
 * surfacing to monitoring.
 */
export async function createDefaultWorkspace(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Workspace> {
  const { data, error } = await supabase
    .from("workspaces")
    .insert({
      user_id: userId,
      name: "My Workspace",
      is_default: true,
    })
    .select("id, name, icon, is_default")
    .single();

  if (error || !data) {
    console.error(
      `[workspaces/createDefaultWorkspace] Failed for user ${userId}:`,
      error
    );
    throw new Error("Failed to create default workspace");
  }

  return data;
}

/**
 * Resolve the active workspace from the `?workspace=` URL param.
 *
 * Behavior:
 *   - param missing → default workspace
 *   - param not numeric → default workspace (silent)
 *   - param numeric but not owned by user (or doesn't exist) → default (silent)
 *   - param valid and owned → that workspace
 *
 * Auto-heals when the user has zero workspaces by creating "My Workspace"
 * with is_default=true. This branch should never fire in normal operation —
 * signup flow + the workspaces_one_default_per_user constraint prevent it —
 * but if it does, the user gets a working dashboard instead of a 500.
 *
 * The only case this function still throws is when auto-heal itself fails
 * (real DB problem worth surfacing).
 */
export async function resolveActiveWorkspace(
  supabase: SupabaseClient<Database>,
  userId: string,
  workspaceParam?: string | string[]
): Promise<Workspace> {
  let all = await getUserWorkspaces(supabase, userId);

  if (all.length === 0) {
    console.warn(
      `[resolveActiveWorkspace] User ${userId} has zero workspaces. ` +
        `Auto-creating default. This indicates either a signup flow bug ` +
        `or manual DB manipulation — investigate if seen in production.`
    );
    const created = await createDefaultWorkspace(supabase, userId);
    all = [created];
  }

  const raw = Array.isArray(workspaceParam) ? workspaceParam[0] : workspaceParam;
  const requestedId = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  if (requestedId !== null) {
    const match = all.find((w) => w.id === requestedId);
    if (match) return match;
  }

  const fallback = all.find((w) => w.is_default);
  if (fallback) return fallback;

  // Workspaces exist but none is_default — bad state, but pick first so the
  // dashboard still renders. Logging is enough; no need to 500 the user.
  console.warn(
    `[resolveActiveWorkspace] User ${userId} has workspaces but none is_default. ` +
      `Returning first by sort order. Investigate manual DB state.`
  );
  return all[0];
}

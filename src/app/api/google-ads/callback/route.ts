import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  exchangeCodeForTokens,
  getAccessibleCustomers,
} from "@/lib/google-ads/oauth";
import { getDefaultWorkspaceId } from "@/lib/workspaces";
import { syncGoogleAccountsForUser } from "@/lib/google-ads/sync-accounts-logic";

export const dynamic = "force-dynamic";

const ERROR_BASE = "/dashboard/connections?google_ads=error&reason=";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(ERROR_BASE + reason, request.url));
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    // 1. Google rejected the consent (or upstream error).
    if (oauthError) {
      return errorRedirect(request, encodeURIComponent(oauthError));
    }

    if (!code || !state) {
      return errorRedirect(request, "missing_params");
    }

    // 2. Read the CSRF state from the cookie we set in /api/google-ads/auth.
    const cookieStore = await cookies();
    const storedState = cookieStore.get("google_ads_oauth_state")?.value;

    if (!storedState) {
      return errorRedirect(request, "expired_session");
    }

    // 3. CSRF check.
    if (state !== storedState) {
      return errorRedirect(request, "csrf_mismatch");
    }

    // 4. Auth check — only signed-in users can complete the OAuth flow.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(
        new URL("/login?next=/dashboard/connections", request.url)
      );
    }

    // 5. Exchange the authorization code for tokens.
    const tokens = await exchangeCodeForTokens(code);

    // 6. Discover which Google Ads accounts this user can access.
    const customerIds = await getAccessibleCustomers(tokens.refresh_token);

    if (customerIds.length === 0) {
      return errorRedirect(request, "no_accounts");
    }

    // 7. Persist one row per accessible account into the unified connections
    // table. Service role required because we write tokens the user's session
    // shouldn't have direct write access to via RLS.
    //
    // status='pending' is the Approach C choice: every newly discovered
    // account is recorded but inactive — the user explicitly activates the
    // ones they care about from the connections page (UI lives in Phase 4).
    // The unified adapter only picks up rows with status='active'.
    //
    // Google-specific fields land in metadata; sync-accounts enriches it
    // later with currency/timezone/is_manager/manager_customer_id.
    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    // Resolve the workspace this connection belongs to.
    //
    //   1) Read the workspace cookie set by /api/google-ads/auth.
    //   2) Validate: numeric, owned by this user, not archived. RLS would
    //      catch ownership but we use the admin client here, so the eq()
    //      filters are load-bearing.
    //   3) Fall back to the user's default workspace if the cookie was
    //      missing or didn't validate. Defense-in-depth — never trust a
    //      raw cookie value as a foreign key.
    const workspaceCookie = cookieStore.get("google_ads_oauth_workspace")?.value;
    const requestedId = workspaceCookie ? Number(workspaceCookie) : null;
    let workspaceId: number | null = null;

    if (
      requestedId !== null &&
      Number.isInteger(requestedId) &&
      requestedId > 0
    ) {
      const { data: ownedWorkspace } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("id", requestedId)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle();
      if (ownedWorkspace) workspaceId = ownedWorkspace.id;
    }

    workspaceId ??= await getDefaultWorkspaceId(adminClient, user.id);

    // Consume the workspace cookie either way — keeps the user's browser
    // clean and prevents a stale value from biasing the next OAuth flow.
    cookieStore.delete("google_ads_oauth_workspace");

    if (!workspaceId) {
      return errorRedirect(request, "internal_error");
    }

    // Pre-fetch existing rows to preserve user decisions on re-OAuth.
    // OAuth re-entry should refresh tokens, not relocate accounts or
    // reset activation state. Without this, a user re-OAuthing in
    // workspace B would yank all their accounts (including active ones
    // in workspace A) into workspace B as pending — wiping prior config.
    const { data: existingRows, error: existingError } = await adminClient
      .from("connections")
      .select("account_id, workspace_id, status, account_name, connected_at")
      .eq("user_id", user.id)
      .eq("platform", "google");

    if (existingError) {
      console.error(
        "[google-ads/callback] Failed to load existing rows:",
        existingError
      );
      return errorRedirect(request, "internal_error");
    }

    const existingByAccountId = new Map(
      (existingRows ?? []).map((r) => [r.account_id, r])
    );

    const nowIso = new Date().toISOString();

    const { error: upsertError } = await adminClient
      .from("connections")
      .upsert(
        customerIds.map((customerId) => {
          const existing = existingByAccountId.get(customerId);
          return {
            user_id: user.id,
            // Preserve workspace assignment for existing rows — re-OAuth
            // refreshes tokens, it doesn't move accounts between workspaces.
            workspace_id: existing?.workspace_id ?? workspaceId,
            platform: "google",
            account_id: customerId,
            // Preserve any name enriched by sync-accounts on prior runs.
            account_name: existing?.account_name ?? null,
            // refresh_token stored in access_token (column is provider-agnostic).
            // Always refresh — re-OAuth's primary purpose.
            access_token: tokens.refresh_token,
            // Preserve activation state — user already decided which
            // accounts to activate; don't reset to pending on re-OAuth.
            status: existing?.status ?? "pending",
            metadata: {
              expires_at: expiresAt,
              google_access_token: tokens.access_token,
            },
            // Preserve original connection timestamp for accurate
            // "connected since" semantics.
            connected_at: existing?.connected_at ?? nowIso,
          };
        }),
        { onConflict: "user_id,platform,account_id" }
      );

    if (upsertError) {
      console.error("[google-ads/callback] DB upsert failed:", upsertError);
      return errorRedirect(request, "internal_error");
    }

    // 7b. Auto-populate metadata (currency, timezone_name, account_name)
    // for the rows we just upserted. Without this, the connections live
    // with metadata.currency = null until the user manually re-syncs —
    // which was the root cause of the May 17 currency inflation bug.
    //
    // Failures here are non-fatal: per-account errors are logged, the
    // OAuth flow completes either way, and the user can re-run sync
    // manually from settings. The connections rows are already written;
    // only their enrichment is at risk.
    try {
      const syncResults = await syncGoogleAccountsForUser(adminClient, user.id);
      const failed = syncResults.filter((r) => r.status === "failed").length;
      const skipped = syncResults.filter((r) => r.status === "skipped").length;
      if (failed > 0 || skipped > 0) {
        console.warn(
          `[google-ads/callback] auto-sync partial: ${syncResults.length} total, ` +
            `${failed} failed, ${skipped} skipped (user can re-sync manually)`
        );
      }
    } catch (syncErr) {
      console.error(
        "[google-ads/callback] auto-sync threw:",
        syncErr instanceof Error ? syncErr.message : "unknown"
      );
      // intentional: do NOT redirect to error — connections rows exist,
      // user can re-sync manually.
    }

    // 8. Clear the temporary state cookie.
    cookieStore.delete("google_ads_oauth_state");

    // 9. Send the user back to the connections page with a success marker.
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?google_ads=success&count=${customerIds.length}`,
        request.url
      )
    );
  } catch (err) {
    // Never log tokens or full err object that might contain them.
    console.error(
      "[google-ads/callback] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return errorRedirect(request, "internal_error");
  }
}

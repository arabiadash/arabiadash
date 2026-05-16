import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import type { AdProvider } from "@/lib/ads/cache";

const VALID_PROVIDERS: readonly AdProvider[] = [
  "meta",
  "google",
  "tiktok",
  "snapchat",
] as const;

export async function GET(request: NextRequest) {
  try {
    const provider = (request.nextUrl.searchParams.get("provider") ||
      "meta") as AdProvider;

    // Optional account_id — when provided, scopes the adapter lookup to a
    // specific connection. Without it the adapter falls back to maybeSingle()
    // across all the user's active connections for the provider, which is
    // why callers passing a workspace-scoped account_id matters: it
    // prevents cross-workspace leakage for single-account providers like
    // Meta. Matches the /api/ads/insights pattern.
    const accountId =
      request.nextUrl.searchParams.get("account_id") ?? undefined;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const adapter = await getAdapterForProvider(user.id, provider, accountId);
    if (!adapter) {
      return NextResponse.json(
        { error: "no_connection", provider },
        { status: 404 }
      );
    }

    const account = await adapter.getAccount();
    return NextResponse.json(account);
  } catch (err) {
    console.error("[ads/account] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}

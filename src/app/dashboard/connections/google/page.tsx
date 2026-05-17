import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import GoogleConnectionsClient from "./GoogleConnectionsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";
import { canAddMoreAccounts } from "@/lib/plans";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export interface GoogleAccountRow {
  id: number;
  account_id: string;
  account_name: string | null;
  is_manager: boolean;
  currency: string | null;
}

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function GoogleConnectionsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/connections/google");
  }

  const fullName = user.user_metadata?.full_name || "مستخدم";
  const email = user.email || "";

  // Active-only — pending rows are residual from the legacy "show
  // everything" flow. The new selector establishes intent, so only
  // the user's explicitly-chosen accounts surface here. C11's migration
  // sweeps the old pending rows.
  const adminClient = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const [{ data: connectionsData }, workspaces, activeWorkspace, planCheck] =
    await Promise.all([
      supabase
        .from("connections")
        .select("id, account_id, account_name, metadata")
        .eq("user_id", user.id)
        .eq("platform", "google")
        .eq("status", "active")
        .order("id", { ascending: true }),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
      canAddMoreAccounts(adminClient, user.id, 0),
    ]);

  const accounts: GoogleAccountRow[] = (connectionsData ?? []).map((row) => {
    const metadata =
      (row.metadata as {
        is_manager?: boolean;
        currency?: string;
      }) || {};

    return {
      id: row.id,
      account_id: row.account_id,
      account_name: row.account_name,
      is_manager: metadata.is_manager ?? false,
      currency: metadata.currency ?? null,
    };
  });

  // Sort: MCC first, then alphabetical by name.
  accounts.sort((a, b) => {
    if (a.is_manager !== b.is_manager) {
      return a.is_manager ? -1 : 1;
    }
    return (a.account_name ?? "").localeCompare(b.account_name ?? "");
  });

  return (
    <GoogleConnectionsClient
      fullName={fullName}
      email={email}
      accounts={accounts}
      planLimit={planCheck.limit}
      planTier={planCheck.tier}
      planCurrent={planCheck.current}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

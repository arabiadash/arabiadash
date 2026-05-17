import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { canAddMoreAccounts } from "@/lib/plans";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import MetaConnectionsClient from "./MetaConnectionsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export interface MetaAccountRow {
  id: number;
  account_id: string;
  account_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
}

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function MetaConnectionsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/connections/meta");
  }

  const fullName = user.user_metadata?.full_name || "مستخدم";
  const email = user.email || "";

  const adminClient = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Active-only — the selector establishes intent.
  const [{ data: connectionsData }, workspaces, activeWorkspace, planCheck] =
    await Promise.all([
      supabase
        .from("connections")
        .select("id, account_id, account_name, metadata")
        .eq("user_id", user.id)
        .eq("platform", "meta")
        .eq("status", "active")
        .order("id", { ascending: true }),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
      canAddMoreAccounts(adminClient, user.id, 0),
    ]);

  const accounts: MetaAccountRow[] = (connectionsData ?? []).map((row) => {
    const metadata =
      (row.metadata as {
        currency?: string;
        timezone_name?: string;
        account_status?: number;
      }) || {};

    return {
      id: row.id,
      account_id: row.account_id,
      account_name: row.account_name,
      currency: metadata.currency ?? null,
      timezone_name: metadata.timezone_name ?? null,
      account_status: metadata.account_status ?? null,
    };
  });

  accounts.sort((a, b) =>
    (a.account_name ?? "").localeCompare(b.account_name ?? "")
  );

  return (
    <MetaConnectionsClient
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

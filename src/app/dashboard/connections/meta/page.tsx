import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserAccountsLimit } from "@/lib/plans";
import MetaConnectionsClient from "./MetaConnectionsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export interface MetaAccountRow {
  id: number;
  account_id: string;
  account_name: string | null;
  status: "active" | "pending" | "expired" | "revoked" | "error";
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

  // Parallel: Meta connections + workspace data + account limit.
  const [{ data: connectionsData }, workspaces, activeWorkspace, limit] =
    await Promise.all([
      supabase
        .from("connections")
        .select("id, account_id, account_name, status, metadata")
        .eq("user_id", user.id)
        .eq("platform", "meta")
        .order("id", { ascending: true }),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
      getUserAccountsLimit(user.id),
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
      status: row.status as MetaAccountRow["status"],
      currency: metadata.currency ?? null,
      timezone_name: metadata.timezone_name ?? null,
      account_status: metadata.account_status ?? null,
    };
  });

  // Alphabetical (no MCC concept for Meta).
  accounts.sort((a, b) =>
    (a.account_name ?? "").localeCompare(b.account_name ?? "")
  );

  return (
    <MetaConnectionsClient
      fullName={fullName}
      email={email}
      accounts={accounts}
      limit={limit}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

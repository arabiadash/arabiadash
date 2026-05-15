import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ACTIVE_ACCOUNTS_LIMIT } from "@/lib/plans";
import GoogleConnectionsClient from "./GoogleConnectionsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export interface GoogleAccountRow {
  id: number;
  account_id: string;
  account_name: string | null;
  status: "active" | "pending" | "expired" | "revoked" | "error";
  is_manager: boolean;
  currency: string | null;
  manager_customer_id: string | null;
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

  // Parallel: Google connections + workspace data.
  const [{ data: connectionsData }, workspaces, activeWorkspace] =
    await Promise.all([
      supabase
        .from("connections")
        .select("id, account_id, account_name, status, metadata")
        .eq("user_id", user.id)
        .eq("platform", "google")
        .order("id", { ascending: true }),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
    ]);

  const accounts: GoogleAccountRow[] = (connectionsData ?? []).map((row) => {
    const metadata =
      (row.metadata as {
        is_manager?: boolean;
        currency?: string;
        manager_customer_id?: string | null;
      }) || {};

    return {
      id: row.id,
      account_id: row.account_id,
      account_name: row.account_name,
      status: row.status as GoogleAccountRow["status"],
      is_manager: metadata.is_manager ?? false,
      currency: metadata.currency ?? null,
      manager_customer_id: metadata.manager_customer_id ?? null,
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
      limit={ACTIVE_ACCOUNTS_LIMIT}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

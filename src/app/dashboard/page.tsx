import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import {
  getActiveConnectionsForWorkspace,
  getUserWorkspaces,
  resolveActiveWorkspace,
} from "@/lib/workspaces";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  // Get the current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user, redirect to login (extra safety, middleware also handles this)
  if (!user) {
    redirect("/login");
  }

  // Extract user info
  const fullName = user.user_metadata?.full_name || "مستخدم";
  const companyName = user.user_metadata?.company_name || "";
  const email = user.email || "";

  // First wave: workspace list (for switcher) + active workspace resolution.
  // Both run in parallel; resolveActiveWorkspace re-fetches workspaces
  // internally — accepted in exchange for parallel wall-time.
  const [workspaces, activeWorkspace] = await Promise.all([
    getUserWorkspaces(supabase, user.id),
    resolveActiveWorkspace(supabase, user.id, params.workspace),
  ]);

  // Second wave: connections scoped to the active workspace. Cannot
  // parallelize with the first wave — needs activeWorkspace.id.
  const connections = await getActiveConnectionsForWorkspace(
    supabase,
    user.id,
    activeWorkspace.id
  );

  // Meta is architecturally single-account (factory.ts excludes it from
  // MULTI_ACCOUNT_PROVIDERS). If a workspace somehow ends up with >1 active
  // Meta connection, DashboardClient silently picks the first and ignores
  // the rest — surface that in server logs so we notice if it starts
  // happening in production. Multi-account Meta aggregation is a future
  // phase per ADR-004.
  const metaActiveCount = connections.filter(
    (c) => c.platform === "meta"
  ).length;
  if (metaActiveCount > 1) {
    console.warn(
      `[dashboard] user=${user.id} workspace=${activeWorkspace.id} ` +
        `metaActiveCount=${metaActiveCount} — using first only. ` +
        `Multi-account Meta aggregation deferred.`
    );
  }

  return (
    <DashboardClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      connections={connections}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

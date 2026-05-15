import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";
import {
  getActiveConnectionsCount,
  getUserWorkspaces,
  resolveActiveWorkspace,
} from "@/lib/workspaces";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullName = user.user_metadata?.full_name || "مستخدم";
  const companyName = user.user_metadata?.company_name || "";
  const email = user.email || "";
  const lastSignInAt = user.last_sign_in_at || null;

  // First wave: workspace list + active workspace (parallel).
  const [workspaces, activeWorkspace] = await Promise.all([
    getUserWorkspaces(supabase, user.id),
    resolveActiveWorkspace(supabase, user.id, params.workspace),
  ]);

  // Second wave: per-workspace active-connection counts. Has to wait for
  // the workspace list (we need their IDs); within this wave each count
  // query runs in parallel.
  const counts = await Promise.all(
    workspaces.map((w) => getActiveConnectionsCount(supabase, w.id))
  );
  const workspacesWithCounts = workspaces.map((w, i) => ({
    ...w,
    activeConnections: counts[i],
  }));

  return (
    <SettingsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      lastSignInAt={lastSignInAt}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
      workspacesWithCounts={workspacesWithCounts}
    />
  );
}

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

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

  // Parallel fetches: connections list + workspace list + active workspace
  const [{ data: connectionsData }, workspaces, activeWorkspace] =
    await Promise.all([
      supabase.from("connections").select("platform").eq("status", "active"),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
    ]);

  const connectedPlatforms = (connectionsData ?? []).map((c) => c.platform);

  return (
    <DashboardClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      connectedPlatforms={connectedPlatforms}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

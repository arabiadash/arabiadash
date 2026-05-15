import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReportsClient from "./ReportsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function ReportsPage({ searchParams }: PageProps) {
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

  // Parallel: connections list + workspace data.
  const [{ data: connectionsData }, workspaces, activeWorkspace] =
    await Promise.all([
      supabase.from("connections").select("platform").eq("status", "active"),
      getUserWorkspaces(supabase, user.id),
      resolveActiveWorkspace(supabase, user.id, params.workspace),
    ]);

  const connectedPlatforms = (connectionsData ?? []).map((c) => c.platform);

  return (
    <ReportsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      connectedPlatforms={connectedPlatforms}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}
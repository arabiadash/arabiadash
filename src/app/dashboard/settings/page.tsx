import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";
import { getUserWorkspaces, resolveActiveWorkspace } from "@/lib/workspaces";

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

  // No page-specific fetches here, but parallelize the two workspace queries.
  const [workspaces, activeWorkspace] = await Promise.all([
    getUserWorkspaces(supabase, user.id),
    resolveActiveWorkspace(supabase, user.id, params.workspace),
  ]);

  return (
    <SettingsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      lastSignInAt={lastSignInAt}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

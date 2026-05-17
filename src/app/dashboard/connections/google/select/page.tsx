import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GoogleAccountSelectorClient from "./GoogleAccountSelectorClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function GoogleSelectPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/connections/google/select");

  const params = await searchParams;
  const workspaceParam =
    typeof params.workspace === "string" ? params.workspace : undefined;
  const initialWorkspaceId =
    workspaceParam && /^\d+$/.test(workspaceParam)
      ? Number(workspaceParam)
      : null;
  const fromOAuth = params.from === "oauth";

  return (
    <GoogleAccountSelectorClient
      initialWorkspaceId={initialWorkspaceId}
      fromOAuth={fromOAuth}
    />
  );
}

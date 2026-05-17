import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MetaAccountSelectorClient from "./MetaAccountSelectorClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function MetaSelectPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/connections/meta/select");

  const params = await searchParams;
  const workspaceParam =
    typeof params.workspace === "string" ? params.workspace : undefined;
  const initialWorkspaceId =
    workspaceParam && /^\d+$/.test(workspaceParam)
      ? Number(workspaceParam)
      : null;
  const fromOAuth = params.from === "oauth";

  return (
    <MetaAccountSelectorClient
      initialWorkspaceId={initialWorkspaceId}
      fromOAuth={fromOAuth}
    />
  );
}

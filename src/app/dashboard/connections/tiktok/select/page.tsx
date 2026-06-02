import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TikTokAccountSelectorClient from "./TikTokAccountSelectorClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function TikTokSelectPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/connections/tiktok/select");

  const params = await searchParams;
  const workspaceParam =
    typeof params.workspace === "string" ? params.workspace : undefined;
  const initialWorkspaceId =
    workspaceParam && /^\d+$/.test(workspaceParam)
      ? Number(workspaceParam)
      : null;
  const fromOAuth = params.from === "oauth";

  return (
    <TikTokAccountSelectorClient
      initialWorkspaceId={initialWorkspaceId}
      fromOAuth={fromOAuth}
    />
  );
}

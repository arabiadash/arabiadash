import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ConnectionsClient from "./ConnectionsClient";

export default async function ConnectionsPage() {
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

  const { data: connectionsData } = await supabase
    .from("connections")
    .select("platform")
    .eq("status", "active");

  const connectedPlatforms = (connectionsData ?? []).map((c) => c.platform);

  return (
    <ConnectionsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      initialConnections={connectedPlatforms}
    />
  );
}
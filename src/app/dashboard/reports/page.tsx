import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
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
    <ReportsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      connectedPlatforms={connectedPlatforms}
    />
  );
}
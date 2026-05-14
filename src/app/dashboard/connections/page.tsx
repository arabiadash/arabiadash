import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ConnectionsClient from "./ConnectionsClient";

export const dynamic = "force-dynamic";

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

  // Fetch all connections to compute per-platform counts. For multi-account
  // platforms (Google) we want both active and total so the card can show
  // "3 / 11 مفعّلة" style summaries.
  const { data: connectionsData } = await supabase
    .from("connections")
    .select("platform, status")
    .eq("user_id", user.id);

  const allConnections = connectionsData ?? [];

  // Legacy single-account behavior: a platform is "connected" if at least
  // one row is active. Meta + e-commerce platforms rely on this.
  const connectedPlatforms = Array.from(
    new Set(
      allConnections
        .filter((c) => c.status === "active")
        .map((c) => c.platform)
    )
  );

  // Counts per platform for the multi-account UI variant.
  const platformCounts: Record<string, { active: number; total: number }> = {};
  for (const conn of allConnections) {
    if (!platformCounts[conn.platform]) {
      platformCounts[conn.platform] = { active: 0, total: 0 };
    }
    platformCounts[conn.platform].total += 1;
    if (conn.status === "active") {
      platformCounts[conn.platform].active += 1;
    }
  }

  return (
    <ConnectionsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      initialConnections={connectedPlatforms}
      platformCounts={platformCounts}
    />
  );
}

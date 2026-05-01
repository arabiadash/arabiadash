import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
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

  return (
    <DashboardClient
      fullName={fullName}
      companyName={companyName}
      email={email}
    />
  );
}
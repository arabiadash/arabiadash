import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
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

  return (
    <SettingsClient
      fullName={fullName}
      companyName={companyName}
      email={email}
      lastSignInAt={lastSignInAt}
    />
  );
}

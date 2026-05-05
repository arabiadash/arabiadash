import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdAccounts } from "@/lib/meta/api";
import { SelectAccountClient } from "./SelectAccountClient";

export default async function SelectAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("meta_temp_token")?.value;

  if (!accessToken) {
    redirect("/dashboard/connections?error=meta_session_expired");
  }

  let adAccounts;
  try {
    adAccounts = await getAdAccounts(accessToken);
  } catch (err) {
    console.error("[select-account] Fetch failed:", err);
    redirect("/dashboard/connections?error=meta_fetch_failed");
  }

  if (adAccounts.length === 0) {
    redirect("/dashboard/connections?error=meta_no_ad_accounts");
  }

  return <SelectAccountClient accounts={adAccounts} />;
}

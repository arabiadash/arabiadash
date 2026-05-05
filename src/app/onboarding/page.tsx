import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Defense-in-depth: middleware also covers this, but keep parity here.
  if (user.user_metadata?.onboarding_completed) {
    redirect("/dashboard");
  }

  const fullName = user.user_metadata?.full_name || user.email || "";
  const email = user.email || "";
  const existingBusinessName = user.user_metadata?.company_name || "";

  return (
    <OnboardingClient
      fullName={fullName}
      email={email}
      existingBusinessName={existingBusinessName}
    />
  );
}

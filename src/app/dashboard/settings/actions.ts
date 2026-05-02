"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export async function deleteAccountAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "لم يتم العثور على المستخدم" };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    return {
      success: false,
      error:
        "حذف الحساب غير متاح حالياً. يرجى التواصل مع الدعم الفني لإتمام العملية.",
    };
  }

  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    user.id
  );

  if (deleteError) {
    const msg = deleteError.message.toLowerCase();

    if (msg.includes("not found") || msg.includes("not_found")) {
      return { success: false, error: "لم يتم العثور على الحساب" };
    }

    if (
      msg.includes("permission") ||
      msg.includes("not allowed") ||
      msg.includes("forbidden") ||
      msg.includes("unauthorized")
    ) {
      return {
        success: false,
        error: "ليست لديك صلاحية كافية لحذف هذا الحساب",
      };
    }

    if (msg.includes("rate") || msg.includes("too many")) {
      return {
        success: false,
        error:
          "محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.",
      };
    }

    return {
      success: false,
      error:
        "تعذّر حذف الحساب. يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.",
    };
  }

  // Invalidate the session cookies on the server so the user is fully logged
  // out the moment the redirect lands.
  await supabase.auth.signOut();

  // Throws a framework-handled control-flow exception; lines after this are
  // unreachable on the success path.
  redirect("/login");
}

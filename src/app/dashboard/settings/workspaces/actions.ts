"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { WORKSPACE_LIMIT } from "@/lib/plans";
import {
  getUserWorkspaces,
  getActiveConnectionsCount,
} from "@/lib/workspaces";

// Server-action return shape. `data` carries action-specific payload on
// success (e.g. { id } from createWorkspace); `error` is a user-facing
// Arabic string ready to render in the UI.
type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { error: string };

// Revalidation set — every workspace mutation invalidates these so the
// sidebar switcher and the settings list both refetch on next render.
function revalidateAfterMutation() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------
// Signature is useActionState-compatible: (prevState, formData) → newState.
// The modal in Phase 6 binds it via `useActionState(createWorkspace, null)`.

export async function createWorkspace(
  _prevState: ActionResult<{ id: number }> | null,
  formData: FormData
): Promise<ActionResult<{ id: number }>> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { error: "الاسم مطلوب" };
  if (name.length > 50) return { error: "الاسم يجب أن لا يتجاوز 50 حرفاً" };

  // Plan-limit check. WORKSPACE_LIMIT is currently Infinity; Phase 10 swaps
  // it for a per-plan resolver and this guard starts blocking real users.
  const existing = await getUserWorkspaces(supabase, user.id);
  if (existing.length >= WORKSPACE_LIMIT) {
    return {
      error: `وصلت الحد الأقصى (${WORKSPACE_LIMIT} workspace)`,
    };
  }

  const { data, error } = await supabase
    .from("workspaces")
    .insert({
      user_id: user.id,
      name,
      is_default: false,
    })
    .select("id")
    .single();

  if (error || !data) {
    // 23505 = unique_violation; the partial unique index on (user_id, name)
    // where archived_at IS NULL means duplicate active names get rejected
    // at the DB level. We translate to a friendly Arabic message.
    if (error?.code === "23505") {
      return { error: "يوجد workspace بهذا الاسم بالفعل" };
    }
    console.error("[workspaces/createWorkspace] DB error:", {
      message: error?.message,
      code: error?.code,
    });
    return { error: "تعذّر إنشاء الـ workspace" };
  }

  console.log(
    `[workspace.created] user=${user.id} workspace=${data.id} name="${name}"`
  );

  revalidateAfterMutation();
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// renameWorkspace
// ---------------------------------------------------------------------------
// Direct-args signature. Called from the edit page via useTransition.

export async function renameWorkspace(
  id: number,
  name: string
): Promise<ActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "الاسم مطلوب" };
  if (trimmed.length > 50) return { error: "الاسم يجب أن لا يتجاوز 50 حرفاً" };

  // Fetch existing row for the audit-log "from" value AND to enforce
  // ownership + non-archived state in one shot. RLS would catch ownership
  // anyway, but the maybeSingle()→null path gives us a clean error message.
  const { data: existing } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!existing) return { error: "Workspace غير موجود" };

  // No-op when the name didn't actually change. Saves a DB round-trip and
  // a misleading "renamed" log line.
  if (existing.name === trimmed) return { ok: true };

  const { error } = await supabase
    .from("workspaces")
    .update({ name: trimmed })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "يوجد workspace بهذا الاسم بالفعل" };
    }
    console.error("[workspaces/renameWorkspace] DB error:", {
      message: error.message,
      code: error.code,
    });
    return { error: "تعذّر تعديل الاسم" };
  }

  console.log(
    `[workspace.renamed] user=${user.id} workspace=${id} from="${existing.name}" to="${trimmed}"`
  );

  revalidateAfterMutation();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// archiveWorkspace (soft delete)
// ---------------------------------------------------------------------------

export async function archiveWorkspace(id: number): Promise<ActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, is_default")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!workspace) return { error: "Workspace غير موجود" };

  if (workspace.is_default) {
    return { error: "لا يمكن أرشفة الـ workspace الافتراضي" };
  }

  const activeCount = await getActiveConnectionsCount(supabase, id);
  if (activeCount > 0) {
    const word = activeCount === 1 ? "حساب نشط" : "حسابات نشطة";
    return {
      error: `انقل ${activeCount} ${word} لـ workspace آخر أولاً`,
    };
  }

  const { error } = await supabase
    .from("workspaces")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[workspaces/archiveWorkspace] DB error:", {
      message: error.message,
      code: error.code,
    });
    return { error: "تعذّر أرشفة الـ workspace" };
  }

  console.log(`[workspace.archived] user=${user.id} workspace=${id}`);

  revalidateAfterMutation();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// setWorkspaceAsDefault
// ---------------------------------------------------------------------------
// Two-step update with best-effort rollback. Truly atomic behavior would
// require a Postgres function (RPC); deferred because:
//
//   - The partial unique index workspaces_one_default_per_user already
//     guarantees we never end with two defaults at once — at worst we
//     transiently land at zero defaults if step 2 fails between requests.
//   - Step 2 failing after step 1 succeeded is rare in practice (ownership
//     + non-archived already verified above; only DB-level failures left).
//   - The rollback below restores the prior default in the rare failure
//     case, so end state stays valid.
//
// If we ever see zero-default states in monitoring, promote to RPC.

export async function setWorkspaceAsDefault(
  id: number
): Promise<ActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: target } = await supabase
    .from("workspaces")
    .select("id, is_default")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!target) return { error: "Workspace غير موجود" };
  if (target.is_default) return { ok: true };

  // Capture the current default before we clear it, so we can restore on
  // failure. There should be at most one row here (DB enforces).
  const { data: currentDefault } = await supabase
    .from("workspaces")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  const { error: clearError } = await supabase
    .from("workspaces")
    .update({ is_default: false })
    .eq("user_id", user.id)
    .eq("is_default", true);

  if (clearError) {
    console.error("[workspaces/setWorkspaceAsDefault] clear failed:", {
      message: clearError.message,
      code: clearError.code,
    });
    return { error: "تعذّر تعيين الـ workspace كافتراضي" };
  }

  const { error: setError } = await supabase
    .from("workspaces")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", user.id);

  if (setError) {
    if (currentDefault) {
      // Best-effort rollback. If this also fails we end with zero defaults;
      // the resolveActiveWorkspace fallback (returns all[0]) keeps the UI
      // working, and the next mutation re-establishes a default.
      await supabase
        .from("workspaces")
        .update({ is_default: true })
        .eq("id", currentDefault.id)
        .eq("user_id", user.id);
    }
    console.error("[workspaces/setWorkspaceAsDefault] set failed:", {
      message: setError.message,
      code: setError.code,
    });
    return { error: "تعذّر تعيين الـ workspace كافتراضي" };
  }

  console.log(
    `[workspace.set_default] user=${user.id} workspace=${id}`
  );

  revalidateAfterMutation();
  return { ok: true };
}

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getUserWorkspaces,
  resolveActiveWorkspace,
} from "@/lib/workspaces";
import EditWorkspaceForm from "./EditWorkspaceForm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
};

export default async function EditWorkspacePage({
  params,
  searchParams,
}: PageProps) {
  const [{ id: idParam }, searchParamsResolved] = await Promise.all([
    params,
    searchParams,
  ]);

  // Strict integer parse — Number("12abc") yields NaN, Number("12.5") yields a
  // float; isInteger filters both. parseInt("12abc") would have silently
  // accepted "12abc" as 12, which RLS would then turn into a confusing 404.
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fullName = user.user_metadata?.full_name || "مستخدم";
  const email = user.email || "";

  // RLS already filters by user_id, so the bare .eq("id") suffices for
  // ownership. We still fetch archived_at and reject in code — keeps the
  // "doesn't exist" vs "archived" intent explicit.
  const [{ data: workspace }, workspaces, activeWorkspace] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, name, template, archived_at")
      .eq("id", id)
      .maybeSingle(),
    getUserWorkspaces(supabase, user.id),
    resolveActiveWorkspace(supabase, user.id, searchParamsResolved.workspace),
  ]);

  if (!workspace || workspace.archived_at !== null) notFound();

  // DB CHECK constraint guarantees template ∈ {"ecommerce","reports"}, but
  // the generated type widens it to string. Narrow defensively so any
  // unexpected value (e.g. mid-migration row) falls back to ecommerce.
  const initialTemplate: "ecommerce" | "reports" =
    workspace.template === "reports" ? "reports" : "ecommerce";

  return (
    <EditWorkspaceForm
      workspaceId={workspace.id}
      initialName={workspace.name}
      initialTemplate={initialTemplate}
      fullName={fullName}
      email={email}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
    />
  );
}

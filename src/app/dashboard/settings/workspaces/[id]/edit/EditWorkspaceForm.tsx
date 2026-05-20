"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, Loader2, Menu } from "lucide-react";
import DashboardSidebar from "@/components/dashboard-sidebar";
import type { Workspace } from "@/lib/workspaces";
import {
  renameWorkspace,
  updateWorkspaceTemplate,
} from "@/app/dashboard/settings/workspaces/actions";

interface EditWorkspaceFormProps {
  workspaceId: number;
  initialName: string;
  initialTemplate: "ecommerce" | "reports";
  fullName: string;
  email: string;
  workspaces: Workspace[];
  activeWorkspaceId: number;
}

export default function EditWorkspaceForm({
  workspaceId,
  initialName,
  initialTemplate,
  fullName,
  email,
  workspaces,
  activeWorkspaceId,
}: EditWorkspaceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [template, setTemplate] = useState<"ecommerce" | "reports">(
    initialTemplate
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initial = fullName.charAt(0).toUpperCase();

  // Save is enabled when name is non-empty AND something has changed (name or
  // template). Server enforces the same rules — this is purely UX so a no-op
  // submit doesn't burn a round-trip and a misleading "saved" flash.
  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0;
  const nameChanged = nameValid && trimmedName !== initialName.trim();
  const templateChanged = template !== initialTemplate;
  const isDirty = nameValid && (nameChanged || templateChanged);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty || isPending) return;
    setError(null);
    startTransition(async () => {
      // Apply name first, template second. If name fails, abort before
      // touching template so the UI reflects which field rejected.
      if (nameChanged) {
        const result = await renameWorkspace(workspaceId, name);
        if ("error" in result) {
          setError(result.error);
          return;
        }
      }
      if (templateChanged) {
        const result = await updateWorkspaceTemplate(workspaceId, template);
        if ("error" in result) {
          setError(result.error);
          return;
        }
      }
      router.push("/dashboard/settings");
    });
  };

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard/settings"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />

      <div className="lg:mr-64">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden">
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-3">
              <button className="relative p-2 hover:bg-gray-50 rounded-lg transition">
                <Bell className="w-5 h-5 text-gray-600" />
              </button>
              <div className="lg:hidden w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                {initial}
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8 max-w-2xl">
          <Link
            href="/dashboard/settings"
            className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            العودة للإعدادات
          </Link>

          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            تعديل workspace
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            عدّل اسم الـ workspace أو غيّر القالب حسب طبيعة استخدامك.
          </p>

          <div className="bg-white border border-gray-100 rounded-xl p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="workspace-name"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  اسم الـ workspace
                </label>
                <input
                  id="workspace-name"
                  type="text"
                  required
                  maxLength={50}
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPending}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Template selector (Phase 4.8 M3) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  قالب الـ workspace
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTemplate("ecommerce")}
                    disabled={isPending}
                    className={`p-3 rounded-lg border-2 text-right transition disabled:opacity-50 ${
                      template === "ecommerce"
                        ? "border-indigo-600 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-2xl mb-1">🛒</div>
                    <div className="text-sm font-semibold text-gray-900">
                      متاجر إلكترونية
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      إيرادات + ROAS + مبيعات
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplate("reports")}
                    disabled={isPending}
                    className={`p-3 rounded-lg border-2 text-right transition disabled:opacity-50 ${
                      template === "reports"
                        ? "border-indigo-600 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-2xl mb-1">📊</div>
                    <div className="text-sm font-semibold text-gray-900">
                      تقارير إعلانية
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      ظهور + نقرات + CTR
                    </div>
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Link
                  href="/dashboard/settings"
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition"
                >
                  إلغاء
                </Link>
                <button
                  type="submit"
                  disabled={!isDirty || isPending}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

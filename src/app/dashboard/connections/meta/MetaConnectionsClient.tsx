"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  AlertCircle,
  Menu,
  Bell,
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard-sidebar";
import type { Workspace } from "@/lib/workspaces";
import type { MetaAccountRow } from "./page";

interface MetaConnectionsClientProps {
  fullName: string;
  email: string;
  accounts: MetaAccountRow[];
  planLimit: number;
  planTier: string;
  planCurrent: number;
  workspaces: Workspace[];
  activeWorkspaceId: number;
}

const TIER_LABELS: Record<string, string> = {
  trial: "تجربة مجانية",
  starter: "أساسية",
  growth: "نمو",
  agency: "وكالات",
};

export default function MetaConnectionsClient({
  fullName,
  email,
  accounts: initialAccounts,
  planLimit,
  planTier,
  planCurrent,
  workspaces,
  activeWorkspaceId,
}: MetaConnectionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<MetaAccountRow[]>(initialAccounts);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initial = fullName.charAt(0).toUpperCase();
  const tierLabel = TIER_LABELS[planTier] ?? planTier;
  const limitIsFinite = Number.isFinite(planLimit);
  const limitReached = limitIsFinite && planCurrent >= planLimit;

  useEffect(() => {
    const success = searchParams.get("success");
    const count = searchParams.get("count");
    if (success === "accounts_added" && count) {
      const n = parseInt(count, 10);
      setSuccessMessage(
        `تم إضافة ${n} حساب${n > 1 ? "ات" : ""} Meta بنجاح.`
      );
      setTimeout(() => setSuccessMessage(null), 5000);
      router.replace("/dashboard/connections/meta", { scroll: false });
    }
  }, [searchParams, router]);

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  const handleRemove = async (account: MetaAccountRow) => {
    setRemovingId(account.id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/ads/connections/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.message || data.error || "تعذّر إزالة الحساب");
        setRemovingId(null);
        return;
      }
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      router.refresh();
    } catch {
      showError("خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setRemovingId(null);
    }
  };

  const handleAddMore = () => {
    window.location.assign(
      `/dashboard/connections/meta/select?workspace=${activeWorkspaceId}`
    );
  };

  // Meta uses the OAuth init route for the first-time flow (when zero
  // accounts exist). After at least one account is connected, "Add more"
  // skips OAuth (token already in platform_credentials) and goes straight
  // to the selector.
  const handleConnectFirstTime = () => {
    window.location.assign(`/api/auth/meta/init?workspace=${activeWorkspaceId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard/connections/meta"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />

      <div className="lg:mr-64">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden"
              >
                <Menu className="w-6 h-6" />
              </button>
            </div>
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

        <main className="p-3 sm:p-6 lg:p-8">
          <div className="mb-6">
            <Link
              href="/dashboard/connections"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              العودة للمنصات
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <span className="text-blue-600 font-bold text-lg">M</span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
                حسابات Meta Ads
              </h1>
            </div>
            <p className="text-sm sm:text-base text-gray-600">
              الحسابات التي اخترتها لتظهر بياناتها في التقارير
            </p>
          </div>

          {errorMessage && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-50 border border-green-200 text-green-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">{successMessage}</span>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">
                  حسابات Meta المرتبطة
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {accounts.length}
                  {limitIsFinite && (
                    <span className="text-base font-normal text-gray-400">
                      {" "}
                      / {planLimit} (جميع المنصات)
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  خطتك: {tierLabel}
                </p>
              </div>

              {accounts.length > 0 ? (
                <button
                  onClick={handleAddMore}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  إضافة حسابات أخرى
                </button>
              ) : (
                <button
                  onClick={handleConnectFirstTime}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  ربط حساب Meta
                </button>
              )}
            </div>

            {limitReached && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <strong>وصلت للحد الأقصى ({planLimit} حسابات).</strong>{" "}
                لإضافة حساب آخر، أزِل واحداً من القائمة أو{" "}
                <Link
                  href="/dashboard/settings"
                  className="underline font-semibold"
                >
                  رقّ خطتك
                </Link>
                .
              </div>
            )}
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                لا توجد حسابات Meta مفعّلة
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                ابدأ بربط حساب Meta لرؤية بياناتك
              </p>
              <button
                onClick={handleConnectFirstTime}
                className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition inline-flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                ربط حساب Meta
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const isRemoving = removingId === account.id;
                return (
                  <div
                    key={account.id}
                    className="bg-white border border-green-200 rounded-xl p-4 sm:p-5 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-bold text-lg">
                          M
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-gray-900 truncate mb-1">
                          {account.account_name ||
                            `حساب ${account.account_id}`}
                        </h3>
                        <div
                          className="flex items-center gap-3 text-xs text-gray-500"
                          dir="ltr"
                        >
                          <span>ID: {account.account_id}</span>
                          {account.currency && (
                            <span className="bg-gray-100 px-2 py-0.5 rounded">
                              {account.currency}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemove(account)}
                        disabled={isRemoving}
                        className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50 transition px-3 py-1.5 inline-flex items-center justify-center gap-1.5 min-w-[100px]"
                      >
                        {isRemoving ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            جاري الإزالة...
                          </>
                        ) : (
                          "إلغاء التفعيل"
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

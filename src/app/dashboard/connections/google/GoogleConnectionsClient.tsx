"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  AlertCircle,
  Menu,
  Bell,
  Search,
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard-sidebar";
import type { GoogleAccountRow } from "./page";

interface GoogleConnectionsClientProps {
  fullName: string;
  email: string;
  accounts: GoogleAccountRow[];
  limit: number;
}

export default function GoogleConnectionsClient({
  fullName,
  email,
  accounts: initialAccounts,
  limit,
}: GoogleConnectionsClientProps) {
  const [accounts, setAccounts] =
    useState<GoogleAccountRow[]>(initialAccounts);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const limitReached = activeCount >= limit;

  const initial = fullName.charAt(0).toUpperCase();

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  const handleToggle = async (account: GoogleAccountRow) => {
    const isActivating = account.status !== "active";

    // Block activation if at limit. Backend re-checks; this is UX guard only.
    if (isActivating && limitReached) {
      showError(`الحد الأقصى ${limit} حسابات. ألغِ تفعيل حساب آخر أولاً.`);
      return;
    }

    setTogglingId(account.id);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/ads/connections/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isActivating ? "activate" : "deactivate",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(data.message || data.error || "تعذّر تحديث الحساب");
        setTogglingId(null);
        return;
      }

      // Optimistic update.
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id
            ? { ...a, status: isActivating ? "active" : "pending" }
            : a
        )
      );
    } catch {
      showError("خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleConnectNew = () => {
    window.location.assign("/api/google-ads/auth");
  };

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard/connections/google"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <div className="lg:mr-64">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div className="hidden md:flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 w-64">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="بحث..."
                  className="bg-transparent border-none outline-none text-sm w-full"
                />
              </div>
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

        {/* Page Content */}
        <main className="p-3 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-6">
            <Link
              href="/dashboard/connections"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              العودة للمنصات
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                <span className="text-red-600 font-bold text-lg">G</span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
                إدارة حسابات Google Ads
              </h1>
            </div>
            <p className="text-sm sm:text-base text-gray-600">
              فعّل الحسابات اللي تريد تشوف بياناتها في التقارير
            </p>
          </div>

          {/* Error Toast */}
          {errorMessage && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Stats Bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">الحسابات المفعّلة</p>
                <p className="text-2xl font-bold text-gray-900">
                  {activeCount}
                  <span className="text-base font-normal text-gray-400">
                    {" "}
                    / {limit}
                  </span>
                </p>
              </div>

              <button
                onClick={handleConnectNew}
                className="bg-gradient-to-r from-red-500 to-orange-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                ربط حسابات Google جديدة
              </button>
            </div>

            {limitReached && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <strong>وصلت للحد الأقصى ({limit} حسابات).</strong> لتفعيل حساب
                آخر، ألغِ تفعيل واحد أولاً.
              </div>
            )}
          </div>

          {/* Accounts List */}
          {accounts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                لا توجد حسابات Google مربوطة
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                ابدأ بربط حساب Google Ads لرؤية بياناتك
              </p>
              <button
                onClick={handleConnectNew}
                className="bg-gradient-to-r from-red-500 to-orange-500 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition inline-flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                ربط حساب Google
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const isActive = account.status === "active";
                const isToggling = togglingId === account.id;
                const canActivate = !limitReached || isActive;

                return (
                  <div
                    key={account.id}
                    className={`bg-white border-2 rounded-xl p-4 sm:p-5 transition ${
                      isActive
                        ? "border-green-200 shadow-sm"
                        : "border-gray-100"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Icon */}
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          account.is_manager ? "bg-purple-50" : "bg-red-50"
                        }`}
                      >
                        {account.is_manager ? (
                          <Building2 className="w-6 h-6 text-purple-600" />
                        ) : (
                          <span className="text-red-600 font-bold text-lg">
                            G
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-gray-900 truncate">
                            {account.account_name ||
                              `حساب ${account.account_id}`}
                          </h3>
                          {account.is_manager && (
                            <span className="bg-purple-50 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded">
                              حساب إداري
                            </span>
                          )}
                          {isActive && (
                            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              مفعّل
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>ID: {account.account_id}</span>
                          {account.currency && (
                            <span className="bg-gray-100 px-2 py-0.5 rounded">
                              {account.currency}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Toggle */}
                      <button
                        onClick={() => handleToggle(account)}
                        disabled={isToggling || (!canActivate && !isActive)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 min-w-[120px] ${
                          isActive
                            ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            : canActivate
                              ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:shadow-lg"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        }`}
                      >
                        {isToggling ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            جاري...
                          </>
                        ) : isActive ? (
                          <>
                            <Circle className="w-4 h-4" />
                            إلغاء التفعيل
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            تفعيل
                          </>
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

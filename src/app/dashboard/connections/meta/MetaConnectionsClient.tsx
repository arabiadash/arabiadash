"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  AlertCircle,
  Home,
  Link2,
  FileText,
  Settings,
  HelpCircle,
  Menu,
  X,
  Bell,
  Search,
  BarChart3,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { MetaAccountRow } from "./page";

interface MetaConnectionsClientProps {
  fullName: string;
  email: string;
  accounts: MetaAccountRow[];
  limit: number;
}

// Meta account_status codes — see Meta Marketing API docs.
const META_STATUS_LABELS: Record<
  number,
  { label: string; color: string }
> = {
  1: { label: "نشط", color: "text-green-600" },
  2: { label: "مُعطّل", color: "text-red-600" },
  3: { label: "محذوف", color: "text-gray-500" },
  7: { label: "مُعلّق", color: "text-orange-600" },
  9: { label: "قيد المراجعة", color: "text-yellow-600" },
  100: { label: "قيد الإغلاق", color: "text-red-500" },
  101: { label: "مُغلق", color: "text-gray-700" },
  201: { label: "بانتظار شخصي", color: "text-blue-600" },
  202: { label: "بانتظار طلب", color: "text-blue-600" },
};

export default function MetaConnectionsClient({
  fullName,
  email,
  accounts: initialAccounts,
  limit,
}: MetaConnectionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [accounts, setAccounts] = useState<MetaAccountRow[]>(initialAccounts);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const limitReached = activeCount >= limit;

  const initial = fullName.charAt(0).toUpperCase();

  // Surface the success toast that the OAuth callback redirects with.
  useEffect(() => {
    const success = searchParams.get("success");
    const count = searchParams.get("count");

    if (success === "meta_connected" && count) {
      setSuccessMessage(
        `تم ربط ${count} حساب${parseInt(count) > 1 ? "ات" : ""} Meta بنجاح! فعّل اللي تريد عرضه في التقارير.`
      );
      setTimeout(() => setSuccessMessage(null), 6000);
      router.replace("/dashboard/connections/meta", { scroll: false });
    }
  }, [searchParams, router]);

  const menuItems = [
    { label: "الرئيسية", icon: Home, href: "/dashboard", active: false },
    {
      label: "ربط المنصات",
      icon: Link2,
      href: "/dashboard/connections",
      active: true,
    },
    {
      label: "التقارير",
      icon: FileText,
      href: "/dashboard/reports",
      active: false,
    },
    {
      label: "الإعدادات",
      icon: Settings,
      href: "/dashboard/settings",
      active: false,
    },
    { label: "المساعدة", icon: HelpCircle, href: "#", active: false },
  ];

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  const handleToggle = async (account: MetaAccountRow) => {
    const isActivating = account.status !== "active";

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
    window.location.href = "/api/auth/meta/init";
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 right-0 h-full w-64 bg-white border-l border-gray-200 z-50 transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">ArabiaDash</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {menuItems.map((item, i) => (
            <Link
              key={i}
              href={item.href}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                item.active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 right-0 left-0 p-4 border-t border-gray-100">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {fullName}
              </p>
              <p className="text-xs text-gray-500 truncate">{email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
            {signingOut ? "جاري الخروج..." : "تسجيل الخروج"}
          </button>
        </div>
      </aside>

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
                <span className="text-blue-600 font-bold text-lg">f</span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
                إدارة حسابات Meta Ads
              </h1>
            </div>
            <p className="text-sm sm:text-base text-gray-600">
              فعّل حسابات Facebook و Instagram اللي تريد تشوف بياناتها في التقارير
            </p>
          </div>

          {/* Success Toast (from OAuth callback) */}
          {successMessage && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-50 border border-green-200 text-green-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-xl">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium text-sm">{successMessage}</span>
            </div>
          )}

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
                className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                ربط حسابات Meta جديدة
              </button>
            </div>

            {limitReached && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <strong>وصلت للحد الأقصى ({limit} حسابات).</strong> لتفعيل حساب
                آخر، ألغِ تفعيل واحد أولاً.
              </div>
            )}
          </div>

          {/* Accounts list / empty state */}
          {accounts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-blue-600 font-bold text-2xl">f</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                لا توجد حسابات Meta مربوطة
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                ابدأ بربط حساب Facebook Ads لرؤية بياناتك
              </p>
              <button
                onClick={handleConnectNew}
                className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition inline-flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                ربط حساب Meta
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const isActive = account.status === "active";
                const isToggling = togglingId === account.id;
                const canActivate = !limitReached || isActive;
                const metaStatus = account.account_status
                  ? META_STATUS_LABELS[account.account_status]
                  : null;

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
                      {/* Icon — Facebook "f" */}
                      <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-bold text-lg">
                          f
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-gray-900 truncate">
                            {account.account_name ||
                              `حساب ${account.account_id}`}
                          </h3>
                          {isActive && (
                            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              مفعّل
                            </span>
                          )}
                          {metaStatus && (
                            <span
                              className={`text-xs font-medium ${metaStatus.color}`}
                            >
                              ● {metaStatus.label}
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
                          {account.timezone_name && (
                            <span className="hidden sm:inline">
                              {account.timezone_name}
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

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Search,
  Menu,
  X,
  Home,
  Link2,
  FileText,
  HelpCircle,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Globe,
  Sparkles,
  ShoppingBag,
  Megaphone,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { platforms } from "@/lib/mock-data";

interface ConnectionsClientProps {
  fullName: string;
  companyName: string;
  email: string;
  initialConnections: string[];
  platformCounts: Record<string, { active: number; total: number }>;
}

const META_ERROR_MESSAGES: Record<string, string> = {
  meta_oauth_denied: "تم رفض الربط مع Meta. يمكنك المحاولة مرة أخرى.",
  meta_callback_invalid: "حدث خطأ في عملية الربط. حاول مرة أخرى.",
  meta_state_mismatch: "انتهت صلاحية جلسة الربط. حاول مرة أخرى.",
  meta_no_ad_accounts:
    "لم يتم العثور على حسابات إعلانية مرتبطة بحسابك على Meta.",
  meta_db_error: "تعذّر حفظ بيانات الربط. حاول مرة أخرى.",
  meta_init_failed: "تعذّر بدء عملية الربط. حاول مرة أخرى.",
  meta_callback_failed: "حدث خطأ غير متوقع أثناء الربط. حاول مرة أخرى.",
};

export default function ConnectionsClient({
  fullName,
  companyName,
  email,
  initialConnections,
  platformCounts,
}: ConnectionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Connection states
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] =
    useState<string[]>(initialConnections);
  const [showSuccess, setShowSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep local state in sync if Server re-renders with fresh data
  useEffect(() => {
    setConnectedPlatforms(initialConnections);
  }, [initialConnections]);

  // Handle OAuth callback redirect (?success=... or ?error=...)
  useEffect(() => {
    const success = searchParams.get("success");
    const errorCode = searchParams.get("error");

    if (!success && !errorCode) return;

    if (success === "meta_connected") {
      setShowSuccess("meta");
      setTimeout(() => setShowSuccess(null), 3000);
      router.refresh();
    } else if (errorCode) {
      const msg =
        META_ERROR_MESSAGES[errorCode] ?? "حدث خطأ. حاول مرة أخرى.";
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 4000);
    }

    router.replace("/dashboard/connections", { scroll: false });
  }, [searchParams, router]);

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  // Handle platform connection
  const handleConnect = async (platformId: string) => {
    setConnecting(platformId);
    setErrorMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setConnecting(null);
      showError("انتهت الجلسة. الرجاء تسجيل الدخول مجدداً.");
      router.push("/login");
      return;
    }

    // Meta uses real OAuth flow — redirect to init route, which sets state
    // cookie and redirects to Facebook's OAuth dialog.
    if (platformId === "meta") {
      window.location.href = "/api/auth/meta/init";
      return;
    }

    const { error } = await supabase.from("connections").insert({
      user_id: user.id,
      platform: platformId,
      status: "active",
    });

    setConnecting(null);

    if (error) {
      showError("تعذّر ربط المنصة. حاول مرة أخرى.");
      return;
    }

    // Optimistic UI update + refresh from server
    setConnectedPlatforms((prev) => [...prev, platformId]);
    setShowSuccess(platformId);
    setTimeout(() => setShowSuccess(null), 3000);
    router.refresh();
  };

  // Handle disconnect
  const handleDisconnect = async (platformId: string) => {
    setDisconnecting(platformId);
    setErrorMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setDisconnecting(null);
      showError("انتهت الجلسة. الرجاء تسجيل الدخول مجدداً.");
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("connections")
      .delete()
      .eq("user_id", user.id)
      .eq("platform", platformId);

    setDisconnecting(null);

    if (error) {
      showError("تعذّر فصل المنصة. حاول مرة أخرى.");
      return;
    }

    setConnectedPlatforms((prev) => prev.filter((p) => p !== platformId));
    router.refresh();
  };

  // Handle sign out
  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const initial = fullName.charAt(0).toUpperCase();

  // Sidebar menu items
  const menuItems = [
    { label: "الرئيسية", icon: Home, href: "/dashboard", active: false },
    { label: "ربط المنصات", icon: Link2, href: "/dashboard/connections", active: true },
    { label: "التقارير", icon: FileText, href: "/dashboard/reports", active: false },
    { label: "الإعدادات", icon: Settings, href: "/dashboard/settings", active: false },
    { label: "المساعدة", icon: HelpCircle, href: "#", active: false },
  ];

  // Filter platforms by category
  const adPlatforms = platforms.filter((p) => p.category === "ads");
  const ecomPlatforms = platforms.filter((p) => p.category === "ecommerce");

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
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
                <span className="absolute top-1.5 left-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
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
          <div className="mb-4 sm:mb-8">
            <Link
              href="/dashboard"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              العودة للرئيسية
            </Link>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2 leading-snug">
              ربط المنصات
            </h1>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              اربط حساباتك الإعلانية ومتاجرك لرؤية كل بياناتك في مكان واحد
            </p>
          </div>

          {/* Success Toast */}
          {showSuccess && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-50 border border-green-200 text-green-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">تم ربط الحساب بنجاح! 🎉</span>
            </div>
          )}

          {/* Error Toast */}
          {errorMessage && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Connection Status */}
          {connectedPlatforms.length > 0 && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-4 sm:p-6 mb-4 sm:mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    رائع! لديك {connectedPlatforms.length} منصة متصلة
                  </h3>
                  <p className="text-gray-600 text-sm mb-4">
                    شاهد بياناتك المجمّعة والتقارير الذكية في الصفحة الرئيسية
                  </p>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition text-sm"
                  >
                    عرض الداشبورد
                    <ArrowLeft className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Ad Platforms Section */}
          <div className="mb-6 sm:mb-10">
            <div className="flex items-center gap-2 mb-4 sm:mb-6">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Megaphone className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  منصات الإعلانات
                </h2>
                <p className="text-sm text-gray-500">
                  اربط حساباتك على منصات الإعلانات الرقمية
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {adPlatforms.map((platform) => {
                const isConnected = connectedPlatforms.includes(platform.id);
                const isConnecting = connecting === platform.id;

                // Google is multi-account — show count + manage link instead
                // of the binary connect/disconnect other platforms use.
                const isGoogle = platform.id === "google";
                const googleCounts = isGoogle ? platformCounts.google : undefined;
                const hasGoogleConnections = (googleCounts?.total ?? 0) > 0;

                // Meta is now also multi-account (Phase 4.1.5 unification).
                // Same UX as Google: count + manage link / OAuth init.
                const isMeta = platform.id === "meta";
                const metaCounts = isMeta ? platformCounts.meta : undefined;
                const hasMetaConnections = (metaCounts?.total ?? 0) > 0;

                return (
                  <div
                    key={platform.id}
                    className={`bg-white border-2 rounded-xl p-6 transition ${
                      isConnected
                        ? "border-green-200 shadow-sm"
                        : "border-gray-100 hover:border-indigo-200 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className={`w-12 h-12 ${platform.iconBg} rounded-xl flex items-center justify-center`}
                      >
                        <Globe className="w-6 h-6 text-gray-700" />
                      </div>
                      {platform.popular && !isConnected && (
                        <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-1 rounded">
                          الأكثر استخداماً
                        </span>
                      )}
                      {isConnected && (
                        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-1 rounded inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          متصل
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-gray-900 mb-1">
                      {platform.name}
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      {platform.description}
                    </p>

                    {isGoogle && hasGoogleConnections ? (
                      // Google with at least one connection — show count + manage link
                      <div className="space-y-2">
                        <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
                          <p className="text-xs text-gray-500 mb-0.5">
                            حسابات مفعّلة
                          </p>
                          <p className="text-lg font-bold text-gray-900">
                            {googleCounts!.active}
                            <span className="text-sm font-normal text-gray-400">
                              {" "}
                              / {googleCounts!.total}
                            </span>
                          </p>
                        </div>
                        <Link
                          href="/dashboard/connections/google"
                          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2"
                        >
                          إدارة الحسابات
                        </Link>
                      </div>
                    ) : isGoogle ? (
                      // Google with no connections — kick off OAuth
                      <button
                        onClick={() => {
                          window.location.href = "/api/google-ads/auth";
                        }}
                        className="w-full bg-gradient-to-r from-red-500 to-orange-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
                      >
                        ربط Google Ads
                      </button>
                    ) : isMeta && hasMetaConnections ? (
                      // Meta with at least one connection — count + manage link
                      <div className="space-y-2">
                        <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
                          <p className="text-xs text-gray-500 mb-0.5">
                            حسابات مفعّلة
                          </p>
                          <p className="text-lg font-bold text-gray-900">
                            {metaCounts!.active}
                            <span className="text-sm font-normal text-gray-400">
                              {" "}
                              / {metaCounts!.total}
                            </span>
                          </p>
                        </div>
                        <Link
                          href="/dashboard/connections/meta"
                          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2"
                        >
                          إدارة الحسابات
                        </Link>
                      </div>
                    ) : isMeta ? (
                      // Meta with no connections — kick off OAuth (Facebook blue)
                      <button
                        onClick={() => {
                          window.location.href = "/api/auth/meta/init";
                        }}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
                      >
                        ربط Meta Ads
                      </button>
                    ) : isConnected ? (
                      <div className="space-y-2">
                        <button
                          disabled
                          className="w-full bg-green-50 text-green-700 py-2.5 rounded-lg text-sm font-medium border border-green-200"
                        >
                          ✓ تم الربط بنجاح
                        </button>
                        <button
                          onClick={() => handleDisconnect(platform.id)}
                          disabled={disconnecting === platform.id}
                          className="w-full text-gray-500 hover:text-red-600 py-1.5 text-xs transition disabled:opacity-50 inline-flex items-center justify-center gap-1"
                        >
                          {disconnecting === platform.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              جاري الفصل...
                            </>
                          ) : (
                            "إلغاء الربط"
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform.id)}
                        disabled={isConnecting}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2 disabled:opacity-70"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {platform.id === "meta"
                              ? "جاري التوجيه إلى Meta..."
                              : "جاري الربط..."}
                          </>
                        ) : (
                          "ربط الحساب"
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* E-commerce Section */}
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  المتاجر الإلكترونية
                </h2>
                <p className="text-sm text-gray-500">
                  اربط متجرك لقياس المبيعات الفعلية
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ecomPlatforms.map((platform) => {
                const isConnected = connectedPlatforms.includes(platform.id);
                const isConnecting = connecting === platform.id;

                return (
                  <div
                    key={platform.id}
                    className={`bg-white border-2 rounded-xl p-6 transition ${
                      isConnected
                        ? "border-green-200 shadow-sm"
                        : "border-gray-100 hover:border-indigo-200 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className={`w-12 h-12 ${platform.iconBg} rounded-xl flex items-center justify-center`}
                      >
                        <ShoppingBag className="w-6 h-6 text-gray-700" />
                      </div>
                      {platform.popular && !isConnected && (
                        <span className="bg-purple-50 text-purple-700 text-xs font-semibold px-2 py-1 rounded">
                          الأكثر استخداماً
                        </span>
                      )}
                      {isConnected && (
                        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-1 rounded inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          متصل
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-gray-900 mb-1">
                      {platform.name}
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      {platform.description}
                    </p>

                    {isConnected ? (
                      <div className="space-y-2">
                        <button
                          disabled
                          className="w-full bg-green-50 text-green-700 py-2.5 rounded-lg text-sm font-medium border border-green-200"
                        >
                          ✓ تم الربط بنجاح
                        </button>
                        <button
                          onClick={() => handleDisconnect(platform.id)}
                          disabled={disconnecting === platform.id}
                          className="w-full text-gray-500 hover:text-red-600 py-1.5 text-xs transition disabled:opacity-50 inline-flex items-center justify-center gap-1"
                        >
                          {disconnecting === platform.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              جاري الفصل...
                            </>
                          ) : (
                            "إلغاء الربط"
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform.id)}
                        disabled={isConnecting}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2 disabled:opacity-70"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            جاري الربط...
                          </>
                        ) : (
                          "ربط المتجر"
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info Banner */}
          <div className="mt-6 sm:mt-10 bg-blue-50 border border-blue-100 rounded-xl p-4 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-1">
                  وضع تجريبي - بيانات افتراضية
                </h3>
                <p className="text-sm text-gray-600">
                  هذا الإصدار التجريبي يستخدم بيانات افتراضية لعرض كيف ستبدو
                  المنصة. التكامل الفعلي مع APIs يأتي قريباً!
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
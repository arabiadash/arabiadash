"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
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
  Plus,
  ArrowLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  mockPlatformPerformance,
  platformNameToId,
  getConnectedAdPlatforms,
} from "@/lib/mock-data";
import { useInsights } from "@/lib/hooks/use-insights";
import { useCurrency } from "@/lib/contexts/currency-context";
import { aggregateInsights, getSpend, getRevenue } from "@/lib/meta/metrics";
import {
  formatAndConvert,
  formatCurrency as formatCurrencyWithSymbol,
  convertCurrency,
  CURRENCY_LABELS,
  type Currency,
} from "@/lib/currency";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import type { MetaInsight } from "@/lib/meta/api";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DashboardClientProps {
  fullName: string;
  companyName: string;
  email: string;
  connectedPlatforms: string[];
}

interface ChartDataPoint {
  date: string;
  dayLabel: string;
  spend: number;
  revenue: number;
  roas: number;
}

const ARABIC_DAYS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return ARABIC_DAYS[date.getDay()];
}

export default function DashboardClient({
  fullName,
  companyName,
  email,
  connectedPlatforms,
}: DashboardClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Real Meta data hooks
  const {
    insights,
    loading: insightsLoading,
    error: insightsError,
    noConnection,
  } = useInsights("30d", "account");
  const { currency } = useCurrency();
  const [accountCurrency, setAccountCurrency] = useState<Currency>("USD");

  useEffect(() => {
    fetch("/api/meta/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const c = data?.currency;
        if (c === "USD" || c === "SAR") {
          setAccountCurrency(c);
        }
      })
      .catch(() => {});
  }, []);

  const aggregated = useMemo(
    () => (insights.length === 0 ? null : aggregateInsights(insights)),
    [insights]
  );

  // Daily insights for the Performance Chart (last 7 days)
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    setChartLoading(true);
    fetch("/api/meta/insights?range=7d&time_increment=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.data && Array.isArray(data.data)) {
          const points = (data.data as MetaInsight[]).map((insight) => {
            const spend = getSpend(insight);
            const revenue = getRevenue(insight);
            return {
              date: insight.date_start,
              dayLabel: formatDayLabel(insight.date_start),
              spend,
              revenue,
              roas: spend > 0 ? revenue / spend : 0,
            };
          });
          setChartData(points);
        }
      })
      .catch((err) => console.error("[chart] Error:", err))
      .finally(() => setChartLoading(false));
  }, []);

  const displayChartData = useMemo(
    () =>
      chartData.map((point) => ({
        ...point,
        displaySpend: convertCurrency(point.spend, accountCurrency, currency),
        displayRevenue: convertCurrency(
          point.revenue,
          accountCurrency,
          currency
        ),
      })),
    [chartData, accountCurrency, currency]
  );

  // Check if user has any connections
  const hasConnections = connectedPlatforms.length > 0;

  // Filter Platform Performance mock data by connected ad platforms.
  // Only used when there are 2+ connected platforms (chart hidden otherwise).
  const connectedAdPlatforms = useMemo(
    () => getConnectedAdPlatforms(connectedPlatforms),
    [connectedPlatforms]
  );

  const filteredPlatformPerformance = useMemo(
    () =>
      mockPlatformPerformance.filter((p) =>
        connectedAdPlatforms.includes(platformNameToId(p.name))
      ),
    [connectedAdPlatforms]
  );

  // Real KPI cards from aggregated insights (Meta-only for now)
  const kpiCards = useMemo(() => {
    if (!aggregated) return [];
    return [
      {
        label: "إجمالي الإنفاق الإعلاني",
        value: formatAndConvert(aggregated.spend, accountCurrency, currency),
        icon: DollarSign,
        color: "indigo",
      },
      {
        label: "إجمالي الإيرادات",
        value: formatAndConvert(aggregated.revenue, accountCurrency, currency),
        icon: ShoppingCart,
        color: "green",
      },
      {
        label: "العائد على الإعلان (ROAS)",
        value: `${aggregated.roas.toFixed(2)}x`,
        icon: TrendingUp,
        color: "purple",
      },
      {
        label: "عدد المبيعات",
        value: aggregated.purchases.toLocaleString("en-US"),
        icon: Users,
        color: "blue",
      },
    ];
  }, [aggregated, accountCurrency, currency]);

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
    { label: "الرئيسية", icon: Home, href: "/dashboard", active: true },
    { label: "ربط المنصات", icon: Link2, href: "/dashboard/connections", active: false },
    { label: "التقارير", icon: FileText, href: "/dashboard/reports", active: false },
    { label: "الإعدادات", icon: Settings, href: "/dashboard/settings", active: false },
    { label: "المساعدة", icon: HelpCircle, href: "#", active: false },
  ];

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
              <CurrencyToggle />
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
          {/* Welcome Section */}
          <div className="mb-4 sm:mb-8 flex items-center justify-between flex-wrap gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2 break-words leading-snug">
                مرحباً، {fullName} 👋
              </h1>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                {companyName
                  ? `إليك نظرة عامة على أداء ${companyName}`
                  : "إليك نظرة عامة على أداء حساباتك"}
              </p>
            </div>
            {hasConnections && (
              <div className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-sm font-medium border border-green-100">
                {connectedPlatforms.length} منصة متصلة
              </div>
            )}
          </div>

          {/* Empty State (only if no connections) */}
          {!hasConnections && (
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-5 sm:p-8 mb-4 sm:mb-8">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                      ابدأ بربط منصاتك الإعلانية
                    </h3>
                    <p className="text-gray-600 text-sm">
                      اربط Meta Ads و Google Ads ومتجرك على سلة لرؤية بياناتك الفعلية
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/connections"
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:shadow-lg transition flex items-center gap-2 whitespace-nowrap"
                >
                  <Plus className="w-5 h-5" />
                  ربط منصة
                </Link>
              </div>
            </div>
          )}

          {/* Stats Grid - Real Meta data */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-8">
            {noConnection ? (
              <div className="col-span-2 lg:col-span-4 bg-white border border-gray-100 rounded-xl p-6 sm:p-8 text-center">
                <div className="w-12 h-12 mx-auto bg-indigo-50 rounded-xl flex items-center justify-center mb-3">
                  <Link2 className="w-6 h-6 text-indigo-600" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                  اربط حساب Meta لعرض المؤشرات الفعلية
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  ستظهر هنا بيانات الإنفاق والإيرادات والـ ROAS من حسابك على
                  Meta Ads
                </p>
                <Link
                  href="/dashboard/connections"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:shadow-lg transition"
                >
                  <Plus className="w-5 h-5" />
                  ربط Meta
                </Link>
              </div>
            ) : insightsError ? (
              <div className="col-span-2 lg:col-span-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm text-center">
                تعذّر جلب البيانات من Meta. حاول تحديث الصفحة.
              </div>
            ) : insightsLoading || !aggregated ? (
              [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-xl p-3 sm:p-6 animate-pulse"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gray-200 mb-2 sm:mb-4"></div>
                  <div className="h-3 bg-gray-200 rounded mb-2 w-3/4"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))
            ) : (
              kpiCards.map((stat, i) => {
                const colorClasses: Record<string, string> = {
                  indigo: "bg-indigo-50 text-indigo-600",
                  green: "bg-green-50 text-green-600",
                  purple: "bg-purple-50 text-purple-600",
                  blue: "bg-blue-50 text-blue-600",
                };

                return (
                  <div
                    key={i}
                    className="bg-white border border-gray-100 rounded-xl p-3 sm:p-6 hover:shadow-md transition"
                  >
                    <div className="flex items-center justify-between mb-2 sm:mb-4">
                      <div
                        className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center ${
                          colorClasses[stat.color]
                        }`}
                      >
                        <stat.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">
                      {stat.label}
                    </p>
                    <div
                      className="flex items-baseline gap-1 flex-wrap"
                      dir="ltr"
                    >
                      <span className="text-lg sm:text-2xl font-bold text-gray-900">
                        {stat.value}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Charts Section - Only show if has connections */}
          {hasConnections && (
            <>
              {/* Performance Chart - Real Meta data */}
              <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="flex items-center justify-between mb-3 sm:mb-6">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                      أداء آخر 7 أيام
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500">
                      الإنفاق مقابل الإيرادات (بـ{" "}
                      {CURRENCY_LABELS[currency].nameAr})
                    </p>
                  </div>
                </div>
                <div dir="ltr" className="h-56 sm:h-72">
                  {chartLoading ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="animate-pulse text-gray-400 text-sm">
                        جاري تحميل البيانات...
                      </div>
                    </div>
                  ) : displayChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-gray-500 text-sm">
                        لا توجد بيانات لآخر 7 أيام
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={displayChartData}>
                        <defs>
                          <linearGradient
                            id="colorRevenue"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#10b981"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#10b981"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="colorSpend"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#6366f1"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#6366f1"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis
                          dataKey="dayLabel"
                          stroke="#9ca3af"
                          fontSize={12}
                        />
                        <YAxis stroke="#9ca3af" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                          }}
                          formatter={(value, name) => {
                            const num =
                              typeof value === "number" ? value : 0;
                            return [
                              formatCurrencyWithSymbol(num, currency),
                              name as string,
                            ];
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="displayRevenue"
                          name="الإيرادات"
                          stroke="#10b981"
                          fillOpacity={1}
                          fill="url(#colorRevenue)"
                        />
                        <Area
                          type="monotone"
                          dataKey="displaySpend"
                          name="الإنفاق"
                          stroke="#6366f1"
                          fillOpacity={1}
                          fill="url(#colorSpend)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Secondary Charts: Platform Performance (multi-platform only) + ROAS Trend */}
              <div
                className={`grid gap-3 sm:gap-6 mb-4 sm:mb-6 ${
                  connectedPlatforms.length > 1
                    ? "lg:grid-cols-2"
                    : "lg:grid-cols-1"
                }`}
              >
                {/* Platform Performance — hidden when only 1 platform connected */}
                {connectedPlatforms.length > 1 && (
                  <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6">
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                      الأداء حسب المنصة
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-6">
                      توزيع الإيرادات على المنصات
                    </p>
                    <div dir="ltr" className="h-52 sm:h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={filteredPlatformPerformance}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f3f4f6"
                          />
                          <XAxis
                            dataKey="name"
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "white",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                            }}
                          />
                          <Bar
                            dataKey="revenue"
                            name="الإيرادات"
                            fill="#6366f1"
                            radius={[8, 8, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* ROAS Trend — Real Meta data, daily for last 7 days */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                    اتجاه ROAS
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-6">
                    العائد على الإنفاق الإعلاني (آخر 7 أيام)
                  </p>
                  <div dir="ltr" className="h-52 sm:h-64">
                    {chartLoading ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="animate-pulse text-gray-400 text-sm">
                          جاري تحميل البيانات...
                        </div>
                      </div>
                    ) : displayChartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-gray-500 text-sm">
                          لا توجد بيانات لآخر 7 أيام
                        </p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={displayChartData}>
                          <defs>
                            <linearGradient
                              id="colorRoas"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor="#a855f7"
                                stopOpacity={0.4}
                              />
                              <stop
                                offset="95%"
                                stopColor="#a855f7"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f3f4f6"
                          />
                          <XAxis
                            dataKey="dayLabel"
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "white",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                            }}
                            formatter={(value, name) => {
                              const num =
                                typeof value === "number" ? value : 0;
                              return [`${num.toFixed(2)}x`, name as string];
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="roas"
                            name="ROAS"
                            stroke="#a855f7"
                            fillOpacity={1}
                            fill="url(#colorRoas)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

              {/* Top Campaigns table moved to /dashboard/reports */}
            </>
          )}

          {/* Two Column Layout - Quick Setup (only if no connections) */}
          {!hasConnections && (
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white border border-gray-100 rounded-xl p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  خطوات البدء
                </h3>
                <div className="space-y-3">
                  {[
                    {
                      title: "أكدت إيميلك",
                      description: "تم تأكيد حسابك بنجاح",
                      completed: true,
                    },
                    {
                      title: "اربط منصة إعلانية",
                      description: "ابدأ بـ Meta Ads أو Google Ads",
                      completed: false,
                    },
                    {
                      title: "اربط متجرك",
                      description: "سلة، زد، أو شوبيفاي",
                      completed: false,
                    },
                    {
                      title: "شاهد تقاريرك الأولى",
                      description: "البيانات تتحدث كل ساعة",
                      completed: false,
                    },
                  ].map((step, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition"
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          step.completed
                            ? "bg-green-100 text-green-600"
                            : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {step.completed ? (
                          <span className="text-sm">✓</span>
                        ) : (
                          <span className="text-xs font-bold">{i + 1}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-gray-900">
                          {step.title}
                        </p>
                        <p className="text-xs text-gray-500">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  معلومات الحساب
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">الاسم الكامل</p>
                    <p className="font-semibold text-gray-900">{fullName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">البريد الإلكتروني</p>
                    <p className="font-semibold text-gray-900" dir="ltr">
                      {email}
                    </p>
                  </div>
                  {companyName && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">الشركة</p>
                      <p className="font-semibold text-gray-900">{companyName}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500 mb-1">الباقة</p>
                    <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-1 rounded">
                      تجربة مجانية - 14 يوم
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
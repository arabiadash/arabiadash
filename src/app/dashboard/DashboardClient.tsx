"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
  Bell,
  Search,
  Menu,
  Link2,
  Plus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard-sidebar";
import DashboardEmptyState from "@/components/dashboard-empty-state";
import type { Workspace, WorkspaceConnection } from "@/lib/workspaces";
import {
  mockPlatformPerformance,
  platformNameToId,
  getConnectedAdPlatforms,
} from "@/lib/mock-data";
import {
  useInsights,
  dateRangeValueToOptions,
} from "@/lib/hooks/use-insights";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useDateRangeStorage } from "@/lib/hooks/use-date-range-storage";
import { useElementHeight } from "@/lib/hooks/useElementHeight";
import {
  computePreviousPeriod,
  computeDelta,
} from "@/lib/period-comparison";
import {
  formatAndConvert,
  formatCurrency as formatCurrencyWithSymbol,
  convertCurrency,
  CURRENCY_LABELS,
  type Currency,
} from "@/lib/currency";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  formatChartDayLabel,
  formatChartTooltipLabel,
  type DateRangeValue,
} from "@/lib/ads/types";
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
  /**
   * Active connections scoped to the active workspace (filtered server-side
   * in page.tsx via getActiveConnectionsForWorkspace). The dashboard derives
   * `connectedPlatforms` from this for legacy UI bits, and picks the Meta
   * account_id from it to scope the useInsights queries.
   */
  connections: WorkspaceConnection[];
  workspaces: Workspace[];
  activeWorkspaceId: number;
}

function getDayCount(range: DateRangeValue): number {
  if (range.type === "preset") {
    const today = new Date();
    const map: Record<string, number> = {
      today: 1,
      yesterday: 1,
      "7d": 7,
      "14d": 14,
      this_month: today.getDate(),
      last_month: new Date(
        today.getFullYear(),
        today.getMonth(),
        0
      ).getDate(),
      "30d": 30,
      "90d": 90,
      lifetime: 0,
    };
    return map[range.preset] ?? 0;
  }
  const ms =
    new Date(range.until).getTime() - new Date(range.since).getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
}


export default function DashboardClient({
  fullName,
  companyName,
  email,
  connections,
  workspaces,
  activeWorkspaceId,
}: DashboardClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Derived from the workspace-scoped connections. Keeping the existing
  // `connectedPlatforms` shape used throughout the JSX avoids touching
  // every usage site — the underlying data still flows from the server.
  const connectedPlatforms = useMemo(
    () => Array.from(new Set(connections.map((c) => c.platform))),
    [connections]
  );

  // Meta is single-account: the active workspace has at most one Meta
  // connection. We pass its account_id to useInsights so the API picks
  // exactly that connection — important after Phase 4.2 because the
  // user may have Meta connections in multiple workspaces.
  const metaAccountId = useMemo(
    () =>
      connections.find((c) => c.platform === "meta")?.account_id ?? undefined,
    [connections]
  );

  // Date range (persisted to localStorage, synced cross-tab)
  const [dateRange, setDateRange] = useDateRangeStorage();

  // KPI insights — single aggregate row for the selected range
  const {
    insights,
    loading: insightsLoading,
    error: insightsError,
    noConnection,
  } = useInsights({
    ...dateRangeValueToOptions(dateRange),
    level: "account",
    accountId: metaAccountId,
  });
  const { currency } = useCurrency();
  const [accountCurrency, setAccountCurrency] = useState<Currency>("USD");

  // Measure each chart's wrapper height so we can pass an explicit pixel
  // value to ResponsiveContainer. Avoids Recharts' `width(-1)/height(-1)`
  // warning that fires on the first render before its ResizeObserver settles.
  const [perfRef, perfHeight] = useElementHeight<HTMLDivElement>();
  const [platformRef, platformHeight] = useElementHeight<HTMLDivElement>();
  const [roasRef, roasHeight] = useElementHeight<HTMLDivElement>();

  useEffect(() => {
    fetch("/api/ads/account?provider=meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const c = data?.currency;
        if (c === "USD" || c === "SAR") {
          setAccountCurrency(c);
        }
      })
      .catch(() => {});
  }, []);

  // Aggregate UnifiedInsight[] into totals + recalculated ROAS.
  // Range='30d' typically returns one row, but reduce handles N rows safely.
  const aggregated = useMemo(() => {
    if (insights.length === 0) return null;
    const totals = insights.reduce(
      (acc, ins) => ({
        spend: acc.spend + ins.spend,
        revenue: acc.revenue + ins.revenue,
        purchases: acc.purchases + ins.purchases,
      }),
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      ...totals,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
    };
  }, [insights]);

  // Previous period for KPI delta comparison (null when lifetime)
  const previousPeriod = useMemo(
    () => computePreviousPeriod(dateRange),
    [dateRange]
  );

  // Fetch previous period insights. When previousPeriod is null we still need
  // a valid options object (useInsights doesn't support skip natively); the
  // previousSummary guard below returns null so deltas are hidden in lifetime.
  const { insights: previousInsights } = useInsights(
    previousPeriod
      ? { customRange: previousPeriod, level: "account", accountId: metaAccountId }
      : { range: "30d", level: "account", accountId: metaAccountId }
  );

  const previousSummary = useMemo(() => {
    if (!previousPeriod) return null;
    const totals = previousInsights.reduce(
      (acc, i) => ({
        spend: acc.spend + i.spend,
        revenue: acc.revenue + i.revenue,
        purchases: acc.purchases + i.purchases,
      }),
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      spend: totals.spend,
      revenue: totals.revenue,
      purchases: totals.purchases,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
    };
  }, [previousInsights, previousPeriod]);

  // Smart time_increment: daily breakdown for non-lifetime ranges (all presets
  // except 'lifetime' are ≤ 90 days). Custom ranges check explicit length.
  const dayCount = getDayCount(dateRange);
  const shouldShowDailyBreakdown =
    dateRange.type === "custom"
      ? dayCount <= 90
      : dateRange.preset !== "lifetime";

  // Lifetime can't be shown as a meaningful chart (one big aggregate row).
  // Fallback: chart shows last 90 days while KPIs still aggregate the full lifetime.
  const isLifetime =
    dateRange.type === "preset" && dateRange.preset === "lifetime";

  const chartDateRange: DateRangeValue = isLifetime
    ? { type: "preset", preset: "90d" }
    : dateRange;

  const chartDayCount = getDayCount(chartDateRange);
  const chartShouldShowDaily =
    chartDateRange.type === "custom"
      ? chartDayCount <= 90
      : chartDateRange.preset !== "lifetime";

  // Chart insights — uses chartDateRange so lifetime falls back to 90d
  const { insights: chartInsights, loading: chartLoading } = useInsights({
    ...dateRangeValueToOptions(chartDateRange),
    level: "account",
    timeIncrement: chartShouldShowDaily ? 1 : undefined,
    accountId: metaAccountId,
  });

  const displayChartData = useMemo(
    () =>
      chartInsights.map((insight) => ({
        date: insight.dateStart,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(insight.dateStart, chartDayCount)
          : insight.dateStart,
        tooltipLabel: formatChartTooltipLabel(insight.dateStart),
        roas: insight.roas,
        displaySpend: convertCurrency(
          insight.spend,
          accountCurrency,
          currency
        ),
        displayRevenue: convertCurrency(
          insight.revenue,
          accountCurrency,
          currency
        ),
      })),
    [
      chartInsights,
      chartShouldShowDaily,
      chartDayCount,
      accountCurrency,
      currency,
    ]
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
        delta: previousSummary
          ? computeDelta(aggregated.spend, previousSummary.spend)
          : null,
      },
      {
        label: "إجمالي الإيرادات",
        value: formatAndConvert(aggregated.revenue, accountCurrency, currency),
        icon: ShoppingCart,
        color: "green",
        delta: previousSummary
          ? computeDelta(aggregated.revenue, previousSummary.revenue)
          : null,
      },
      {
        label: "العائد على الإعلان (ROAS)",
        value: `${aggregated.roas.toFixed(2)}x`,
        icon: TrendingUp,
        color: "purple",
        delta: previousSummary
          ? computeDelta(aggregated.roas, previousSummary.roas)
          : null,
      },
      {
        label: "عدد المبيعات",
        value: aggregated.purchases.toLocaleString("en-US"),
        icon: Users,
        color: "blue",
        delta: previousSummary
          ? computeDelta(aggregated.purchases, previousSummary.purchases)
          : null,
      },
    ];
  }, [aggregated, accountCurrency, currency, previousSummary]);

  const initial = fullName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
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
            <div className="flex items-center gap-3 flex-wrap">
              {hasConnections && (
                <DateRangePicker value={dateRange} onChange={setDateRange} />
              )}
              {hasConnections && (
                <div className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-sm font-medium border border-green-100">
                  {connectedPlatforms.length} منصة متصلة
                </div>
              )}
            </div>
          </div>

          {/* Empty state — workspace has zero active connections.
              Replaces 28 lines of inline JSX with the shared
              DashboardEmptyState so the shape can be reused by reports
              and other surfaces in later phases. */}
          {!hasConnections && (
            <div className="mb-4 sm:mb-8">
              <DashboardEmptyState />
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

                const showDelta = stat.delta && stat.delta.isFinite;
                const deltaValue = stat.delta?.value ?? 0;
                const isNegligible =
                  showDelta && Math.abs(deltaValue) < 0.1;
                const deltaColor = !showDelta
                  ? "text-gray-400"
                  : isNegligible
                    ? "text-gray-500"
                    : deltaValue > 0
                      ? "text-green-600"
                      : "text-red-600";
                const DeltaIcon =
                  !showDelta || isNegligible
                    ? null
                    : deltaValue > 0
                      ? ArrowUp
                      : ArrowDown;

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

                    {showDelta ? (
                      <div
                        className={`flex items-center gap-0.5 text-[10px] sm:text-xs mt-1 ${deltaColor}`}
                        dir="ltr"
                      >
                        {DeltaIcon && <DeltaIcon className="w-3 h-3" />}
                        <span className="font-semibold">
                          {Math.abs(deltaValue).toFixed(1)}%
                        </span>
                        <span className="text-gray-400 mr-1">
                          vs السابقة
                        </span>
                      </div>
                    ) : previousPeriod ? (
                      <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                        — vs السابقة
                      </div>
                    ) : null}
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
                      أداء الفترة
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500">
                      {`توزيع يومي بـ ${CURRENCY_LABELS[currency].nameAr}`}
                    </p>
                  </div>
                </div>
                <div ref={perfRef} dir="ltr" className="h-56 sm:h-72">
                  {!chartShouldShowDaily ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <p className="text-sm text-gray-500">
                        التوزيع اليومي متاح للفترات حتى 90 يوم
                      </p>
                    </div>
                  ) : chartLoading ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="animate-pulse text-gray-400 text-sm">
                        جاري تحميل البيانات...
                      </div>
                    </div>
                  ) : displayChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-gray-500 text-sm">
                        لا توجد بيانات لهذه الفترة
                      </p>
                    </div>
                  ) : (
                    perfHeight > 0 && (
                    <ResponsiveContainer width="100%" height={perfHeight}>
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
                          labelFormatter={(label, payload) => {
                            const data = payload?.[0]?.payload as
                              | { tooltipLabel?: string }
                              | undefined;
                            return data?.tooltipLabel ?? label;
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
                          dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="displaySpend"
                          name="الإنفاق"
                          stroke="#6366f1"
                          fillOpacity={1}
                          fill="url(#colorSpend)"
                          dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                    )
                  )}
                </div>

                {/* Lifetime disclaimer */}
                {isLifetime && (
                  <div className="mt-3 p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex items-start gap-2">
                    <span className="text-blue-600 flex-shrink-0">ℹ️</span>
                    <p className="text-xs sm:text-sm text-blue-900 leading-relaxed">
                      <strong>ملاحظة:</strong> الرسم البياني يعرض آخر 90 يوم
                      فقط للتفاصيل الدقيقة. البطاقات أعلاه تعرض الإجمالي لكل
                      الفترة منذ بداية الحساب.
                    </p>
                  </div>
                )}
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
                    <div ref={platformRef} dir="ltr" className="h-52 sm:h-64">
                      {platformHeight > 0 && (
                      <ResponsiveContainer width="100%" height={platformHeight}>
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
                      )}
                    </div>
                  </div>
                )}

                {/* ROAS Trend — Real Meta data, daily for ranges ≤ 90 days */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                    اتجاه ROAS
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-6">
                    العائد على الإنفاق الإعلاني
                  </p>
                  <div ref={roasRef} dir="ltr" className="h-52 sm:h-64">
                    {!chartShouldShowDaily ? (
                      <div className="h-full flex items-center justify-center text-center px-4">
                        <p className="text-sm text-gray-500">
                          التوزيع اليومي متاح للفترات حتى 90 يوم
                        </p>
                      </div>
                    ) : chartLoading ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="animate-pulse text-gray-400 text-sm">
                          جاري تحميل البيانات...
                        </div>
                      </div>
                    ) : displayChartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-gray-500 text-sm">
                          لا توجد بيانات لهذه الفترة
                        </p>
                      </div>
                    ) : (
                      roasHeight > 0 && (
                      <ResponsiveContainer width="100%" height={roasHeight}>
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
                            labelFormatter={(label, payload) => {
                              const data = payload?.[0]?.payload as
                                | { tooltipLabel?: string }
                                | undefined;
                              return data?.tooltipLabel ?? label;
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
                            dot={{ r: 3, fill: "#a855f7", strokeWidth: 0 }}
                            activeDot={{ r: 5 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                      )
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
"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Download,
  Mail,
  FileSpreadsheet,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Target,
  Users,
  Percent,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  useInsights,
  dateRangeValueToOptions,
} from "@/lib/hooks/use-insights";
import { useDateRangeStorage } from "@/lib/hooks/use-date-range-storage";
import {
  computePreviousPeriod,
  computeDelta,
} from "@/lib/period-comparison";
import { useCurrency } from "@/lib/contexts/currency-context";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  formatAndConvert,
  formatCurrency as formatCurrencyWithSymbol,
  convertCurrency,
  CURRENCY_LABELS,
  type Currency,
} from "@/lib/currency";
import {
  formatChartDayLabel,
  formatChartTooltipLabel,
  type DateRangeValue,
  type UnifiedCampaign,
  type UnifiedInsight,
} from "@/lib/ads/types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ReportsClientProps {
  fullName: string;
  companyName: string;
  email: string;
  connectedPlatforms: string[];
}

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

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

function formatCustomRangeLabel(range: DateRangeValue): string | null {
  if (range.type !== "custom") return null;
  const formatDate = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${parseInt(d)} ${ARABIC_MONTHS[parseInt(m) - 1]} ${y}`;
  };
  return `الفترة المختارة: ${formatDate(range.since)} - ${formatDate(
    range.until
  )} (${getDayCount(range)} يوم)`;
}

function getROASColor(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  ACTIVE: { label: "نشطة", classes: "bg-green-100 text-green-700" },
  PAUSED: { label: "موقوفة", classes: "bg-gray-100 text-gray-700" },
  DELETED: { label: "محذوفة", classes: "bg-red-100 text-red-700" },
  ARCHIVED: { label: "مؤرشفة", classes: "bg-blue-100 text-blue-700" },
};

type SortableColumn =
  | "campaignName"
  | "status"
  | "spend"
  | "revenue"
  | "roas"
  | "purchases"
  | "cpc"
  | "ctr";

type StatusFilter = "all" | "ACTIVE" | "PAUSED" | "DELETED";

interface SortableHeaderProps {
  column: SortableColumn;
  label: string;
  sortBy: SortableColumn | null;
  sortDir: "asc" | "desc";
  onSort: (column: SortableColumn) => void;
}

function SortableHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
}: SortableHeaderProps) {
  const isActive = sortBy === column;
  return (
    <th
      className="text-right py-3 px-2 font-medium cursor-pointer select-none hover:text-gray-700 transition whitespace-nowrap"
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === "asc" ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500">
        —
      </span>
    );
  }
  const c = STATUS_CONFIG[status] || {
    label: status,
    classes: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`px-2 py-1 rounded text-xs font-medium ${c.classes}`}
    >
      {c.label}
    </span>
  );
}

export default function ReportsClient({
  fullName,
  email,
  connectedPlatforms,
}: ReportsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [dateRange, setDateRange] = useDateRangeStorage();

  const { currency } = useCurrency();
  const [accountCurrency, setAccountCurrency] = useState<Currency>("USD");
  const [campaigns, setCampaigns] = useState<UnifiedCampaign[]>([]);

  // Filtering, sorting, pagination — applied to the campaigns table only
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortableColumn | null>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState<10 | 20 | 50>(20);

  // Fetch account currency
  useEffect(() => {
    fetch("/api/ads/account?provider=meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const c = data?.currency;
        if (c === "USD" || c === "SAR") setAccountCurrency(c);
      })
      .catch(() => {});
  }, []);

  // Fetch campaigns (for status JOIN)
  useEffect(() => {
    fetch("/api/ads/campaigns?provider=meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.data && Array.isArray(data.data)) {
          setCampaigns(data.data);
        }
      })
      .catch((err) => console.error("[reports/campaigns] Error:", err));
  }, []);

  const statusMap = useMemo(
    () =>
      new Map(
        campaigns.map((c) => [c.id, { status: c.status, name: c.name }])
      ),
    [campaigns]
  );

  // Smart time_increment: daily breakdown for non-lifetime ranges (all presets
  // except 'lifetime' are ≤ 90 days). Custom ranges check explicit length.
  const dayCount = getDayCount(dateRange);
  const shouldShowDailyBreakdown =
    dateRange.type === "custom"
      ? dayCount <= 90
      : dateRange.preset !== "lifetime";

  // Lifetime can't be shown as a meaningful chart (it would be one big aggregate row).
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

  // Insights for table (campaign level — one row per campaign, follows dateRange)
  const {
    insights,
    loading: insightsLoading,
    error,
    noConnection,
  } = useInsights({
    ...dateRangeValueToOptions(dateRange),
    level: "campaign",
  });

  // Insights for chart (account level + daily breakdown when applicable,
  // uses chartDateRange so lifetime falls back to 90d)
  const { insights: chartInsights, loading: chartLoading } = useInsights({
    ...dateRangeValueToOptions(chartDateRange),
    level: "account",
    timeIncrement: chartShouldShowDaily ? 1 : undefined,
  });

  // Apply search → status filter → sort
  const processedInsights = useMemo(() => {
    let result = [...insights];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((insight) => {
        const meta = insight.campaignId
          ? statusMap.get(insight.campaignId)
          : undefined;
        const name = (
          insight.campaignName ??
          meta?.name ??
          ""
        ).toLowerCase();
        return name.includes(q);
      });
    }

    if (statusFilter !== "all") {
      result = result.filter((insight) => {
        const meta = insight.campaignId
          ? statusMap.get(insight.campaignId)
          : undefined;
        return meta?.status === statusFilter;
      });
    }

    if (sortBy) {
      result.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;

        if (sortBy === "status") {
          // Status lives on the campaigns side, not on the insight row.
          const aMeta = a.campaignId
            ? statusMap.get(a.campaignId)
            : undefined;
          const bMeta = b.campaignId
            ? statusMap.get(b.campaignId)
            : undefined;
          aVal = aMeta?.status ?? "";
          bVal = bMeta?.status ?? "";
        } else if (sortBy === "campaignName") {
          // Sort by displayed name (matches what the user sees).
          const aMeta = a.campaignId
            ? statusMap.get(a.campaignId)
            : undefined;
          const bMeta = b.campaignId
            ? statusMap.get(b.campaignId)
            : undefined;
          aVal = a.campaignName ?? aMeta?.name ?? "";
          bVal = b.campaignName ?? bMeta?.name ?? "";
        } else {
          aVal = (a[sortBy] as number) ?? 0;
          bVal = (b[sortBy] as number) ?? 0;
        }

        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDir === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        const numA = typeof aVal === "number" ? aVal : 0;
        const numB = typeof bVal === "number" ? bVal : 0;
        return sortDir === "asc" ? numA - numB : numB - numA;
      });
    }

    return result;
  }, [insights, searchQuery, statusFilter, sortBy, sortDir, statusMap]);

  const totalPages = Math.max(
    1,
    Math.ceil(processedInsights.length / perPage)
  );
  const paginatedInsights = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return processedInsights.slice(start, start + perPage);
  }, [processedInsights, currentPage, perPage]);

  // Reset to page 1 when filters / page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, perPage]);

  const handleSort = (column: SortableColumn) => {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  };

  const hasActiveFilters = searchQuery !== "" || statusFilter !== "all";

  // Previous period for KPI delta comparison (null when lifetime)
  const previousPeriod = useMemo(
    () => computePreviousPeriod(dateRange),
    [dateRange]
  );

  // Fetch previous period insights for KPI deltas. When previousPeriod is null
  // we still need a valid options object (useInsights doesn't support skip
  // natively); previousSummary below guards on previousPeriod and returns null,
  // so the deltas are hidden in lifetime mode.
  const { insights: previousInsights } = useInsights(
    previousPeriod
      ? { customRange: previousPeriod, level: "campaign" }
      : { range: "30d", level: "campaign" }
  );

  const summary = useMemo(() => {
    const totals = insights.reduce(
      (acc, i) => ({
        spend: acc.spend + i.spend,
        revenue: acc.revenue + i.revenue,
        purchases: acc.purchases + i.purchases,
      }),
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      campaignsCount: insights.length,
      spend: totals.spend,
      revenue: totals.revenue,
      profit: totals.revenue - totals.spend,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      purchases: totals.purchases,
      aov:
        totals.purchases > 0 ? totals.revenue / totals.purchases : 0,
    };
  }, [insights]);

  // Previous period totals (for KPI deltas). Null when previousPeriod is null
  // (lifetime) — KPI cards will hide their delta indicators.
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
      profit: totals.revenue - totals.spend,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      purchases: totals.purchases,
      aov:
        totals.purchases > 0 ? totals.revenue / totals.purchases : 0,
    };
  }, [previousInsights, previousPeriod]);

  const displayChartData = useMemo(
    () =>
      chartInsights.map((i) => ({
        date: i.dateStart,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(i.dateStart, chartDayCount)
          : i.dateStart,
        tooltipLabel: formatChartTooltipLabel(i.dateStart),
        displaySpend: convertCurrency(i.spend, accountCurrency, currency),
        displayRevenue: convertCurrency(
          i.revenue,
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

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleExport = (format: "pdf" | "excel" | "email") => {
    alert(
      format === "pdf"
        ? "📄 تصدير PDF قريباً"
        : format === "excel"
          ? "📊 تصدير Excel قريباً"
          : "📧 إرسال بريد قريباً"
    );
  };

  const initial = fullName.charAt(0).toUpperCase();
  const hasConnections = connectedPlatforms.length > 0;
  const customRangeLabel = formatCustomRangeLabel(dateRange);

  const menuItems = [
    { label: "الرئيسية", icon: Home, href: "/dashboard", active: false },
    {
      label: "ربط المنصات",
      icon: Link2,
      href: "/dashboard/connections",
      active: false,
    },
    {
      label: "التقارير",
      icon: FileText,
      href: "/dashboard/reports",
      active: true,
    },
    {
      label: "الإعدادات",
      icon: Settings,
      href: "/dashboard/settings",
      active: false,
    },
    { label: "المساعدة", icon: HelpCircle, href: "#", active: false },
  ];

  // ============================================================
  // Empty state — no connections at all
  // ============================================================
  if (!hasConnections) {
    return (
      <div className="min-h-screen bg-gray-50" dir="rtl">
        <aside className="fixed top-0 right-0 h-full w-64 bg-white border-l border-gray-200 z-50 hidden lg:block">
          <div className="h-16 flex items-center px-6 border-b border-gray-100">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900">
                ArabiaDash
              </span>
            </Link>
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
        </aside>

        <div className="lg:mr-64 p-8">
          <div className="max-w-2xl mx-auto text-center pt-20">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10 text-indigo-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              لا توجد بيانات لعرضها
            </h1>
            <p className="text-gray-600 mb-8 leading-relaxed">
              اربط منصاتك الإعلانية أولاً لتتمكن من رؤية التقارير والتحليلات
              التفصيلية لحملاتك
            </p>
            <Link
              href="/dashboard/connections"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition"
            >
              <Link2 className="w-5 h-5" />
              ربط المنصات الآن
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // KPI cards data
  // ============================================================
  const kpiCards = [
    {
      label: "إجمالي الإنفاق",
      value: formatAndConvert(summary.spend, accountCurrency, currency),
      icon: DollarSign,
      color: "indigo",
      delta: previousSummary
        ? computeDelta(summary.spend, previousSummary.spend)
        : null,
      deltaInverse: false,
    },
    {
      label: "إجمالي الإيرادات",
      value: formatAndConvert(summary.revenue, accountCurrency, currency),
      icon: ShoppingCart,
      color: "green",
      delta: previousSummary
        ? computeDelta(summary.revenue, previousSummary.revenue)
        : null,
      deltaInverse: false,
    },
    {
      label: "صافي الربح",
      value: formatAndConvert(summary.profit, accountCurrency, currency),
      icon: TrendingUp,
      color: "emerald",
      delta: previousSummary
        ? computeDelta(summary.profit, previousSummary.profit)
        : null,
      deltaInverse: false,
    },
    {
      label: "متوسط ROAS",
      value: `${summary.roas.toFixed(2)}x`,
      icon: Target,
      color: "purple",
      delta: previousSummary
        ? computeDelta(summary.roas, previousSummary.roas)
        : null,
      deltaInverse: false,
    },
    {
      label: "عدد المبيعات",
      value: summary.purchases.toLocaleString("en-US"),
      icon: Users,
      color: "blue",
      delta: previousSummary
        ? computeDelta(summary.purchases, previousSummary.purchases)
        : null,
      deltaInverse: false,
    },
    {
      label: "متوسط قيمة الطلب",
      value:
        summary.aov > 0
          ? formatAndConvert(summary.aov, accountCurrency, currency)
          : "—",
      icon: Percent,
      color: "pink",
      delta: previousSummary
        ? computeDelta(summary.aov, previousSummary.aov)
        : null,
      deltaInverse: false,
    },
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

      {/* Main */}
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

        {/* Content */}
        <main className="p-3 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-4 sm:mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2 leading-snug">
                التقارير والتحليلات
              </h1>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                تحليل تفصيلي لأداء حملاتك الإعلانية ومبيعاتك
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleExport("pdf")}
                className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                PDF
              </button>
              <button
                onClick={() => handleExport("excel")}
                className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition flex items-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
              <button
                onClick={() => handleExport("email")}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:shadow-lg transition flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                إرسال
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white border border-gray-100 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-3 flex-wrap">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
              {customRangeLabel && (
                <span className="text-xs text-gray-500">
                  {customRangeLabel}
                </span>
              )}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 sm:mb-6 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">
                تعذّر جلب البيانات. حاول تحديث الصفحة.
              </p>
            </div>
          )}

          {/* No-Meta empty state */}
          {noConnection ? (
            <div className="bg-white border border-gray-100 rounded-xl p-6 sm:p-8 text-center">
              <div className="w-12 h-12 mx-auto bg-indigo-50 rounded-xl flex items-center justify-center mb-3">
                <Link2 className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                اربط حساب Meta لعرض التقارير
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                ستظهر هنا بيانات حملات Meta الإعلانية بالتفصيل
              </p>
              <Link
                href="/dashboard/connections"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:shadow-lg transition"
              >
                <Link2 className="w-5 h-5" />
                ربط Meta
              </Link>
            </div>
          ) : (
            <>
              {/* 6 KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-6">
                {insightsLoading
                  ? [0, 1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="bg-white border border-gray-100 rounded-xl p-3 sm:p-4 animate-pulse"
                      >
                        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gray-200 mb-2 sm:mb-3"></div>
                        <div className="h-3 bg-gray-200 rounded mb-2 w-3/4"></div>
                        <div className="h-5 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    ))
                  : kpiCards.map((stat, i) => {
                      const colorClasses: Record<string, string> = {
                        indigo: "bg-indigo-50 text-indigo-600",
                        green: "bg-green-50 text-green-600",
                        emerald: "bg-emerald-50 text-emerald-600",
                        purple: "bg-purple-50 text-purple-600",
                        blue: "bg-blue-50 text-blue-600",
                        pink: "bg-pink-50 text-pink-600",
                      };

                      const showDelta = stat.delta && stat.delta.isFinite;
                      const deltaValue = stat.delta?.value ?? 0;
                      const isNegligible =
                        showDelta && Math.abs(deltaValue) < 0.1;
                      const deltaIsPositive = stat.deltaInverse
                        ? deltaValue < 0
                        : deltaValue > 0;
                      const deltaColor = !showDelta
                        ? "text-gray-400"
                        : isNegligible
                          ? "text-gray-500"
                          : deltaIsPositive
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
                          className="bg-white border border-gray-100 rounded-xl p-3 sm:p-4 hover:shadow-md transition"
                        >
                          <div className="flex items-center justify-between mb-2 sm:mb-3">
                            <div
                              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center ${
                                colorClasses[stat.color]
                              }`}
                            >
                              <stat.icon className="w-4 h-4" />
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 mb-1 truncate">
                            {stat.label}
                          </p>
                          <div
                            className="flex items-baseline gap-1 flex-wrap mb-1"
                            dir="ltr"
                          >
                            <span className="text-base sm:text-lg font-bold text-gray-900">
                              {stat.value}
                            </span>
                          </div>

                          {showDelta ? (
                            <div
                              className={`flex items-center gap-0.5 text-[10px] sm:text-xs ${deltaColor}`}
                              dir="ltr"
                            >
                              {DeltaIcon && (
                                <DeltaIcon className="w-3 h-3" />
                              )}
                              <span className="font-semibold">
                                {Math.abs(deltaValue).toFixed(1)}%
                              </span>
                              <span className="text-gray-400 mr-1">
                                vs السابقة
                              </span>
                            </div>
                          ) : previousPeriod ? (
                            <div className="text-[10px] sm:text-xs text-gray-400">
                              — vs السابقة
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
              </div>

              {/* Main Chart - Spend vs Revenue */}
              <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="flex items-center justify-between mb-3 sm:mb-6">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                      الإنفاق مقابل الإيرادات
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500">
                      {`توزيع يومي بـ ${CURRENCY_LABELS[currency].nameAr}`}
                    </p>
                  </div>
                </div>
                <div dir="ltr" className="h-56 sm:h-80">
                  {!chartShouldShowDaily ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <p className="text-sm text-gray-500">
                        التوزيع اليومي متاح للفترات حتى 90 يوم. استخدم النظرة
                        الشاملة من البطاقات أعلاه.
                      </p>
                    </div>
                  ) : chartLoading ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="animate-pulse text-gray-400 text-sm">
                        جاري تحميل البيانات...
                      </div>
                    </div>
                  ) : displayChartData.length < 2 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-gray-500 text-sm">
                        لا توجد بيانات كافية للرسم البياني
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={displayChartData}>
                        <defs>
                          <linearGradient
                            id="colorRev"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#10b981"
                              stopOpacity={0.4}
                            />
                            <stop
                              offset="95%"
                              stopColor="#10b981"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="colorSpd"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#6366f1"
                              stopOpacity={0.4}
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
                          fontSize={11}
                        />
                        <YAxis stroke="#9ca3af" fontSize={11} />
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
                          fill="url(#colorRev)"
                        />
                        <Area
                          type="monotone"
                          dataKey="displaySpend"
                          name="الإنفاق"
                          stroke="#6366f1"
                          fillOpacity={1}
                          fill="url(#colorSpd)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
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


              {/* Campaigns Table */}
              <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1">
                      الحملات الإعلانية
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-500">
                      {summary.campaignsCount} حملة في الفترة المختارة
                    </p>
                  </div>
                </div>

                {insightsLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-12 bg-gray-100 rounded animate-pulse"
                      />
                    ))}
                  </div>
                ) : insights.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-gray-500 text-sm">
                      لا توجد بيانات لهذه الفترة
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Filters Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 mb-4 pb-4 border-b border-gray-100">
                      <div className="flex-1 relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="بحث باسم الحملة..."
                          className="w-full pr-9 pl-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <select
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(e.target.value as StatusFilter)
                        }
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="all">الكل</option>
                        <option value="ACTIVE">نشطة</option>
                        <option value="PAUSED">موقوفة</option>
                        <option value="DELETED">محذوفة</option>
                      </select>

                      {hasActiveFilters && (
                        <button
                          onClick={() => {
                            setSearchQuery("");
                            setStatusFilter("all");
                          }}
                          className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
                        >
                          مسح الفلاتر
                        </button>
                      )}
                    </div>

                    {/* Results count */}
                    <p className="text-xs text-gray-500 mb-3">
                      {processedInsights.length === insights.length
                        ? `${insights.length} حملة`
                        : `${processedInsights.length} من ${insights.length} حملة`}
                    </p>

                    {processedInsights.length === 0 ? (
                      <div className="py-12 text-center">
                        <p className="text-gray-500 text-sm">
                          لا توجد نتائج مطابقة للفلاتر المختارة
                        </p>
                      </div>
                    ) : (
                      <>
                    {/* Mobile: Cards */}
                    <div className="lg:hidden space-y-3">
                      {paginatedInsights.map((insight) => {
                        const meta = insight.campaignId
                          ? statusMap.get(insight.campaignId)
                          : undefined;
                        const name =
                          insight.campaignName ?? meta?.name ?? "—";
                        return (
                          <div
                            key={insight.campaignId ?? name}
                            className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition"
                          >
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <h4 className="font-semibold text-gray-900 text-sm leading-snug flex-1">
                                {name}
                              </h4>
                              <StatusBadge status={meta?.status} />
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  الإنفاق
                                </p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {formatAndConvert(
                                    insight.spend,
                                    accountCurrency,
                                    currency
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  الإيرادات
                                </p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {formatAndConvert(
                                    insight.revenue,
                                    accountCurrency,
                                    currency
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  ROAS
                                </p>
                                <p
                                  className={`text-sm font-semibold ${getROASColor(
                                    insight.roas
                                  )}`}
                                >
                                  {insight.roas.toFixed(2)}x
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  المبيعات
                                </p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {insight.purchases.toLocaleString("en-US")}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  CPC
                                </p>
                                <p className="text-sm text-gray-700">
                                  {formatAndConvert(
                                    insight.cpc,
                                    accountCurrency,
                                    currency
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  CTR
                                </p>
                                <p className="text-sm text-gray-700">
                                  {insight.ctr.toFixed(2)}%
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop: Table */}
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 border-b border-gray-100">
                          <tr>
                            <SortableHeader
                              column="campaignName"
                              label="الحملة"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="status"
                              label="الحالة"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="spend"
                              label="الإنفاق"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="revenue"
                              label="الإيرادات"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="roas"
                              label="ROAS"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="purchases"
                              label="المبيعات"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="cpc"
                              label="CPC"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              column="ctr"
                              label="CTR"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedInsights.map((insight) => {
                            const meta = insight.campaignId
                              ? statusMap.get(insight.campaignId)
                              : undefined;
                            const name =
                              insight.campaignName ?? meta?.name ?? "—";
                            return (
                              <tr
                                key={insight.campaignId ?? name}
                                className="border-b border-gray-50 hover:bg-gray-50 transition"
                              >
                                <td className="py-3 px-2 font-medium text-gray-900">
                                  {name}
                                </td>
                                <td className="py-3 px-2">
                                  <StatusBadge status={meta?.status} />
                                </td>
                                <td className="py-3 px-2 text-gray-700">
                                  {formatAndConvert(
                                    insight.spend,
                                    accountCurrency,
                                    currency
                                  )}
                                </td>
                                <td className="py-3 px-2 text-gray-900 font-medium">
                                  {formatAndConvert(
                                    insight.revenue,
                                    accountCurrency,
                                    currency
                                  )}
                                </td>
                                <td
                                  className={`py-3 px-2 font-semibold ${getROASColor(
                                    insight.roas
                                  )}`}
                                >
                                  {insight.roas.toFixed(2)}x
                                </td>
                                <td className="py-3 px-2 text-gray-700">
                                  {insight.purchases.toLocaleString("en-US")}
                                </td>
                                <td className="py-3 px-2 text-gray-700">
                                  {formatAndConvert(
                                    insight.cpc,
                                    accountCurrency,
                                    currency
                                  )}
                                </td>
                                <td className="py-3 px-2 text-gray-700">
                                  {insight.ctr.toFixed(2)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                      </>
                    )}

                    {/* Pagination Controls */}
                    {processedInsights.length > 0 && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-3 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <span>عرض</span>
                            <select
                              value={perPage}
                              onChange={(e) =>
                                setPerPage(
                                  Number(e.target.value) as 10 | 20 | 50
                                )
                              }
                              className="border border-gray-200 rounded px-2 py-1 text-sm bg-white"
                            >
                              <option value={10}>10</option>
                              <option value={20}>20</option>
                              <option value={50}>50</option>
                            </select>
                          </div>
                          <span className="text-gray-400">|</span>
                          <span>
                            {`${(currentPage - 1) * perPage + 1}-${Math.min(
                              currentPage * perPage,
                              processedInsights.length
                            )} من ${processedInsights.length}`}
                          </span>
                        </div>

                        {totalPages > 1 && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() =>
                                setCurrentPage(currentPage - 1)
                              }
                              disabled={currentPage === 1}
                              className="px-3 py-1.5 border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              السابق
                            </button>

                            {Array.from(
                              { length: totalPages },
                              (_, i) => i + 1
                            )
                              .filter(
                                (p) =>
                                  p === 1 ||
                                  p === totalPages ||
                                  Math.abs(p - currentPage) <= 1
                              )
                              .map((p, idx, arr) => {
                                const prev = arr[idx - 1];
                                const showEllipsis =
                                  prev !== undefined && p - prev > 1;
                                return (
                                  <span
                                    key={p}
                                    className="flex items-center gap-1"
                                  >
                                    {showEllipsis && (
                                      <span className="text-gray-400">
                                        ...
                                      </span>
                                    )}
                                    <button
                                      onClick={() => setCurrentPage(p)}
                                      className={`min-w-[32px] px-2 py-1.5 border rounded text-sm transition ${
                                        p === currentPage
                                          ? "bg-indigo-600 text-white border-indigo-600"
                                          : "border-gray-200 hover:bg-gray-50"
                                      }`}
                                    >
                                      {p}
                                    </button>
                                  </span>
                                );
                              })}

                            <button
                              onClick={() =>
                                setCurrentPage(currentPage + 1)
                              }
                              disabled={currentPage === totalPages}
                              className="px-3 py-1.5 border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              التالي
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

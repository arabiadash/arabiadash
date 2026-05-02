"use client";

import { useState, useEffect, useMemo } from "react";
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
  Calendar,
  Globe,
  Download,
  Mail,
  FileSpreadsheet,
  ArrowUp,
  ArrowDown,
  Filter,
  Target,
  Percent,
  ShoppingBag,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatPercent } from "@/lib/mock-data";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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
}

// Date range options
const dateRanges = [
  { id: "7d", label: "آخر 7 أيام", days: 7 },
  { id: "30d", label: "آخر 30 يوم", days: 30 },
  { id: "90d", label: "آخر 3 شهور", days: 90 },
  { id: "all", label: "كل الفترة", days: 365 },
];

// Platforms filter options
const platformsFilter = [
  { id: "all", label: "كل المنصات", color: "#6366f1" },
  { id: "meta", label: "Meta Ads", color: "#1877f2" },
  { id: "google", label: "Google Ads", color: "#ea4335" },
  { id: "tiktok", label: "TikTok Ads", color: "#000000" },
  { id: "snapchat", label: "Snapchat Ads", color: "#fffc00" },
];

// Generate mock data based on filters
const generateChartData = (days: number, platform: string) => {
  const data = [];
  const dayNames = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
  const baseSpend = platform === "all" ? 6500 : platform === "meta" ? 2500 : 1500;
  const baseRevenue = platform === "all" ? 19500 : platform === "meta" ? 7800 : 4500;

  const pointsToShow = Math.min(days, 30);
  for (let i = 0; i < pointsToShow; i++) {
    const variance = 0.7 + Math.random() * 0.6;
    data.push({
      day: days <= 7 ? dayNames[i % 7] : `يوم ${i + 1}`,
      spend: Math.round(baseSpend * variance),
      revenue: Math.round(baseRevenue * variance),
      profit: Math.round(baseRevenue * variance - baseSpend * variance),
      roas: Number((baseRevenue / baseSpend * variance / variance).toFixed(2)),
    });
  }
  return data;
};

// Top days data
const topDaysData = [
  { day: "الجمعة", revenue: 31200 },
  { day: "السبت", revenue: 28400 },
  { day: "الخميس", revenue: 26800 },
  { day: "الأحد", revenue: 24500 },
  { day: "الإثنين", revenue: 22300 },
  { day: "الأربعاء", revenue: 21800 },
  { day: "الثلاثاء", revenue: 19500 },
];

// Platform share data
const platformShareData = [
  { name: "Meta", value: 58000, color: "#6366f1" },
  { name: "Google", value: 42500, color: "#a855f7" },
  { name: "TikTok", value: 24800, color: "#ec4899" },
  { name: "Snapchat", value: 17200, color: "#facc15" },
];

// Best hours data
const bestHoursData = [
  { hour: "9 ص", revenue: 4200 },
  { hour: "12 م", revenue: 7800 },
  { hour: "3 م", revenue: 8900 },
  { hour: "6 م", revenue: 12400 },
  { hour: "9 م", revenue: 14800 },
  { hour: "12 ص", revenue: 6200 },
];

// All campaigns data
const allCampaigns = [
  { id: 1, name: "حملة العيد - منتجات الأطفال", platform: "Meta", spend: 4200, revenue: 15800, roas: 3.76, conversions: 142, status: "active" },
  { id: 2, name: "Google Search - الأحذية الرياضية", platform: "Google", spend: 3800, revenue: 12400, roas: 3.26, conversions: 98, status: "active" },
  { id: 3, name: "TikTok - مجموعة الصيف", platform: "TikTok", spend: 2900, revenue: 8700, roas: 3.0, conversions: 76, status: "active" },
  { id: 4, name: "Snap - عروض رمضان", platform: "Snapchat", spend: 2150, revenue: 6450, roas: 3.0, conversions: 54, status: "paused" },
  { id: 5, name: "Meta - إعادة الاستهداف", platform: "Meta", spend: 1850, revenue: 5550, roas: 3.0, conversions: 47, status: "active" },
  { id: 6, name: "Google Display - منتجات جديدة", platform: "Google", spend: 1650, revenue: 4200, roas: 2.55, conversions: 38, status: "active" },
  { id: 7, name: "Meta - عرض المخزون", platform: "Meta", spend: 1450, revenue: 3800, roas: 2.62, conversions: 32, status: "paused" },
  { id: 8, name: "TikTok - مؤثرين", platform: "TikTok", spend: 1200, revenue: 2900, roas: 2.42, conversions: 24, status: "active" },
];

export default function ReportsClient({
  fullName,
  companyName,
  email,
}: ReportsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);

  // Filters
  const [selectedRange, setSelectedRange] = useState("30d");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");

  // Load connected platforms from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("arabiadash_connections");
    if (saved) {
      try {
        setConnectedPlatforms(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading connections:", e);
      }
    }
  }, []);

  const hasConnections = connectedPlatforms.length > 0;

  // Computed data based on filters
  const currentRange = dateRanges.find((r) => r.id === selectedRange) || dateRanges[1];
  const chartData = useMemo(
    () => generateChartData(currentRange.days, selectedPlatform),
    [currentRange.days, selectedPlatform]
  );

  // Compute KPIs from chart data
  const kpis = useMemo(() => {
    const totalSpend = chartData.reduce((sum, d) => sum + d.spend, 0);
    const totalRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0);
    const profit = totalRevenue - totalSpend;
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const conversions = Math.round(chartData.length * 18);
    const aov = conversions > 0 ? totalRevenue / conversions : 0;

    return {
      spend: totalSpend,
      revenue: totalRevenue,
      profit,
      roas: avgRoas,
      conversions,
      aov,
    };
  }, [chartData]);

  // Filter campaigns
  const filteredCampaigns = useMemo(() => {
    return allCampaigns.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(campaignSearch.toLowerCase());
      const matchesStatus = campaignStatusFilter === "all" || c.status === campaignStatusFilter;
      const matchesPlatform =
        selectedPlatform === "all" ||
        c.platform.toLowerCase() === selectedPlatform.toLowerCase();
      return matchesSearch && matchesStatus && matchesPlatform;
    });
  }, [campaignSearch, campaignStatusFilter, selectedPlatform]);

  // Handle sign out
  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  // Handle export
  const handleExport = (format: "pdf" | "excel" | "email") => {
    alert(
      format === "pdf"
        ? "📄 جاري تجهيز ملف PDF... (ميزة تجريبية)"
        : format === "excel"
        ? "📊 جاري تجهيز ملف Excel... (ميزة تجريبية)"
        : "📧 جاري إرسال التقرير على إيميلك... (ميزة تجريبية)"
    );
  };

  const initial = fullName.charAt(0).toUpperCase();

  // KPI Cards data
  const kpiCards = [
    {
      label: "إجمالي الإنفاق",
      value: formatCurrency(Math.round(kpis.spend)),
      currency: "ريال",
      icon: DollarSign,
      color: "indigo",
      change: "+12.5%",
      changeType: "up" as const,
    },
    {
      label: "إجمالي الإيرادات",
      value: formatCurrency(Math.round(kpis.revenue)),
      currency: "ريال",
      icon: ShoppingCart,
      color: "green",
      change: "+18.3%",
      changeType: "up" as const,
    },
    {
      label: "صافي الربح",
      value: formatCurrency(Math.round(kpis.profit)),
      currency: "ريال",
      icon: TrendingUp,
      color: "emerald",
      change: "+22.1%",
      changeType: "up" as const,
    },
    {
      label: "متوسط ROAS",
      value: kpis.roas.toFixed(2),
      currency: "x",
      icon: Target,
      color: "purple",
      change: "+5.2%",
      changeType: "up" as const,
    },
    {
      label: "عدد التحويلات",
      value: formatCurrency(kpis.conversions),
      currency: "",
      icon: Users,
      color: "blue",
      change: "+15.7%",
      changeType: "up" as const,
    },
    {
      label: "متوسط قيمة الطلب",
      value: formatCurrency(Math.round(kpis.aov)),
      currency: "ريال",
      icon: Percent,
      color: "pink",
      change: "+3.8%",
      changeType: "up" as const,
    },
  ];

  // Sidebar menu
  const menuItems = [
    { label: "الرئيسية", icon: Home, href: "/dashboard", active: false },
    { label: "ربط المنصات", icon: Link2, href: "/dashboard/connections", active: false },
    { label: "التقارير", icon: FileText, href: "/dashboard/reports", active: true },
    { label: "الإعدادات", icon: Settings, href: "#", active: false },
    { label: "المساعدة", icon: HelpCircle, href: "#", active: false },
  ];

  // Empty state if no connections
  if (!hasConnections) {
    return (
      <div className="min-h-screen bg-gray-50" dir="rtl">
        {/* Sidebar (collapsed empty state version) */}
        <aside className="fixed top-0 right-0 h-full w-64 bg-white border-l border-gray-200 z-50 hidden lg:block">
          <div className="h-16 flex items-center px-6 border-b border-gray-100">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900">ArabiaDash</span>
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
              <button onClick={() => setSidebarOpen(true)} className="lg:hidden">
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
        <main className="p-4 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                التقارير والتحليلات
              </h1>
              <p className="text-gray-600">
                تحليل تفصيلي لأداء حملاتك الإعلانية ومبيعاتك
              </p>
            </div>
            <div className="flex items-center gap-2">
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

          {/* Filters */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Date Range Filter */}
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  الفترة الزمنية
                </label>
                <div className="flex flex-wrap gap-2">
                  {dateRanges.map((range) => (
                    <button
                      key={range.id}
                      onClick={() => setSelectedRange(range.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        selectedRange === range.id
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Platform Filter */}
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" />
                  المنصة
                </label>
                <div className="flex flex-wrap gap-2">
                  {platformsFilter.map((platform) => (
                    <button
                      key={platform.id}
                      onClick={() => setSelectedPlatform(platform.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        selectedPlatform === platform.id
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {platform.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* KPI Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            {kpiCards.map((stat, i) => {
              const colorClasses: Record<string, string> = {
                indigo: "bg-indigo-50 text-indigo-600",
                green: "bg-green-50 text-green-600",
                emerald: "bg-emerald-50 text-emerald-600",
                purple: "bg-purple-50 text-purple-600",
                blue: "bg-blue-50 text-blue-600",
                pink: "bg-pink-50 text-pink-600",
              };

              return (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClasses[stat.color]}`}
                    >
                      <stat.icon className="w-4 h-4" />
                    </div>
                    <span
                      className={`text-xs font-semibold flex items-center gap-1 ${
                        stat.changeType === "up" ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {stat.changeType === "up" ? (
                        <ArrowUp className="w-3 h-3" />
                      ) : (
                        <ArrowDown className="w-3 h-3" />
                      )}
                      {stat.change}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mb-1">{stat.label}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-gray-900">
                      {stat.value}
                    </span>
                    {stat.currency && (
                      <span className="text-xs text-gray-500">{stat.currency}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Main Chart - Spend vs Revenue */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                  الإنفاق مقابل الإيرادات
                </h3>
                <p className="text-sm text-gray-500">
                  تطور الأرقام خلال الفترة المحددة
                </p>
              </div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSpd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="الإيرادات"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorRev)"
                  />
                  <Area
                    type="monotone"
                    dataKey="spend"
                    name="الإنفاق"
                    stroke="#6366f1"
                    fillOpacity={1}
                    fill="url(#colorSpd)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Two Column Charts */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Top Days */}
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                أفضل الأيام أداءً
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                ترتيب الأيام حسب الإيرادات
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDaysData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                    <YAxis type="category" dataKey="day" stroke="#9ca3af" fontSize={11} width={60} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="revenue" name="الإيرادات" fill="#a855f7" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Platform Share */}
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                توزيع الإيرادات على المنصات
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                النسبة المئوية لكل منصة
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={platformShareData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {platformShareData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Best Hours Chart */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              أفضل أوقات الإعلان
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              توزيع الإيرادات على ساعات اليوم
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bestHoursData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="hour" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="revenue" name="الإيرادات" fill="#ec4899" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Campaigns Table */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                  جميع الحملات الإعلانية
                </h3>
                <p className="text-sm text-gray-500">
                  {filteredCampaigns.length} حملة
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    placeholder="بحث في الحملات..."
                    className="bg-gray-50 border border-gray-200 rounded-lg pr-9 pl-3 py-2 text-sm w-full sm:w-56"
                  />
                </div>
                <select
                  value={campaignStatusFilter}
                  onChange={(e) => setCampaignStatusFilter(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="all">كل الحالات</option>
                  <option value="active">نشطة</option>
                  <option value="paused">متوقفة</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="text-right py-3 px-2 font-medium">الحملة</th>
                    <th className="text-right py-3 px-2 font-medium">المنصة</th>
                    <th className="text-right py-3 px-2 font-medium">الإنفاق</th>
                    <th className="text-right py-3 px-2 font-medium">الإيرادات</th>
                    <th className="text-right py-3 px-2 font-medium">ROAS</th>
                    <th className="text-right py-3 px-2 font-medium">التحويلات</th>
                    <th className="text-right py-3 px-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">
                        لا توجد حملات تطابق البحث
                      </td>
                    </tr>
                  ) : (
                    filteredCampaigns.map((campaign) => (
                      <tr
                        key={campaign.id}
                        className="border-b border-gray-50 hover:bg-gray-50 transition"
                      >
                        <td className="py-3 px-2 font-medium text-gray-900">
                          {campaign.name}
                        </td>
                        <td className="py-3 px-2 text-gray-600">
                          {campaign.platform}
                        </td>
                        <td className="py-3 px-2 text-gray-600">
                          {formatCurrency(campaign.spend)} ر.س
                        </td>
                        <td className="py-3 px-2 text-gray-900 font-medium">
                          {formatCurrency(campaign.revenue)} ر.س
                        </td>
                        <td className="py-3 px-2">
                          <span className="text-green-600 font-semibold">
                            {campaign.roas.toFixed(2)}x
                          </span>
                        </td>
                        <td className="py-3 px-2 text-gray-600">
                          {campaign.conversions}
                        </td>
                        <td className="py-3 px-2">
                          {campaign.status === "active" ? (
                            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-1 rounded">
                              نشطة
                            </span>
                          ) : (
                            <span className="bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-1 rounded">
                              متوقفة
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Demo Mode Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <Filter className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>وضع تجريبي:</strong> البيانات والفلاتر تجريبية لعرض كيفية
              عمل التقارير. التكامل الفعلي مع منصات الإعلانات قريباً.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
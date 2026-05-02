"use client";

import { useState, useEffect } from "react";
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
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  mockStats,
  mockChartData,
  mockPlatformPerformance,
  mockTopCampaigns,
  formatCurrency,
  formatPercent,
} from "@/lib/mock-data";
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
}

export default function DashboardClient({
  fullName,
  companyName,
  email,
}: DashboardClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);

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

  // Check if user has any connections
  const hasConnections = connectedPlatforms.length > 0;

  // Handle sign out
  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const initial = fullName.charAt(0).toUpperCase();

  // Stats with real or empty values based on connections
  const stats = hasConnections
    ? [
        {
          label: "إجمالي الإنفاق الإعلاني",
          value: formatCurrency(mockStats.totalSpend),
          currency: "ريال",
          change: formatPercent(mockStats.spendChange),
          changeType: mockStats.spendChange >= 0 ? "up" : "down",
          icon: DollarSign,
          color: "indigo",
        },
        {
          label: "إجمالي المبيعات",
          value: formatCurrency(mockStats.totalRevenue),
          currency: "ريال",
          change: formatPercent(mockStats.revenueChange),
          changeType: mockStats.revenueChange >= 0 ? "up" : "down",
          icon: ShoppingCart,
          color: "green",
        },
        {
          label: "العائد على الإعلان (ROAS)",
          value: mockStats.roas.toFixed(2),
          currency: "x",
          change: formatPercent(mockStats.roasChange),
          changeType: mockStats.roasChange >= 0 ? "up" : "down",
          icon: TrendingUp,
          color: "purple",
        },
        {
          label: "عدد العملاء",
          value: formatCurrency(mockStats.customers),
          currency: "",
          change: formatPercent(mockStats.customersChange),
          changeType: mockStats.customersChange >= 0 ? "up" : "down",
          icon: Users,
          color: "blue",
        },
      ]
    : [
        {
          label: "إجمالي الإنفاق الإعلاني",
          value: "0",
          currency: "ريال",
          change: "+0%",
          changeType: "neutral",
          icon: DollarSign,
          color: "indigo",
        },
        {
          label: "إجمالي المبيعات",
          value: "0",
          currency: "ريال",
          change: "+0%",
          changeType: "neutral",
          icon: ShoppingCart,
          color: "green",
        },
        {
          label: "العائد على الإعلان (ROAS)",
          value: "0.0",
          currency: "x",
          change: "+0%",
          changeType: "neutral",
          icon: TrendingUp,
          color: "purple",
        },
        {
          label: "عدد العملاء",
          value: "0",
          currency: "",
          change: "+0%",
          changeType: "neutral",
          icon: Users,
          color: "blue",
        },
      ];

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
          {/* Welcome Section */}
          <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                مرحباً، {fullName} 👋
              </h1>
              <p className="text-gray-600">
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
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-8 mb-8">
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

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((stat, i) => {
              const colorClasses: Record<string, string> = {
                indigo: "bg-indigo-50 text-indigo-600",
                green: "bg-green-50 text-green-600",
                purple: "bg-purple-50 text-purple-600",
                blue: "bg-blue-50 text-blue-600",
              };

              return (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-xl p-6 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        colorClasses[stat.color]
                      }`}
                    >
                      <stat.icon className="w-5 h-5" />
                    </div>
                    <span
                      className={`text-xs font-semibold flex items-center gap-1 ${
                        stat.changeType === "up"
                          ? "text-green-600"
                          : stat.changeType === "down"
                          ? "text-red-600"
                          : "text-gray-500"
                      }`}
                    >
                      {stat.changeType === "up" && <ArrowUp className="w-3 h-3" />}
                      {stat.changeType === "down" && (
                        <ArrowDown className="w-3 h-3" />
                      )}
                      {stat.change}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-gray-900">
                      {stat.value}
                    </span>
                    {stat.currency && (
                      <span className="text-sm text-gray-500">{stat.currency}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Charts Section - Only show if has connections */}
          {hasConnections && (
            <>
              {/* Performance Chart */}
              <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                      أداء آخر 7 أيام
                    </h3>
                    <p className="text-sm text-gray-500">
                      الإنفاق مقابل الإيرادات (بالريال السعودي)
                    </p>
                  </div>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mockChartData}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
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
                        fill="url(#colorRevenue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="spend"
                        name="الإنفاق"
                        stroke="#6366f1"
                        fillOpacity={1}
                        fill="url(#colorSpend)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Two Column Charts */}
              <div className="grid lg:grid-cols-2 gap-6 mb-6">
                {/* Platform Performance */}
                <div className="bg-white border border-gray-100 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    الأداء حسب المنصة
                  </h3>
                  <p className="text-sm text-gray-500 mb-6">
                    توزيع الإيرادات على المنصات
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mockPlatformPerformance}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                        <YAxis stroke="#9ca3af" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar dataKey="revenue" name="الإيرادات" fill="#6366f1" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ROAS Trend */}
                <div className="bg-white border border-gray-100 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    اتجاه ROAS
                  </h3>
                  <p className="text-sm text-gray-500 mb-6">
                    العائد على الإنفاق الإعلاني
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mockChartData}>
                        <defs>
                          <linearGradient id="colorRoas" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                        <YAxis stroke="#9ca3af" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
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
                  </div>
                </div>
              </div>

              {/* Top Campaigns */}
              <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                      أفضل الحملات الإعلانية
                    </h3>
                    <p className="text-sm text-gray-500">
                      الحملات الأعلى أداءً هذا الأسبوع
                    </p>
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
                        <th className="text-right py-3 px-2 font-medium">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mockTopCampaigns.map((campaign) => (
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Demo Mode Banner */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  <strong>وضع تجريبي:</strong> البيانات المعروضة افتراضية. التكامل
                  الفعلي مع منصات الإعلانات قريباً.
                </p>
              </div>
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
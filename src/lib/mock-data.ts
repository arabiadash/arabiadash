// Mock data for ArabiaDash demo
// This simulates real ad platform data until we connect actual APIs

export interface PlatformConnection {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  category: "ads" | "ecommerce";
  color: string;
  iconBg: string;
  popular?: boolean;
}

export const platforms: PlatformConnection[] = [
  {
    id: "meta",
    name: "Meta Ads",
    nameAr: "ميتا",
    description: "Facebook & Instagram",
    category: "ads",
    color: "from-blue-500 to-blue-600",
    iconBg: "bg-blue-50",
    popular: true,
  },
  {
    id: "google",
    name: "Google Ads",
    nameAr: "جوجل",
    description: "Search & Display Ads",
    category: "ads",
    color: "from-red-500 to-yellow-500",
    iconBg: "bg-red-50",
    popular: true,
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    nameAr: "تيك توك",
    description: "TikTok for Business",
    category: "ads",
    color: "from-gray-800 to-black",
    iconBg: "bg-gray-50",
  },
  {
    id: "snapchat",
    name: "Snapchat Ads",
    nameAr: "سناب شات",
    description: "Snap Marketing",
    category: "ads",
    color: "from-yellow-400 to-yellow-500",
    iconBg: "bg-yellow-50",
    popular: true,
  },
  {
    id: "salla",
    name: "Salla",
    nameAr: "سلة",
    description: "متجرك الإلكتروني",
    category: "ecommerce",
    color: "from-pink-500 to-rose-500",
    iconBg: "bg-pink-50",
    popular: true,
  },
  {
    id: "zid",
    name: "Zid",
    nameAr: "زد",
    description: "متجرك الإلكتروني",
    category: "ecommerce",
    color: "from-purple-500 to-indigo-500",
    iconBg: "bg-purple-50",
  },
];

// Mock dashboard stats
export const mockStats = {
  totalSpend: 47850,
  totalRevenue: 142500,
  roas: 2.98,
  customers: 1247,
  spendChange: 12.5,
  revenueChange: 18.3,
  roasChange: 5.2,
  customersChange: 23.1,
};

// Mock chart data - last 7 days performance
export const mockChartData = [
  { day: "السبت", spend: 5200, revenue: 14800, roas: 2.85 },
  { day: "الأحد", spend: 6100, revenue: 18200, roas: 2.98 },
  { day: "الإثنين", spend: 7300, revenue: 22100, roas: 3.03 },
  { day: "الثلاثاء", spend: 6800, revenue: 19500, roas: 2.87 },
  { day: "الأربعاء", spend: 7100, revenue: 21300, roas: 3.0 },
  { day: "الخميس", spend: 7800, revenue: 24800, roas: 3.18 },
  { day: "الجمعة", spend: 7550, revenue: 21800, roas: 2.89 },
];

// Mock platform performance
export const mockPlatformPerformance = [
  { name: "Meta", spend: 18500, revenue: 58000, roas: 3.13 },
  { name: "Google", spend: 14200, revenue: 42500, roas: 2.99 },
  { name: "TikTok", spend: 8900, revenue: 24800, roas: 2.78 },
  { name: "Snapchat", spend: 6250, revenue: 17200, roas: 2.75 },
];

// Mock top campaigns
export const mockTopCampaigns = [
  {
    id: 1,
    name: "حملة العيد - منتجات الأطفال",
    platform: "Meta",
    spend: 4200,
    revenue: 15800,
    roas: 3.76,
    status: "active",
  },
  {
    id: 2,
    name: "Google Search - الأحذية الرياضية",
    platform: "Google",
    spend: 3800,
    revenue: 12400,
    roas: 3.26,
    status: "active",
  },
  {
    id: 3,
    name: "TikTok - مجموعة الصيف",
    platform: "TikTok",
    spend: 2900,
    revenue: 8700,
    roas: 3.0,
    status: "active",
  },
  {
    id: 4,
    name: "Snap - عروض رمضان",
    platform: "Snapchat",
    spend: 2150,
    revenue: 6450,
    roas: 3.0,
    status: "paused",
  },
  {
    id: 5,
    name: "Meta - إعادة الاستهداف",
    platform: "Meta",
    spend: 1850,
    revenue: 5550,
    roas: 3.0,
    status: "active",
  },
];

// Helper function to format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US").format(amount);
}

// Helper function to format percentage
export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// Ad platform IDs (excludes ecommerce platforms like salla/zid)
export const AD_PLATFORM_IDS = ["meta", "google", "tiktok", "snapchat"] as const;

// Maps mock-data display names ("Meta", "Google"...) to platform IDs ("meta", "google"...)
export function platformNameToId(displayName: string): string {
  return displayName.toLowerCase();
}

// Returns the subset of connectedPlatforms that are ad platforms
export function getConnectedAdPlatforms(connectedPlatforms: string[]): string[] {
  return connectedPlatforms.filter((p) =>
    (AD_PLATFORM_IDS as readonly string[]).includes(p)
  );
}
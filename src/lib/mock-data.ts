// Platform catalog — display metadata for the connections UI.
//
// Originally part of a broader mock-data fixture (KPIs, chart data,
// campaign rows) that powered the pre-API demo. Everything else was
// removed when live providers landed in Phase 4.x; the catalog stays
// because the Connections page still uses it to render platform
// cards (Meta, Google, TikTok, …) before any account is connected.

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

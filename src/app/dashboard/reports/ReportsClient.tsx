"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Bell,
  Search,
  Menu,
  X,
  Link2,
  FileText,
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
  Eye,
  MousePointerClick,
  Coins,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  RefreshCw,
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard-sidebar";
import KpiCard, { type KpiCardProps } from "@/components/reports/KpiCard";
// Per-variant PMax card components (Commits 10-11, ADR-013). Dispatched
// via renderAdCard below; M5/M6 variants continue using the inline
// CreativeCard so existing render behavior stays byte-for-byte identical.
import { PMaxAssetGroupCard } from "@/components/creatives/PMaxAssetGroupCard";
import { TikTokCreativeCard } from "@/components/creatives/TikTokCreativeCard";
import { TikTokAdDetailModal } from "@/components/creatives/TikTokAdDetailModal";
import type { Workspace, WorkspaceConnection } from "@/lib/workspaces";
import {
  useInsights,
  dateRangeValueToOptions,
} from "@/lib/hooks/use-insights";
import { useProviderInsights } from "@/lib/hooks/use-provider-insights";
import { useProviderAds } from "@/lib/hooks/use-provider-ads";
import { useAds } from "@/lib/hooks/use-ads";
import { useTiktokCreativeUrlsBatch } from "@/lib/hooks/use-tiktok-creative-urls";
import type { TikTokCreativeUrls } from "@/lib/tiktok/normalize";
import { useSearchTerms } from "@/lib/hooks/use-search-terms";
import { useKeywords } from "@/lib/hooks/use-keywords";
import { useDateRangeStorage } from "@/lib/hooks/use-date-range-storage";
import { useElementHeight } from "@/lib/hooks/useElementHeight";
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
  formatCount,
  convertCurrency,
  CURRENCY_LABELS,
  type Currency,
} from "@/lib/currency";
import {
  formatChartDayLabel,
  formatChartTooltipLabel,
  type DateRangeValue,
  type DateRange,
  type CustomDateRange,
  type UnifiedCampaign,
  type UnifiedAd,
  type UnifiedAdTiktok,
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
  /**
   * Active connections scoped to the active workspace (filtered server-side
   * in page.tsx via getActiveConnectionsForWorkspace). ReportsClient derives
   * `connectedPlatforms` from this for the existing UI bits, and picks the
   * Meta account_id from it to scope all 6 Meta data fetches.
   */
  connections: WorkspaceConnection[];
  workspaces: Workspace[];
  activeWorkspaceId: number;
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

// Arabic relative-time formatter for "آخر تحديث: قبل X دقيقة".
// Picks the largest unit that fits and uses correct singular/dual/plural forms.
function formatArabicRelativeTime(date: Date, now: number): string {
  const diffMs = Math.max(0, now - date.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return "الآن";
  if (seconds < 60) return `قبل ${seconds} ثانية`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    if (minutes === 1) return "قبل دقيقة";
    if (minutes === 2) return "قبل دقيقتين";
    if (minutes <= 10) return `قبل ${minutes} دقائق`;
    return `قبل ${minutes} دقيقة`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return "قبل ساعة";
    if (hours === 2) return "قبل ساعتين";
    if (hours <= 10) return `قبل ${hours} ساعات`;
    return `قبل ${hours} ساعة`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return "قبل يوم";
  if (days === 2) return "قبل يومين";
  if (days <= 10) return `قبل ${days} أيام`;
  return `قبل ${days} يوم`;
}

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

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-yellow-100 text-yellow-700",
  DELETED: "bg-red-100 text-red-700",
  ARCHIVED: "bg-gray-100 text-gray-700",
};

const STATUS_LABELS_AR: Record<string, string> = {
  ACTIVE: "نشط",
  PAUSED: "موقوف",
  DELETED: "محذوف",
  ARCHIVED: "مؤرشف",
};

const CTA_LABELS_AR: Record<string, string> = {
  SHOP_NOW: "تسوّق الآن",
  LEARN_MORE: "تعلّم المزيد",
  SIGN_UP: "سجّل الآن",
  BOOK_TRAVEL: "احجز الآن",
  DOWNLOAD: "تنزيل",
  GET_OFFER: "احصل على العرض",
  SUBSCRIBE: "اشترك",
  CONTACT_US: "تواصل معنا",
};

function CarouselImage({ images }: { images: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  return (
    <div className="w-full h-full relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[currentIndex]}
        alt={`Slide ${currentIndex + 1}`}
        className="w-full h-full object-cover transition-opacity duration-300"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />

      <div className="absolute top-2 left-2">
        <span className="px-2 py-0.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded text-[10px] font-semibold flex items-center gap-1">
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {images.length} صور
        </span>
      </div>

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {images.map((_, idx) => (
          <button
            key={idx}
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex(idx);
            }}
            className={`w-1.5 h-1.5 rounded-full transition ${
              idx === currentIndex ? "bg-white scale-125" : "bg-white/50"
            }`}
            aria-label={`Slide ${idx + 1}`}
          />
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex(
                (prev) => (prev - 1 + images.length) % images.length
              );
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white text-gray-800 opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
            aria-label="Previous"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex((prev) => (prev + 1) % images.length);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white text-gray-800 opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
            aria-label="Next"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

interface CreativeCardProps {
  ad: UnifiedAd;
  accountCurrency: Currency;
  displayCurrency: Currency;
  onClick?: () => void;
}

function CreativeCard({
  ad,
  accountCurrency,
  displayCurrency,
  onClick,
}: CreativeCardProps) {
  // Variant narrowing — ad_type is the sole discriminator per ADR-013.
  // All variant-specific access goes through type_data after this point.
  const metaData = ad.ad_type === "META_AD" ? ad.type_data : undefined;
  const isMeta = ad.ad_type === "META_AD";
  const isVideo = metaData?.subType === "video";
  const isCatalog = metaData?.subType === "catalog";
  const isCarouselMeta = metaData?.subType === "carousel";

  // Cross-variant data accessors
  const headlines =
    ad.ad_type === "RSA" || ad.ad_type === "RDA"
      ? ad.type_data.headlines
      : undefined;
  const descriptions =
    ad.ad_type === "RSA" || ad.ad_type === "RDA"
      ? ad.type_data.descriptions
      : undefined;

  // Image URL — pulled from whichever variant owns it.
  const imageUrl: string | undefined = (() => {
    if (isMeta) return metaData?.imageUrl ?? metaData?.thumbnailUrl;
    if (ad.ad_type === "IMAGE_AD") return ad.type_data.imageUrl;
    // Single RDA marketing image → render as image.
    if (
      ad.ad_type === "RDA" &&
      ad.type_data.marketingImages?.length === 1
    ) {
      return ad.type_data.marketingImages[0];
    }
    return undefined;
  })();

  // Multi-image carousel — Meta carousel OR RDA with ≥2 marketing images.
  const carouselImages: string[] | undefined = (() => {
    if (
      metaData?.carouselImages &&
      metaData.carouselImages.length > 1
    ) {
      return metaData.carouselImages;
    }
    if (
      ad.ad_type === "RDA" &&
      ad.type_data.marketingImages &&
      ad.type_data.marketingImages.length > 1
    ) {
      return ad.type_data.marketingImages;
    }
    return undefined;
  })();
  const hasCarouselImages = !!carouselImages;

  const catalogProducts = metaData?.catalogProducts;
  const hasCatalogProducts =
    isCatalog &&
    Array.isArray(catalogProducts) &&
    catalogProducts.length > 0;

  const isText = (headlines?.length ?? 0) > 0;

  const extensionCount =
    (ad.extensions?.sitelinks?.length ?? 0) +
    (ad.extensions?.callouts?.length ?? 0) +
    (ad.extensions?.structuredSnippets?.length ?? 0) +
    (ad.extensions?.images?.length ?? 0);

  // M8 / ADR-014 §Decision 4 — split by fieldType for UI:
  //  - AD_IMAGE + MARKETING_IMAGE family → prominent grid (creative slot)
  //  - BUSINESS_LOGO / LANDSCAPE_LOGO   → small inline badge next to ad name
  const creativeImages = ad.extensions?.images?.filter(
    (img) =>
      img.fieldType === "AD_IMAGE" || img.fieldType.includes("MARKETING_IMAGE")
  );
  const logos = ad.extensions?.images?.filter(
    (img) =>
      img.fieldType === "BUSINESS_LOGO" || img.fieldType === "LANDSCAPE_LOGO"
  );

  return (
    <div
      className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition cursor-pointer"
      onClick={onClick}
    >
      <div className="aspect-square relative bg-gray-100 overflow-hidden">
        {hasCarouselImages ? (
          <CarouselImage images={carouselImages!} />
        ) : hasCatalogProducts ? (
          <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px bg-gray-200">
            {catalogProducts!.slice(0, 4).map((product) => (
              <div key={product.id} className="bg-gray-100 overflow-hidden">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt={product.name || "Product"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                    🛍️
                  </div>
                )}
              </div>
            ))}
            {Array.from({
              length: Math.max(0, 4 - catalogProducts!.length),
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center text-indigo-300 text-xl"
              >
                🛍️
              </div>
            ))}
          </div>
        ) : isCatalog ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-600 p-4">
            <svg
              className="w-12 h-12 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-xs font-semibold">إعلان كتالوج</p>
            <p className="text-[10px] text-indigo-400 mt-0.5 text-center">
              منتجات ديناميكية
            </p>
          </div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={ad.name}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : isText && headlines ? (
          <div className="w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 p-3 flex flex-col justify-center">
            <div className="text-sm font-semibold text-blue-700 line-clamp-2 mb-1">
              {headlines[0]}
            </div>
            {headlines[1] && (
              <div className="text-xs text-blue-600 line-clamp-1 mb-2">
                {headlines[1]}
              </div>
            )}
            {descriptions && descriptions.length > 0 && (
              <div className="text-xs text-gray-700 line-clamp-2 leading-relaxed">
                {descriptions[0]}
              </div>
            )}
            {(headlines.length > 2 ||
              (descriptions?.length ?? 0) > 1) && (
              <div className="text-[10px] text-blue-400 mt-2 text-center">
                +
                {Math.max(0, headlines.length - 2) +
                  Math.max(0, (descriptions?.length ?? 0) - 1)}{" "}
                عنصر إضافي
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            بدون صورة
          </div>
        )}

        {isVideo && !isCatalog && (
          <>
            <div className="absolute top-2 left-2">
              <span className="px-2 py-0.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded text-[10px] font-semibold flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                فيديو
              </span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <svg
                  className="w-5 h-5 text-gray-800 mr-0.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </>
        )}

        {isCatalog && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded text-[10px] font-semibold flex items-center gap-1">
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              كتالوج
            </span>
          </div>
        )}

        <div className="absolute top-2 right-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              STATUS_COLORS[ad.status] ?? STATUS_COLORS.ARCHIVED
            }`}
          >
            {STATUS_LABELS_AR[ad.status] ?? ad.status}
          </span>
        </div>
      </div>

      <div className="p-3">
        <h4
          className="font-semibold text-gray-900 text-xs line-clamp-2 mb-2 min-h-[2rem] flex items-center gap-1.5"
          title={ad.name}
        >
          {logos && logos.length > 0 && (
            // ADR-014 §Decision 4 — inline logo next to advertiser name.
            // Mirrors Google Search visual (logo next to domain). Only
            // first logo if multiple — rare but defensive.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logos[0].url}
              alt=""
              loading="lazy"
              className="h-5 w-5 rounded object-contain flex-shrink-0 bg-white"
            />
          )}
          <span className="min-w-0 truncate">{ad.name}</span>
        </h4>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-gray-500 text-[10px]">ROAS</p>
            {ad.hasConversionData && ad.roas !== null ? (
              <p className={`font-bold ${getROASColor(ad.roas)}`}>
                {ad.roas.toFixed(2)}x
              </p>
            ) : (
              <p
                className="font-bold text-gray-400"
                title="لم يتم إعداد تتبع الشراء في الحساب"
              >
                —
              </p>
            )}
          </div>
          <div className="text-left">
            <p className="text-gray-500 text-[10px]">المبيعات</p>
            {ad.hasConversionData && ad.purchases !== null ? (
              <p className="font-bold text-gray-900">{formatCount(ad.purchases)}</p>
            ) : (
              <p
                className="font-bold text-gray-400"
                title="لم يتم إعداد تتبع الشراء في الحساب"
              >
                —
              </p>
            )}
          </div>
          <div className="col-span-2">
            <p className="text-gray-500 text-[10px]">الإنفاق</p>
            <p className="font-bold text-gray-900">
              {formatAndConvert(ad.spend, (ad.currency as Currency) || accountCurrency, displayCurrency)}
            </p>
          </div>
          {extensionCount > 0 && (
            <div className="col-span-2 mt-1">
              <span className="inline-block text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                +{extensionCount} إضافة
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CarouselDisplayProps {
  images: string[];
  currentIndex: number;
  setCurrentIndex: (idx: number) => void;
}

/**
 * Slideshow with arrows + thumbnail strip. Used by AdDetailModal for both
 * classic carousels and Meta's Flexible Ads (asset_feed_spec.images).
 */
function CarouselDisplay({
  images,
  currentIndex,
  setCurrentIndex,
}: CarouselDisplayProps) {
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[currentIndex]}
        alt={`Image ${currentIndex + 1}`}
        className="w-full max-h-96 object-contain bg-gray-50"
      />

      <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
        {currentIndex + 1} / {images.length}
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={() =>
              setCurrentIndex(
                (currentIndex - 1 + images.length) % images.length
              )
            }
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-gray-800 flex items-center justify-center shadow-lg"
            aria-label="Previous"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          <button
            onClick={() => setCurrentIndex((currentIndex + 1) % images.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-gray-800 flex items-center justify-center shadow-lg"
            aria-label="Next"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </>
      )}

      <div className="flex gap-1 mt-2 overflow-x-auto p-2">
        {images.map((img, idx) => (
          <button
            key={idx}
            onClick={() => setCurrentIndex(idx)}
            className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition ${
              idx === currentIndex
                ? "border-indigo-600"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
            aria-label={`Go to image ${idx + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt={`Thumbnail ${idx + 1}`}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

interface AdDetailModalProps {
  ad: UnifiedAd;
  accountCurrency: Currency;
  displayCurrency: Currency;
  onClose: () => void;
  /**
   * M7 / ADR-015 — count of ads sharing the same ad_group as `ad`.
   * Used in the keywords section badge to surface the keyword-sharing
   * context. Defaults to 0 when not provided (Meta/PMax callers).
   */
  adGroupAdCount?: number;
  /**
   * ADR-019 (M9.1) — date range plumbed through for the lazy
   * search-terms + keywords fetches. Must match the range used for
   * the parent creatives fetch so KPIs and per-ad metrics align.
   */
  range?: DateRange;
  customRange?: CustomDateRange;
  /**
   * Phase 7 / ADR-020 §2b — campaign-level ROAS for TIKTOK_AD only.
   * Per-ad ROAS is misleading for TikTok (app/web pixel attribution
   * split), so the TikTok modal surfaces the parent-campaign ROAS
   * instead. Passed through to TikTokAdDetailModal via the early-
   * return branch; ignored for all other variants. 2d-4 will replace
   * the current null placeholder with a real lookup at the call site.
   */
  campaignRoas?: number | null;
}

function AdDetailModal({
  ad,
  accountCurrency,
  displayCurrency,
  onClose,
  adGroupAdCount = 0,
  range,
  customRange,
  campaignRoas = null,
}: AdDetailModalProps) {
  // PMAX_ASSET_GROUP gets its own dedicated modal — wholly different
  // shape (tabbed asset surfaces, wider shell, in-modal YouTube embeds,
  // image lightbox). The Meta-tilted narrowing below is shaped for
  // M5/M6 variants only; routing PMax through it would produce a blank
  // modal. See PMaxAssetGroupModalContent below.
  if (ad.ad_type === "PMAX_ASSET_GROUP") {
    return (
      <PMaxAssetGroupModalContent
        ad={ad}
        accountCurrency={accountCurrency}
        displayCurrency={displayCurrency}
        onClose={onClose}
      />
    );
  }

  // TIKTOK_AD gets its own dedicated modal — vertical 9:16 video
  // player, on-mount signed-URL fetch via useTiktokCreativeUrl, and
  // a campaign-level ROAS cell (per-ad ROAS would mix TikTok's app
  // vs web pixel attribution surfaces — §2b). Same early-return
  // pattern as PMAX above.
  if (ad.ad_type === "TIKTOK_AD") {
    return (
      <TikTokAdDetailModal
        ad={ad}
        accountCurrency={accountCurrency}
        displayCurrency={displayCurrency}
        onClose={onClose}
        campaignRoas={campaignRoas}
      />
    );
  }

  // Variant narrowing — ad_type is the sole discriminator per ADR-013.
  const metaData = ad.ad_type === "META_AD" ? ad.type_data : undefined;
  const isMeta = ad.ad_type === "META_AD";
  const isVideo = metaData?.subType === "video";
  const isCatalog = metaData?.subType === "catalog";

  // Cross-variant accessors
  const headlines =
    ad.ad_type === "RSA" || ad.ad_type === "RDA"
      ? ad.type_data.headlines
      : undefined;
  const descriptions =
    ad.ad_type === "RSA" || ad.ad_type === "RDA"
      ? ad.type_data.descriptions
      : undefined;

  // M8 / ADR-014 §Decision 4 — image extensions split by fieldType.
  // Mirrors the compact CreativeCard split so the modal renders the
  // same semantic distinction (logos as identity, creative images as
  // primary visual content).
  const creativeImages = ad.extensions?.images?.filter(
    (img) =>
      img.fieldType === "AD_IMAGE" || img.fieldType.includes("MARKETING_IMAGE")
  );

  // M7 / ADR-015 — keywords section state. Sort + match-type filter
  // apply client-side (no re-fetch); pagination toggles between top 50
  // and full list. Status filter is enforced server-side (strict ENABLED
  // per ADR-015 §Decision 5; UI re-fetch toggle deferred to M7.1).
  const [keywordSortKey, setKeywordSortKey] = useState<
    | "spend"
    | "impressions"
    | "clicks"
    | "ctr"
    | "qualityScore"
    | "revenue"
    | "purchases"
  >("spend");
  const [keywordMatchFilter, setKeywordMatchFilter] = useState<
    "all" | "EXACT" | "PHRASE" | "BROAD"
  >("all");
  const [keywordShowAll, setKeywordShowAll] = useState(false);
  const KEYWORD_PAGE_SIZE = 50;

  // ADR-019 (M9.1) — keywords + search terms lazy-fetched on modal
  // mount instead of being bundled into the creatives payload. AbortController
  // inside both hooks cancels in-flight requests if the modal closes
  // mid-fetch (unmount-race gate). The `enabled` flag fires only for
  // Google Search ads (Meta/PMax leave adsetId blank or carry no
  // ad_group-scoped data).
  const supportsAdGroupData =
    ad.provider === "google" &&
    typeof ad.adsetId === "string" &&
    ad.adsetId.length > 0 &&
    typeof ad.accountId === "string" &&
    ad.accountId.length > 0;

  const {
    keywords: keywordsRaw,
    loading: keywordsLoading,
    error: keywordsError,
    refresh: refreshKeywords,
  } = useKeywords({
    accountId: ad.accountId ?? "",
    adGroupId: ad.adsetId ?? "",
    range,
    customRange,
    enabled: supportsAdGroupData,
  });
  const filteredKeywords = useMemo(() => {
    let result = keywordsRaw;
    if (keywordMatchFilter !== "all") {
      result = result.filter((k) => k.matchType === keywordMatchFilter);
    }
    const sorted = [...result].sort((a, b) => {
      // Undefined / null values sink to the bottom for desc sorts —
      // matches M7's qualityScore precedent. Applies to revenue +
      // purchases too (null when hasConversionData=false).
      if (keywordSortKey === "qualityScore") {
        const av = a.qualityScore ?? -Infinity;
        const bv = b.qualityScore ?? -Infinity;
        return bv - av;
      }
      if (keywordSortKey === "revenue" || keywordSortKey === "purchases") {
        const av = a[keywordSortKey] ?? -Infinity;
        const bv = b[keywordSortKey] ?? -Infinity;
        return bv - av;
      }
      return (b[keywordSortKey] ?? 0) - (a[keywordSortKey] ?? 0);
    });
    return sorted;
  }, [keywordsRaw, keywordMatchFilter, keywordSortKey]);

  const visibleKeywords = keywordShowAll
    ? filteredKeywords
    : filteredKeywords.slice(0, KEYWORD_PAGE_SIZE);

  const matchTypeBreakdown = useMemo(() => {
    const counts = { EXACT: 0, PHRASE: 0, BROAD: 0 };
    for (const k of keywordsRaw) counts[k.matchType] += 1;
    return counts;
  }, [keywordsRaw]);

  // M7.5 / ADR-016 §Decision 2 — KPI strip totals computed from the
  // CURRENTLY-VISIBLE (filtered + sorted, but pre-pagination) set.
  // Reactive to filter changes: switching to EXACT-only updates totals
  // to reflect only EXACT keywords. ADR-016 §Open Items §2 flagged
  // this choice for post-deploy UX evaluation (vs computing from all
  // keywords regardless of filter).
  //
  // Empty-state semantic (ADR-016 §Decision 7): if NO visible keyword
  // has hasConversionData=true, both totals render "—" with tooltip.
  // Otherwise sum across the visible keywords skipping null entries.
  const keywordKpiTotals = useMemo(() => {
    let anyHasConversionData = false;
    let revenueSum = 0;
    let purchasesSum = 0;
    for (const k of filteredKeywords) {
      if (k.hasConversionData) {
        anyHasConversionData = true;
        if (k.revenue != null) revenueSum += k.revenue;
        if (k.purchases != null) purchasesSum += k.purchases;
      }
    }
    return anyHasConversionData
      ? { revenue: revenueSum, purchases: purchasesSum, hasData: true as const }
      : { revenue: null, purchases: null, hasData: false as const };
  }, [filteredKeywords]);

  const totalKeywordCount = keywordsRaw.length;

  // M9 / ADR-018 — Search Terms section state. Mirrors M7.5 keywords
  // pattern: client-side sort + filter + pagination. Status filter is
  // applied here (NOT in GAQL) per ADR-018 §Decision 3 to avoid cache
  // fragmentation — one cached payload covers all UI preferences.
  const [searchTermSortKey, setSearchTermSortKey] = useState<
    | "spend"
    | "impressions"
    | "clicks"
    | "ctr"
    | "revenue"
    | "purchases"
    | "roas"
  >("spend");
  const [searchTermMatchFilter, setSearchTermMatchFilter] = useState<
    "all" | "EXACT" | "PHRASE" | "BROAD"
  >("all");
  // Status filter default per ADR-018 §Decision 3: ADDED + NONE only.
  // "الكل" opt-in surfaces EXCLUDED / ADDED_EXCLUDED / UNKNOWN.
  const [searchTermStatusFilter, setSearchTermStatusFilter] = useState<
    "default" | "all" | "ADDED" | "NONE" | "EXCLUDED" | "UNKNOWN"
  >("default");
  const [searchTermShowAll, setSearchTermShowAll] = useState(false);
  const SEARCH_TERM_PAGE_SIZE = 50;

  // ADR-019 (M9.1) — search terms via lazy fetch (see keywords hook above).
  const {
    searchTerms: searchTermsRaw,
    loading: searchTermsLoading,
    error: searchTermsError,
    refresh: refreshSearchTerms,
  } = useSearchTerms({
    accountId: ad.accountId ?? "",
    adGroupId: ad.adsetId ?? "",
    range,
    customRange,
    enabled: supportsAdGroupData,
  });
  const filteredSearchTerms = useMemo(() => {
    let result = searchTermsRaw;
    if (searchTermStatusFilter === "default") {
      result = result.filter(
        (t) => t.status === "ADDED" || t.status === "NONE"
      );
    } else if (searchTermStatusFilter !== "all") {
      result = result.filter((t) => t.status === searchTermStatusFilter);
    }
    if (searchTermMatchFilter !== "all") {
      result = result.filter((t) => t.matchType === searchTermMatchFilter);
    }
    const sorted = [...result].sort((a, b) => {
      // Same null-sinks-to-bottom convention as M7.5 keyword sort
      // (revenue/purchases/roas all nullable when hasConversionData=false).
      if (
        searchTermSortKey === "revenue" ||
        searchTermSortKey === "purchases" ||
        searchTermSortKey === "roas"
      ) {
        const av = a[searchTermSortKey] ?? -Infinity;
        const bv = b[searchTermSortKey] ?? -Infinity;
        return bv - av;
      }
      return (b[searchTermSortKey] ?? 0) - (a[searchTermSortKey] ?? 0);
    });
    return sorted;
  }, [
    searchTermsRaw,
    searchTermStatusFilter,
    searchTermMatchFilter,
    searchTermSortKey,
  ]);

  const visibleSearchTerms = searchTermShowAll
    ? filteredSearchTerms
    : filteredSearchTerms.slice(0, SEARCH_TERM_PAGE_SIZE);

  // KPI strip totals — computed from filtered set per ADR-018 §Decision 4
  // (same convention as M7.5 §Decision 2).
  const searchTermKpiTotals = useMemo(() => {
    let anyHasConversionData = false;
    let revenueSum = 0;
    let purchasesSum = 0;
    for (const t of filteredSearchTerms) {
      if (t.hasConversionData) {
        anyHasConversionData = true;
        if (t.revenue != null) revenueSum += t.revenue;
        if (t.purchases != null) purchasesSum += t.purchases;
      }
    }
    return anyHasConversionData
      ? { revenue: revenueSum, purchases: purchasesSum, hasData: true as const }
      : { revenue: null, purchases: null, hasData: false as const };
  }, [filteredSearchTerms]);

  const totalSearchTermCount = searchTermsRaw.length;

  const imageUrl: string | undefined = (() => {
    if (isMeta) return metaData?.imageUrl ?? metaData?.thumbnailUrl;
    if (ad.ad_type === "IMAGE_AD") return ad.type_data.imageUrl;
    if (
      ad.ad_type === "RDA" &&
      ad.type_data.marketingImages?.length === 1
    ) {
      return ad.type_data.marketingImages[0];
    }
    return undefined;
  })();

  // Multi-image gallery — Meta carousel OR RDA with ≥2 marketing images.
  const carouselImages: string[] | undefined = (() => {
    if (
      metaData?.carouselImages &&
      metaData.carouselImages.length >= 2
    ) {
      return metaData.carouselImages;
    }
    if (
      ad.ad_type === "RDA" &&
      ad.type_data.marketingImages &&
      ad.type_data.marketingImages.length >= 2
    ) {
      return ad.type_data.marketingImages;
    }
    return undefined;
  })();
  const hasCarouselImages = !!carouselImages;

  const catalogProducts = metaData?.catalogProducts;
  const hasCatalogProducts =
    isCatalog &&
    Array.isArray(catalogProducts) &&
    catalogProducts.length > 0;

  const isText = (headlines?.length ?? 0) > 0;

  // Meta-only text fields
  const title = metaData?.title;
  const body = metaData?.body;
  const callToAction = metaData?.callToAction;
  const previewLink = metaData?.previewLink;
  const thumbnailUrl = metaData?.thumbnailUrl;

  const [carouselIndex, setCarouselIndex] = useState(0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-bold text-gray-900 text-lg">تفاصيل الإعلان</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="rounded-lg overflow-hidden bg-gray-100">
            {isVideo ? (
              thumbnailUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl}
                    alt={ad.name}
                    className="w-full max-h-96 object-contain bg-gray-50"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                    <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <svg
                        className="w-7 h-7 text-gray-800 mr-1"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video flex items-center justify-center text-gray-400 bg-gray-50">
                  لا توجد معاينة للفيديو
                </div>
              )
            ) : hasCarouselImages ? (
              <CarouselDisplay
                images={carouselImages!}
                currentIndex={carouselIndex}
                setCurrentIndex={setCarouselIndex}
              />
            ) : hasCatalogProducts ? (
              <div className="grid grid-cols-2 gap-1 aspect-square">
                {catalogProducts!.slice(0, 4).map((product) => (
                  <div key={product.id} className="bg-white overflow-hidden">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt={product.name || "Product"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        🛍️
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={ad.name}
                className="w-full max-h-96 object-contain bg-gray-50"
              />
            ) : isText && headlines ? (
              <div className="w-full aspect-[4/3] bg-gradient-to-br from-blue-50 to-indigo-50 p-6 flex flex-col justify-center rounded-lg">
                <div className="text-lg md:text-xl font-semibold text-blue-700 mb-2 leading-relaxed">
                  {headlines[0]}
                </div>
                {headlines[1] && (
                  <div className="text-sm md:text-base text-blue-600 mb-3">
                    {headlines[1]}
                  </div>
                )}
                {descriptions && descriptions.length > 0 && (
                  <div className="text-sm text-gray-700 leading-relaxed">
                    {descriptions[0]}
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-video flex items-center justify-center text-gray-400 bg-gray-50">
                لا توجد صورة
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">اسم الإعلان</p>
            <h4 className="font-semibold text-gray-900">{ad.name}</h4>
          </div>

          {title && (
            <div>
              <p className="text-xs text-gray-500 mb-1">عنوان الإعلان</p>
              <p className="text-sm font-medium text-gray-900">{title}</p>
            </div>
          )}

          {body && (
            <div>
              <p className="text-xs text-gray-500 mb-1">نص الإعلان</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {body}
              </p>
            </div>
          )}

          {callToAction && (
            <div>
              <p className="text-xs text-gray-500 mb-1">زر الإجراء</p>
              <span className="inline-block px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold">
                {CTA_LABELS_AR[callToAction] ?? callToAction}
              </span>
            </div>
          )}

          {headlines && headlines.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                العناوين ({headlines.length})
              </p>
              <ol className="space-y-1.5">
                {headlines.map((headline, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-700 flex gap-2 items-start"
                  >
                    <span className="text-xs text-gray-400 mt-0.5 min-w-[1.25rem]">
                      {i + 1}.
                    </span>
                    <span className="flex-1">{headline}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {descriptions && descriptions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                الأوصاف ({descriptions.length})
              </p>
              <ol className="space-y-1.5">
                {descriptions.map((description, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-700 flex gap-2 items-start"
                  >
                    <span className="text-xs text-gray-400 mt-0.5 min-w-[1.25rem]">
                      {i + 1}.
                    </span>
                    <span className="flex-1 leading-relaxed">
                      {description}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Phase 4.8 M8 — Image Extensions (creative grid) per ADR-014 §Decision 4.
              Rendered ABOVE text extensions because images are visually primary. */}
          {creativeImages && creativeImages.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                الصور الإعلانية ({creativeImages.length})
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {creativeImages.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.assetId}
                    src={img.url}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full rounded-lg object-cover bg-gray-100 border border-gray-200"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Phase 4.8 M6 — Asset Extensions (Google-only) per ADR-012 */}
          {ad.extensions?.sitelinks && ad.extensions.sitelinks.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                روابط مرتبطة ({ad.extensions.sitelinks.length})
              </p>
              <div className="space-y-2">
                {ad.extensions.sitelinks.map((sl, i) =>
                  sl.finalUrl ? (
                    <a
                      key={i}
                      href={sl.finalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-blue-50 hover:bg-blue-100 transition-colors rounded-lg p-3 border border-blue-100 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-blue-700 group-hover:text-blue-800 flex-1 min-w-0">
                          {sl.text}
                        </div>
                        <svg
                          className="w-4 h-4 text-blue-400 group-hover:text-blue-600 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </div>
                    </a>
                  ) : (
                    <div
                      key={i}
                      className="bg-blue-50 rounded-lg p-3 border border-blue-100"
                    >
                      <div className="text-sm font-medium text-blue-700">
                        {sl.text}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {ad.extensions?.callouts && ad.extensions.callouts.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                إضافات نصية ({ad.extensions.callouts.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {ad.extensions.callouts.map((co, i) => (
                  <span
                    key={i}
                    className="inline-block bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-sm border border-emerald-100"
                  >
                    {co}
                  </span>
                ))}
              </div>
            </div>
          )}

          {ad.extensions?.structuredSnippets &&
            ad.extensions.structuredSnippets.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">
                  بيانات تفصيلية ({ad.extensions.structuredSnippets.length})
                </p>
                <div className="space-y-3">
                  {ad.extensions.structuredSnippets.map((ss, i) => (
                    <div
                      key={i}
                      className="bg-purple-50 rounded-lg p-3 border border-purple-100"
                    >
                      <div className="text-sm font-semibold text-purple-700 mb-2">
                        {ss.header}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ss.values.map((v, j) => (
                          <span
                            key={j}
                            className="inline-block bg-white text-purple-600 px-2.5 py-1 rounded text-xs border border-purple-100"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Phase 4.8 M7 — Keywords on Search ads per ADR-015. Renders
              only when the ad's parent ad_group has keywords (Google
              Search ads only — Meta + PMax leave ad.keywords undefined). */}
          {/* ADR-019 (M9.1) — render the section frame whenever lazy fetch
              is in flight, in error, or has data. Gates on supportsAdGroupData
              to skip Meta/PMax variants entirely. */}
          {supportsAdGroupData && (keywordsLoading || keywordsError || totalKeywordCount > 0) && (
            <div className="bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-y border-gray-200">
              {/* Header + sharing-context badge per ADR-015 §Decision 7.
                  Format: "الكلمات المفتاحية لمجموعة '[campaign / ad_group]'
                  — مشتركة بين N إعلان في نفس المجموعة" */}
              <div className="mb-3">
                <p className="text-sm font-semibold text-gray-800 mb-1">
                  الكلمات المفتاحية{keywordsLoading ? "" : ` (${totalKeywordCount})`}
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  لمجموعة &lsquo;
                  {ad.campaignName && ad.adsetName
                    ? `${ad.campaignName} / ${ad.adsetName}`
                    : ad.adsetName ?? ad.campaignName ?? "—"}
                  &rsquo; — مشتركة بين {adGroupAdCount} إعلان في نفس المجموعة
                </p>
              </div>

              {keywordsLoading ? (
                <div className="flex items-center justify-center py-6 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                  <span className="text-xs">جاري تحميل الكلمات المفتاحية...</span>
                </div>
              ) : keywordsError ? (
                <div className="text-center py-6">
                  <p className="text-xs text-red-600 mb-2">
                    {keywordsError === "reauth_required"
                      ? "انتهت صلاحية ربط حساب Google"
                      : "تعذّر تحميل الكلمات المفتاحية"}
                  </p>
                  <button
                    onClick={() => refreshKeywords()}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : (
                <>
              {/* Match-type breakdown (3 bars) — visual at-a-glance */}
              <div className="mb-3 flex items-center gap-1.5 text-[10px]">
                {(["EXACT", "PHRASE", "BROAD"] as const).map((mt) => {
                  const n = matchTypeBreakdown[mt];
                  const pct =
                    totalKeywordCount > 0 ? (n / totalKeywordCount) * 100 : 0;
                  const color =
                    mt === "EXACT"
                      ? "bg-indigo-500"
                      : mt === "PHRASE"
                        ? "bg-blue-400"
                        : "bg-sky-300";
                  return (
                    <div
                      key={mt}
                      className="flex-1 min-w-0"
                      title={`${mt}: ${n} (${pct.toFixed(0)}%)`}
                    >
                      <div className="flex justify-between text-gray-500 mb-0.5">
                        <span>{mt}</span>
                        <span className="font-medium">{n}</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${color} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* M7.5 / ADR-016 §Decision 2 — KPI strip above table.
                  Totals computed from currently-visible (filtered) set,
                  reactive to filter changes. Empty-state ("—") per
                  §Decision 7 when no visible keyword has conversion data. */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="bg-white rounded-lg p-2.5 border border-gray-200">
                  <p className="text-[10px] text-gray-500 mb-0.5">
                    إجمالي المبيعات
                  </p>
                  {keywordKpiTotals.hasData ? (
                    <p className="text-sm font-bold text-gray-800 tabular-nums">
                      {formatAndConvert(
                        keywordKpiTotals.revenue,
                        (ad.currency as Currency) || accountCurrency,
                        displayCurrency
                      )}
                    </p>
                  ) : (
                    <p
                      className="text-sm font-bold text-gray-400"
                      title="لا توجد بيانات تحويل لهذا الحساب"
                    >
                      —
                    </p>
                  )}
                </div>
                <div className="bg-white rounded-lg p-2.5 border border-gray-200">
                  <p className="text-[10px] text-gray-500 mb-0.5">
                    إجمالي عمليات الشراء
                  </p>
                  {keywordKpiTotals.hasData ? (
                    <p className="text-sm font-bold text-gray-800 tabular-nums">
                      {Math.round(keywordKpiTotals.purchases).toLocaleString(
                        "en-US"
                      )}
                    </p>
                  ) : (
                    <p
                      className="text-sm font-bold text-gray-400"
                      title="لا توجد بيانات تحويل لهذا الحساب"
                    >
                      —
                    </p>
                  )}
                </div>
              </div>

              {/* Filter + sort controls */}
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <select
                  value={keywordSortKey}
                  onChange={(e) =>
                    setKeywordSortKey(
                      e.target.value as typeof keywordSortKey
                    )
                  }
                  className="px-2 py-1 border border-gray-300 rounded bg-white text-gray-700"
                  aria-label="ترتيب الكلمات"
                >
                  <option value="spend">الترتيب: التكلفة</option>
                  <option value="revenue">الترتيب: مبيعات</option>
                  <option value="purchases">الترتيب: عمليات الشراء</option>
                  <option value="impressions">الترتيب: الانطباعات</option>
                  <option value="clicks">الترتيب: النقرات</option>
                  <option value="ctr">الترتيب: CTR</option>
                  <option value="qualityScore">الترتيب: جودة</option>
                </select>
                <select
                  value={keywordMatchFilter}
                  onChange={(e) =>
                    setKeywordMatchFilter(
                      e.target.value as typeof keywordMatchFilter
                    )
                  }
                  className="px-2 py-1 border border-gray-300 rounded bg-white text-gray-700"
                  aria-label="نوع المطابقة"
                >
                  <option value="all">المطابقة: الكل</option>
                  <option value="EXACT">المطابقة: EXACT</option>
                  <option value="PHRASE">المطابقة: PHRASE</option>
                  <option value="BROAD">المطابقة: BROAD</option>
                </select>
              </div>

              {/* Table */}
              <div className="max-h-[60vh] overflow-y-auto bg-white rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 text-gray-600 sticky top-0">
                    <tr>
                      <th className="text-right px-3 py-2 font-medium">
                        الكلمة
                      </th>
                      <th className="text-right px-2 py-2 font-medium">
                        المطابقة
                      </th>
                      <th className="text-left px-2 py-2 font-medium">
                        التكلفة
                      </th>
                      <th className="text-left px-2 py-2 font-medium">
                        مبيعات
                      </th>
                      <th className="text-left px-2 py-2 font-medium">
                        عمليات الشراء
                      </th>
                      <th className="text-left px-2 py-2 font-medium">
                        النقرات
                      </th>
                      <th className="text-left px-2 py-2 font-medium">
                        الانطباعات
                      </th>
                      <th className="text-left px-2 py-2 font-medium">CTR</th>
                      <th className="text-left px-2 py-2 font-medium">جودة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleKeywords.map((k) => (
                      <tr
                        key={k.id}
                        className="border-t border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-3 py-2 text-gray-800 max-w-[200px] truncate" title={k.text}>
                          {k.text}
                        </td>
                        <td className="px-2 py-2 text-gray-600">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-[10px]">
                            {k.matchType}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {formatAndConvert(
                            k.spend,
                            (ad.currency as Currency) || accountCurrency,
                            displayCurrency
                          )}
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {k.hasConversionData && k.revenue != null
                            ? formatAndConvert(
                                k.revenue,
                                (ad.currency as Currency) || accountCurrency,
                                displayCurrency
                              )
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {k.hasConversionData && k.purchases != null
                            ? Math.round(k.purchases).toLocaleString("en-US")
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {Math.round(k.clicks).toLocaleString("en-US")}
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {Math.round(k.impressions).toLocaleString("en-US")}
                        </td>
                        <td className="px-2 py-2 text-left tabular-nums text-gray-700">
                          {k.ctr > 0 ? `${k.ctr.toFixed(1)}%` : "—"}
                        </td>
                        <td
                          className="px-2 py-2 text-left tabular-nums text-gray-700"
                          title={
                            k.qualityScore === undefined
                              ? "غير كافي البيانات لحساب جودة الكلمة"
                              : undefined
                          }
                        >
                          {k.qualityScore ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination toggle — only when filtered set exceeds page size */}
              {filteredKeywords.length > KEYWORD_PAGE_SIZE && (
                <button
                  type="button"
                  onClick={() => setKeywordShowAll((v) => !v)}
                  className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  {keywordShowAll
                    ? `عرض الأعلى 50 فقط`
                    : `عرض الكل (${filteredKeywords.length})`}
                </button>
              )}
                </>
              )}
            </div>
          )}

          {/* Phase 4.8 M9 — Search Terms per ADR-018, lazy-loaded per ADR-019.
              Same loading/error/empty branches as the keywords section above. */}
          {supportsAdGroupData && (searchTermsLoading || searchTermsError || totalSearchTermCount > 0) && (
            <div className="bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-y border-gray-200">
              {/* Header + sharing-context badge */}
              <div className="mb-3">
                <p className="text-sm font-semibold text-gray-800 mb-1">
                  كلمات البحث الفعلية{searchTermsLoading ? "" : ` (${totalSearchTermCount})`}
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  لمجموعة &lsquo;
                  {ad.campaignName && ad.adsetName
                    ? `${ad.campaignName} / ${ad.adsetName}`
                    : ad.adsetName ?? ad.campaignName ?? "—"}
                  &rsquo; — مشتركة بين {adGroupAdCount} إعلان في نفس المجموعة
                </p>
              </div>

              {searchTermsLoading ? (
                <div className="flex items-center justify-center py-6 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                  <span className="text-xs">جاري تحميل كلمات البحث... قد يستغرق ~5 ثوانٍ</span>
                </div>
              ) : searchTermsError ? (
                <div className="text-center py-6">
                  <p className="text-xs text-red-600 mb-2">
                    {searchTermsError === "reauth_required"
                      ? "انتهت صلاحية ربط حساب Google"
                      : "تعذّر تحميل كلمات البحث"}
                  </p>
                  <button
                    onClick={() => refreshSearchTerms()}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : (
                <>
              {/* KPI strip — 2 cards (إجمالي المبيعات + إجمالي عمليات الشراء).
                  Per ADR-018 §Decision 4: computed from filtered set,
                  reactive to filter changes. Empty-state "—" with tooltip
                  when no visible term has conversion data. */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="bg-white rounded-lg p-2.5 border border-gray-200">
                  <p className="text-[10px] text-gray-500 mb-0.5">
                    إجمالي المبيعات
                  </p>
                  {searchTermKpiTotals.hasData ? (
                    <p className="text-sm font-bold text-gray-800 tabular-nums">
                      {formatAndConvert(
                        searchTermKpiTotals.revenue,
                        (ad.currency as Currency) || accountCurrency,
                        displayCurrency
                      )}
                    </p>
                  ) : (
                    <p
                      className="text-sm font-bold text-gray-400"
                      title="لا توجد بيانات تحويل لهذا الحساب"
                    >
                      —
                    </p>
                  )}
                </div>
                <div className="bg-white rounded-lg p-2.5 border border-gray-200">
                  <p className="text-[10px] text-gray-500 mb-0.5">
                    إجمالي عمليات الشراء
                  </p>
                  {searchTermKpiTotals.hasData ? (
                    <p className="text-sm font-bold text-gray-800 tabular-nums">
                      {formatCount(searchTermKpiTotals.purchases)}
                    </p>
                  ) : (
                    <p
                      className="text-sm font-bold text-gray-400"
                      title="لا توجد بيانات تحويل لهذا الحساب"
                    >
                      —
                    </p>
                  )}
                </div>
              </div>

              {/* Filter + sort dropdowns */}
              <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
                <select
                  value={searchTermStatusFilter}
                  onChange={(e) =>
                    setSearchTermStatusFilter(
                      e.target.value as typeof searchTermStatusFilter
                    )
                  }
                  className="bg-white border border-gray-200 rounded px-2 py-1"
                >
                  <option value="default">مضاف + لا يوجد</option>
                  <option value="all">الكل</option>
                  <option value="ADDED">مضاف</option>
                  <option value="NONE">لا يوجد</option>
                  <option value="EXCLUDED">مستبعد</option>
                  <option value="UNKNOWN">غير معروف</option>
                </select>
                <select
                  value={searchTermMatchFilter}
                  onChange={(e) =>
                    setSearchTermMatchFilter(
                      e.target.value as typeof searchTermMatchFilter
                    )
                  }
                  className="bg-white border border-gray-200 rounded px-2 py-1"
                >
                  <option value="all">كل أنواع المطابقة</option>
                  <option value="EXACT">EXACT</option>
                  <option value="PHRASE">PHRASE</option>
                  <option value="BROAD">BROAD</option>
                </select>
                <select
                  value={searchTermSortKey}
                  onChange={(e) =>
                    setSearchTermSortKey(
                      e.target.value as typeof searchTermSortKey
                    )
                  }
                  className="bg-white border border-gray-200 rounded px-2 py-1"
                >
                  <option value="spend">التكلفة</option>
                  <option value="revenue">المبيعات</option>
                  <option value="roas">ROAS</option>
                  <option value="purchases">عمليات الشراء</option>
                  <option value="impressions">الانطباعات</option>
                  <option value="clicks">النقرات</option>
                  <option value="ctr">CTR</option>
                </select>
              </div>

              {/* Table — top 50 default + "عرض الكل (N)" toggle */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="text-right py-1.5 px-2 font-medium">
                        الكلمة
                      </th>
                      <th className="text-center py-1.5 px-2 font-medium">
                        الحالة
                      </th>
                      <th className="text-center py-1.5 px-2 font-medium">
                        المطابقة
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        التكلفة
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        المبيعات
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        ROAS
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        الشراء
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        الانطباعات
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        النقرات
                      </th>
                      <th className="text-right py-1.5 px-2 font-medium">
                        CTR
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSearchTerms.map((t, i) => {
                      const statusBadge =
                        t.status === "ADDED"
                          ? { cls: "bg-green-100 text-green-700", label: "مضاف" }
                          : t.status === "NONE"
                            ? { cls: "bg-gray-100 text-gray-700", label: "لا يوجد" }
                            : t.status === "EXCLUDED"
                              ? { cls: "bg-red-100 text-red-700", label: "مستبعد" }
                              : t.status === "ADDED_EXCLUDED"
                                ? { cls: "bg-amber-100 text-amber-700", label: "مضاف+مستبعد" }
                                : { cls: "bg-yellow-100 text-yellow-700", label: "—" };
                      const matchBadge =
                        t.matchType === "EXACT"
                          ? "bg-indigo-100 text-indigo-700"
                          : t.matchType === "PHRASE"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-sky-100 text-sky-700";
                      return (
                        <tr
                          key={`${t.text}-${i}`}
                          className="border-b border-gray-100 last:border-b-0 hover:bg-white/60"
                        >
                          <td
                            className="text-right py-2 px-2 max-w-[220px] truncate text-gray-900"
                            title={
                              t.triggeredByKeywordText
                                ? `${t.text} (من: ${t.triggeredByKeywordText})`
                                : t.text
                            }
                          >
                            {t.text}
                          </td>
                          <td className="text-center py-2 px-2">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${statusBadge.cls}`}
                            >
                              {statusBadge.label}
                            </span>
                          </td>
                          <td className="text-center py-2 px-2">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${matchBadge}`}
                            >
                              {t.matchType}
                            </span>
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {formatAndConvert(
                              t.spend,
                              (ad.currency as Currency) || accountCurrency,
                              displayCurrency
                            )}
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {t.hasConversionData && t.revenue != null
                              ? formatAndConvert(
                                  t.revenue,
                                  (ad.currency as Currency) || accountCurrency,
                                  displayCurrency
                                )
                              : "—"}
                          </td>
                          <td
                            className={`text-right py-2 px-2 font-semibold ${t.roas != null ? getROASColor(t.roas) : "text-gray-400"}`}
                          >
                            {t.roas != null ? `${t.roas.toFixed(2)}x` : "—"}
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {t.hasConversionData && t.purchases != null
                              ? formatCount(t.purchases)
                              : "—"}
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {t.impressions.toLocaleString("en-US")}
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {t.clicks.toLocaleString("en-US")}
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {t.ctr.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination toggle */}
              {filteredSearchTerms.length > SEARCH_TERM_PAGE_SIZE && (
                <button
                  type="button"
                  onClick={() => setSearchTermShowAll((v) => !v)}
                  className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  {searchTermShowAll
                    ? `عرض الأعلى 50 فقط`
                    : `عرض الكل (${filteredSearchTerms.length})`}
                </button>
              )}

              {/* Empty-filtered-state message — surfaces when filters
                  hide everything (e.g. all terms are EXCLUDED but
                  default filter hides them). Distinct from the
                  "no terms in date range" outer guard. */}
              {filteredSearchTerms.length === 0 && (
                <p className="text-xs text-gray-500 italic mt-2">
                  لا تطابق أي كلمات بحث المرشحات الحالية.
                </p>
              )}
                </>
              )}
            </div>
          )}

          {hasCatalogProducts && catalogProducts && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                أفضل المنتجات في الكتالوج
              </p>
              <div className="space-y-2">
                {catalogProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg"
                  >
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt={product.name || ""}
                        className="w-12 h-12 rounded object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center">
                        🛍️
                      </div>
                    )}
                    <p className="text-sm text-gray-700 flex-1 truncate">
                      {product.name || product.id}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 mb-3">
              الأداء في الفترة المختارة
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">ROAS</p>
                {ad.hasConversionData && ad.roas !== null ? (
                  <p
                    className={`text-lg font-bold ${getROASColor(ad.roas)}`}
                  >
                    {ad.roas.toFixed(2)}x
                  </p>
                ) : (
                  <p
                    className="text-lg font-bold text-gray-400"
                    title="لم يتم إعداد تتبع الشراء في الحساب"
                  >
                    —
                  </p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">الإنفاق</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatAndConvert(ad.spend, (ad.currency as Currency) || accountCurrency, displayCurrency)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">الإيرادات</p>
                {ad.hasConversionData && ad.revenue !== null ? (
                  <p className="text-lg font-bold text-green-600">
                    {formatAndConvert(
                      ad.revenue,
                      (ad.currency as Currency) || accountCurrency,
                      displayCurrency
                    )}
                  </p>
                ) : (
                  <p
                    className="text-lg font-bold text-gray-400"
                    title="لم يتم إعداد تتبع الشراء في الحساب"
                  >
                    —
                  </p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">المبيعات</p>
                {ad.hasConversionData && ad.purchases !== null ? (
                  <p className="text-lg font-bold text-gray-900">
                    {Math.round(ad.purchases).toLocaleString("en-US")}
                  </p>
                ) : (
                  <p
                    className="text-lg font-bold text-gray-400"
                    title="لم يتم إعداد تتبع الشراء في الحساب"
                  >
                    —
                  </p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">CTR</p>
                <p className="text-lg font-bold text-gray-900">
                  {ad.ctr.toFixed(2)}%
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">CPC</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatAndConvert(ad.cpc, (ad.currency as Currency) || accountCurrency, displayCurrency)}
                </p>
              </div>
            </div>
          </div>

          {/* Facebook preview link — META_AD only per ADR-013 (previewLink
              lives in META_AD's type_data, not at common level). */}
          {previewLink && (
            <div className="border-t border-gray-100 pt-4">
              <a
                href={previewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 transition"
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 5.013 3.693 9.153 8.505 9.876V14.65H8.031v-2.629h2.474v-1.749c0-2.896 1.411-4.167 3.818-4.167 1.153 0 1.762.085 2.051.124v2.294h-1.642c-1.022 0-1.379.969-1.379 2.061v1.437h2.995l-.406 2.629h-2.588v7.247C18.235 21.236 22 17.062 22 12c0-5.523-4.477-10-10-10z" />
                </svg>
                افتح الإعلان في فيسبوك
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =================================================================
// PMaxAssetGroupModalContent — Stage 5 UX redesign (ADR-013 follow-up)
// =================================================================
//
// Tabbed modal for PMAX_ASSET_GROUP rows. Reached via the early-branch
// dispatch at the top of AdDetailModal (above). Wider shell (max-w-4xl)
// than the M5/M6 modal since PMax surfaces more content per row —
// asset_groups commonly contain 40+ assets across multiple types after
// the REMOVED-link filter.
//
// Tabs auto-hide when their count is 0. Default active tab is the first
// non-empty one. Image clicks open an in-modal lightbox overlay.
// YouTube videos play in-modal via iframe embed (no leave-to-YouTube).

type PMaxAssetGroupAd = Extract<
  UnifiedAd,
  { ad_type: "PMAX_ASSET_GROUP" }
>;

type PMaxAsset = PMaxAssetGroupAd["type_data"]["assets"][number];

type PMaxAssetTabKey =
  | "images"
  | "videos"
  | "headlines"
  | "descriptions"
  | "extras";

interface PMaxAssetGroupModalContentProps {
  ad: PMaxAssetGroupAd;
  accountCurrency: Currency;
  displayCurrency: Currency;
  onClose: () => void;
}

const PMAX_AD_STRENGTH_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  EXCELLENT: { label: "ممتاز", className: "bg-green-100 text-green-800" },
  GOOD: { label: "جيد", className: "bg-blue-100 text-blue-800" },
  AVERAGE: { label: "متوسط", className: "bg-amber-100 text-amber-800" },
  POOR: { label: "ضعيف", className: "bg-red-100 text-red-800" },
  NO_ADS: {
    label: "لا توجد إعلانات",
    className: "bg-gray-100 text-gray-700",
  },
  PENDING: { label: "قيد المراجعة", className: "bg-gray-100 text-gray-600" },
  UNSPECIFIED: { label: "غير محدد", className: "bg-gray-100 text-gray-600" },
  UNKNOWN: { label: "غير معروف", className: "bg-gray-100 text-gray-600" },
};

// UI-friendly groupings for image assets in the modal. Keys are Google
// fieldType values; values are Arabic sub-section headers. Field types
// not in this map fall back to "صور أخرى" (other images).
const IMAGE_GROUP_LABEL_AR: Record<string, string> = {
  MARKETING_IMAGE: "صور أفقية",
  SQUARE_MARKETING_IMAGE: "صور مربعة",
  PORTRAIT_MARKETING_IMAGE: "صور عمودية",
  TALL_PORTRAIT_MARKETING_IMAGE: "صور عمودية طويلة",
  LOGO: "شعارات",
  LANDSCAPE_LOGO: "شعارات أفقية",
};

function groupImagesByFieldType(
  images: ReadonlyArray<PMaxAsset>
): Array<{ label: string; items: PMaxAsset[] }> {
  const byType = new Map<string, PMaxAsset[]>();
  for (const asset of images) {
    const key = asset.fieldType;
    const list = byType.get(key) ?? [];
    list.push(asset);
    byType.set(key, list);
  }
  return Array.from(byType.entries()).map(([fieldType, items]) => ({
    label: IMAGE_GROUP_LABEL_AR[fieldType] ?? "صور أخرى",
    items,
  }));
}

function PMaxAssetGroupModalContent({
  ad,
  accountCurrency,
  displayCurrency,
  onClose,
}: PMaxAssetGroupModalContentProps) {
  const assets = ad.type_data.assets;

  // Partition assets per tab. Headlines tab covers HEADLINE only;
  // LONG_HEADLINE goes to "extras" alongside BUSINESS_NAME + CTA so the
  // primary headlines tab stays focused on the short top-of-funnel copy.
  const images = assets.filter(
    (a) => a.assetType === "IMAGE" && !!a.imageUrl
  );
  const videos = assets.filter(
    (a) => a.assetType === "YOUTUBE_VIDEO" && !!a.youtubeVideoId
  );
  const headlines = assets.filter(
    (a) => a.fieldType === "HEADLINE" && !!a.text
  );
  const descriptions = assets.filter(
    (a) => a.fieldType === "DESCRIPTION" && !!a.text
  );
  const longHeadlines = assets.filter(
    (a) => a.fieldType === "LONG_HEADLINE" && !!a.text
  );
  const businessNames = assets.filter(
    (a) => a.fieldType === "BUSINESS_NAME" && !!a.text
  );
  const ctas = assets.filter(
    (a) =>
      (a.fieldType === "CALL_TO_ACTION_SELECTION" ||
        a.fieldType === "CALL_TO_ACTION") &&
      !!a.text
  );
  const extrasCount = longHeadlines.length + businessNames.length + ctas.length;

  // Tab list — declared in display order, filtered to non-empty.
  const TAB_DEFS: Array<{
    key: PMaxAssetTabKey;
    label: string;
    icon: string;
    count: number;
  }> = [
    { key: "images", label: "الصور", icon: "📸", count: images.length },
    { key: "videos", label: "الفيديوهات", icon: "🎬", count: videos.length },
    {
      key: "headlines",
      label: "العناوين",
      icon: "📝",
      count: headlines.length,
    },
    {
      key: "descriptions",
      label: "الأوصاف",
      icon: "📄",
      count: descriptions.length,
    },
    {
      key: "extras",
      label: "معلومات إضافية",
      icon: "🏢",
      count: extrasCount,
    },
  ];
  const availableTabs = TAB_DEFS.filter((t) => t.count > 0);

  // Default to the first non-empty tab. If the asset_group is somehow
  // empty (shouldn't happen for live PMax campaigns but possible with
  // brand-new accounts), fall back to "images" — the empty-state copy
  // will explain the gap.
  const [activeTab, setActiveTab] = useState<PMaxAssetTabKey>(
    availableTabs[0]?.key ?? "images"
  );

  // Lightbox state — the URL of the image currently being viewed full-
  // screen, plus its position within the flat image array for prev/next.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  const nextLightbox = () => {
    if (lightboxIndex === null || images.length === 0) return;
    setLightboxIndex((lightboxIndex + 1) % images.length);
  };
  const prevLightbox = () => {
    if (lightboxIndex === null || images.length === 0) return;
    setLightboxIndex(
      (lightboxIndex - 1 + images.length) % images.length
    );
  };

  const strengthCfg =
    PMAX_AD_STRENGTH_CONFIG[ad.type_data.adStrength] ??
    PMAX_AD_STRENGTH_CONFIG.UNKNOWN;

  // Currency conversion convenience.
  const currency = (ad.currency as Currency) || accountCurrency;
  const fmtSpend = (n: number) =>
    formatAndConvert(n, currency, displayCurrency);
  const fmtCount = (n: number) =>
    Math.round(n).toLocaleString("en-US");

  const purchaseAvailable = ad.hasConversionData && ad.purchases !== null;
  const revenueAvailable = ad.hasConversionData && ad.revenue !== null;
  const roasAvailable = ad.hasConversionData && ad.roas !== null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded text-[10px] font-semibold whitespace-nowrap">
              Performance Max
            </span>
            <h3
              className="font-bold text-gray-900 text-lg truncate"
              title={ad.name}
            >
              {ad.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Hero section — asset group context + metrics */}
        <div className="p-4 sm:p-6 space-y-4 border-b border-gray-100">
          <div className="flex items-center flex-wrap gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-semibold ${strengthCfg.className}`}
            >
              {strengthCfg.label}
            </span>
            <span className="text-xs text-gray-500">
              الحالة: <span className="font-medium text-gray-700">{ad.type_data.primaryStatus}</span>
            </span>
            {ad.campaignName && (
              <span className="text-xs text-gray-500 truncate">
                · {ad.campaignName}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">ROAS</p>
              {roasAvailable ? (
                <p
                  className={`text-base font-bold ${
                    ad.roas! >= 3
                      ? "text-green-600"
                      : ad.roas! >= 1
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  {ad.roas!.toFixed(2)}x
                </p>
              ) : (
                <p
                  className="text-base font-bold text-gray-400"
                  title="لم يتم إعداد تتبع الشراء في الحساب"
                >
                  —
                </p>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">الإنفاق</p>
              <p className="text-base font-bold text-gray-900">
                {fmtSpend(ad.spend)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">الإيرادات</p>
              {revenueAvailable ? (
                <p className="text-base font-bold text-green-700">
                  {fmtSpend(ad.revenue!)}
                </p>
              ) : (
                <p
                  className="text-base font-bold text-gray-400"
                  title="لم يتم إعداد تتبع الشراء في الحساب"
                >
                  —
                </p>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">المبيعات</p>
              {purchaseAvailable ? (
                <p className="text-base font-bold text-gray-900">
                  {fmtCount(ad.purchases!)}
                </p>
              ) : (
                <p
                  className="text-base font-bold text-gray-400"
                  title="لم يتم إعداد تتبع الشراء في الحساب"
                >
                  —
                </p>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">الظهور</p>
              <p className="text-base font-bold text-gray-900">
                {fmtCount(ad.impressions)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">CTR</p>
              <p className="text-base font-bold text-gray-900">
                {ad.ctr.toFixed(2)}%
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        {availableTabs.length > 0 ? (
          <>
            <div className="px-4 sm:px-6 pt-3 border-b border-gray-100 overflow-x-auto">
              <div className="flex gap-1 flex-nowrap whitespace-nowrap">
                {availableTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${
                      activeTab === tab.key
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <span aria-hidden>{tab.icon}</span>
                    <span>{tab.label}</span>
                    <span className="text-xs opacity-75">({tab.count})</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              {activeTab === "images" && (
                <div dir="ltr" className="space-y-5">
                  {groupImagesByFieldType(images).map((group, gi) => (
                    <div key={`${group.label}-${gi}`}>
                      <p
                        dir="rtl"
                        className="text-xs font-semibold text-gray-700 mb-2"
                      >
                        {group.label}{" "}
                        <span className="text-gray-400 font-normal">
                          ({group.items.length})
                        </span>
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {group.items.map((asset) => {
                          // Find this asset's flat index in `images` for lightbox.
                          const idx = images.indexOf(asset);
                          return (
                            <button
                              key={asset.imageUrl}
                              type="button"
                              onClick={() => openLightbox(idx)}
                              className="aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 hover:border-indigo-400 transition"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={asset.imageUrl}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (
                                    e.currentTarget as HTMLImageElement
                                  ).style.visibility = "hidden";
                                }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "videos" && (
                <div
                  dir="ltr"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                >
                  {videos.map((v) => (
                    <div
                      key={v.youtubeVideoId}
                      className="rounded-lg overflow-hidden bg-black"
                    >
                      <iframe
                        src={`https://www.youtube.com/embed/${v.youtubeVideoId}`}
                        title={`YouTube video ${v.youtubeVideoId}`}
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full aspect-video"
                      />
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "headlines" && (
                <ol className="space-y-2">
                  {headlines.map((h, i) => (
                    <li
                      key={`${i}-${h.text}`}
                      className="flex gap-3 items-start p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition"
                    >
                      <span className="text-xs text-gray-400 mt-0.5 min-w-[1.5rem]">
                        {i + 1}.
                      </span>
                      <span className="text-sm text-gray-800 flex-1">
                        {h.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {activeTab === "descriptions" && (
                <ol className="space-y-2">
                  {descriptions.map((d, i) => (
                    <li
                      key={`${i}-${d.text}`}
                      className="flex gap-3 items-start p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition"
                    >
                      <span className="text-xs text-gray-400 mt-0.5 min-w-[1.5rem]">
                        {i + 1}.
                      </span>
                      <span className="text-sm text-gray-700 leading-relaxed flex-1">
                        {d.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {activeTab === "extras" && (
                <div className="space-y-5">
                  {businessNames.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        اسم النشاط
                      </p>
                      <ul className="space-y-1">
                        {businessNames.map((b, i) => (
                          <li
                            key={`bn-${i}`}
                            className="text-sm text-gray-800 p-2 rounded bg-gray-50"
                          >
                            {b.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ctas.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        دعوة لإجراء
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ctas.map((c, i) => (
                          <span
                            key={`cta-${i}`}
                            className="inline-block px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold"
                          >
                            {(c.text && CTA_LABELS_AR[c.text]) || c.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {longHeadlines.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        عناوين طويلة
                      </p>
                      <ol className="space-y-2">
                        {longHeadlines.map((h, i) => (
                          <li
                            key={`lh-${i}`}
                            className="flex gap-3 items-start p-3 rounded-lg border border-gray-200"
                          >
                            <span className="text-xs text-gray-400 mt-0.5 min-w-[1.5rem]">
                              {i + 1}.
                            </span>
                            <span className="text-sm text-gray-800 flex-1">
                              {h.text}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-gray-500">
            لا توجد أصول مرفقة بهذه المجموعة بعد
          </div>
        )}
      </div>

      {/* Lightbox overlay — full-screen image viewer with prev/next */}
      {lightboxIndex !== null && images[lightboxIndex]?.imageUrl && (
        <div
          dir="ltr"
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition"
            aria-label="إغلاق"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  prevLightbox();
                }}
                className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition"
                aria-label="السابق"
              >
                <span className="text-white text-xl">‹</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  nextLightbox();
                }}
                className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition"
                aria-label="التالي"
              >
                <span className="text-white text-xl">›</span>
              </button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-white/10 rounded-full text-white text-xs">
                {lightboxIndex + 1} / {images.length}
              </div>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[lightboxIndex].imageUrl}
            alt=""
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

interface CreativesGridProps {
  ads: UnifiedAd[];
  loading: boolean;
  accountCurrency: Currency;
  displayCurrency: Currency;
  /**
   * ADR-019 (M9.1) — date range forwarded to AdDetailModal so its
   * lazy search-terms + keywords fetches use the same range as the
   * parent creatives fetch.
   */
  range?: DateRange;
  customRange?: CustomDateRange;
}

type CreativeStatusFilter = "all" | "ACTIVE" | "PAUSED";
type CreativeSortKey = "roas" | "spend" | "purchases";

const CREATIVES_PAGE_SIZE = 20;

/**
 * Per-variant render dispatcher (ADR-013 Commit 12 — FIRST VISUAL CHECKPOINT).
 *
 * PMax variants route to the dedicated card components added in Commits 10-11;
 * all other variants (including future ones not yet specifically modeled) fall
 * through to the existing inline `CreativeCard`. M5/M6 render behavior stays
 * byte-for-byte identical — the dispatcher is purely additive.
 *
 * Stage 5 UX redesign: PMAX_ASSET_GROUP is now interactive — receives
 * onClick + currency context, opens AdDetailModal via the
 * PMaxAssetGroupModalContent early branch (tabbed UI for images / videos
 * / headlines / descriptions / extras). The compact card hands off to
 * the modal for any non-summary surface.
 */
function renderAdCard(
  ad: UnifiedAd,
  sharedProps: {
    accountCurrency: Currency;
    displayCurrency: Currency;
    onClick: () => void;
    /**
     * TikTok URL batch lookup keyed by ad.id. Only set when CreativesGrid
     * is rendering for the TikTok tab; undefined elsewhere. Read only by
     * the TIKTOK_AD branch — Meta/Google/PMAX branches ignore it.
     */
    tiktokUrlsByAdId?: Record<string, TikTokCreativeUrls | null>;
    /** TikTok per-ad URL-resolve errors keyed by ad.id. */
    tiktokUrlErrors?: Record<string, string>;
    /** TikTok batch-loading flag — true while the batch resolve is in-flight. */
    tiktokUrlsLoading?: boolean;
  }
): React.ReactElement {
  switch (ad.ad_type) {
    case "PMAX_ASSET_GROUP":
      return (
        <PMaxAssetGroupCard
          ad={ad}
          accountCurrency={sharedProps.accountCurrency}
          displayCurrency={sharedProps.displayCurrency}
          onClick={sharedProps.onClick}
        />
      );
    case "TIKTOK_AD":
      // Phase 7 / ADR-020 §12c — real batch-hook values from
      // useTiktokCreativeUrlsBatch (lifted into CreativesGrid).
      // resolvedUrls=null on this ad's key means: the route returned
      // null for this ad (path C/UNKNOWN, OR fetch hasn't completed
      // yet — distinguish via urlsLoading). urlError set means the
      // route returned an error for this specific ad. The
      // TikTokCreativeCard 4-state dispatcher handles LOADING /
      // POSTER / EMBED_PLACEHOLDER / PLACEHOLDER from those inputs.
      return (
        <TikTokCreativeCard
          ad={ad}
          resolvedUrls={sharedProps.tiktokUrlsByAdId?.[ad.id] ?? null}
          urlsLoading={sharedProps.tiktokUrlsLoading ?? false}
          urlError={sharedProps.tiktokUrlErrors?.[ad.id]}
          accountCurrency={sharedProps.accountCurrency}
          displayCurrency={sharedProps.displayCurrency}
          onClick={sharedProps.onClick}
        />
      );
    case "RSA":
    case "RDA":
    case "IMAGE_AD":
    case "META_AD":
    case "UNKNOWN_GOOGLE":
    default:
      // Default catches any future variants (Phase 8 Snap, etc.) —
      // they render as CreativeCard until dedicated components are
      // added. Graceful degradation, not a TypeScript exhaustiveness gap.
      return (
        <CreativeCard
          ad={ad}
          accountCurrency={sharedProps.accountCurrency}
          displayCurrency={sharedProps.displayCurrency}
          onClick={sharedProps.onClick}
        />
      );
  }
}

function CreativesGrid({
  ads,
  loading,
  accountCurrency,
  displayCurrency,
  range,
  customRange,
}: CreativesGridProps) {
  const [statusFilter, setStatusFilter] =
    useState<CreativeStatusFilter>("all");
  const [sortBy, setSortBy] = useState<CreativeSortKey>("roas");
  const [selectedAd, setSelectedAd] = useState<UnifiedAd | null>(null);
  const [visibleCount, setVisibleCount] = useState(CREATIVES_PAGE_SIZE);

  const filteredAds = useMemo(() => {
    let result = [...ads];
    if (statusFilter !== "all") {
      result = result.filter((ad) => ad.status === statusFilter);
    }
    result.sort((a, b) => {
      const aVal = (a[sortBy] as number) ?? 0;
      const bVal = (b[sortBy] as number) ?? 0;
      return bVal - aVal;
    });
    return result;
  }, [ads, statusFilter, sortBy]);

  // Reset pagination when the filtered list identity changes (status filter,
  // sort change, or upstream ads refresh). Without this, switching from a
  // long list to a short one could leave visibleCount > filteredAds.length.
  useEffect(() => {
    setVisibleCount(CREATIVES_PAGE_SIZE);
  }, [filteredAds]);

  // ── Phase 7 / ADR-020 §12c + §ResolveConcurrency — TikTok URL batch + campaign-ROAS Map ──
  //
  // CreativesGrid is SHARED across Meta/Google/TikTok tabs. The two
  // hooks below fire on every render (Rules of Hooks — can't be
  // conditional) but are TRUE pre-fetch no-ops when no TikTok ads are
  // present: both have early returns before any fetch() call. So
  // Meta/Google CreativesGrid calls hit synthetic empty-state paths
  // (zero network, zero side effects) — behavior bit-identical to
  // pre-2f for those tabs.
  //
  // Verified empty-input short-circuits:
  //   useTiktokCreativeUrlsBatch (use-tiktok-creative-urls.ts:214-221)
  //     `if (!enabled || !accountId || ads.length === 0) return;`
  //   useProviderInsights (use-provider-insights.ts:137-138 + :240
  //   + :254-262) — useEffect skip + doFetch early-return + synthetic
  //   noConnection return when accountIds is empty.
  //
  // ⚠️ ORDERING: this block MUST stay AFTER `filteredAds` + the
  // visibleCount-reset useEffect (the tiktokAds memo depends on both).
  // Moving it earlier reintroduces the TDZ error caught during the 2f
  // → §ResolveConcurrency reorder.
  //
  // §ResolveConcurrency slice-derive: tiktokAds is derived from the
  // VISIBLE SLICE of filteredAds, not raw `ads`. This cuts the typical
  // batch ~10× (20 visible default vs ~194 lifetime total) and combines
  // with the route's per-chunk concurrency cap = 4 to keep first-page
  // resolve well under TikTok's 600 req/min cap. "Load more" grows
  // visibleCount → tiktokAds slice grows → adsKey changes in the hook
  // → new POST for the bigger slice. REPLACE semantics on each fetch
  // (the previously-resolved URLs re-fetch) — accepted per ADR;
  // ~1h URL TTL means re-fetch is harmless for freshness, the
  // concurrency cap bounds the cost, and abort handling cleanly
  // cancels mid-resolve when pagination/filter changes happen.
  const tiktokAds = useMemo(
    () =>
      filteredAds
        .slice(0, visibleCount)
        .filter((a): a is UnifiedAdTiktok => a.ad_type === "TIKTOK_AD"),
    [filteredAds, visibleCount]
  );
  // The adapter's getAds normalizer + useProviderAds stamping guarantee
  // accountId is set on every ad row; first ad's accountId is the
  // implicit primary for the single-account v1 constraint (the multi-
  // account amber warning already lives at the tab level). On the
  // TikTok tab specifically, ALL ads are TikTok — so the slice always
  // contains TikTok ads with accountId stamped, no edge case.
  const tiktokAccountId = tiktokAds[0]?.accountId ?? "";
  const hasTiktokAds = tiktokAds.length > 0 && !!tiktokAccountId;

  const {
    urls: tiktokUrlsByAdId,
    errors: tiktokUrlErrors,
    loading: tiktokUrlsLoading,
  } = useTiktokCreativeUrlsBatch({
    accountId: tiktokAccountId,
    ads: tiktokAds,
    enabled: hasTiktokAds,
  });

  // Campaign-level insights drive the modal's "ROAS — على مستوى الحملة"
  // cell (per §2b: per-ad ROAS would mix app/web pixel attribution
  // surfaces, so we surface the parent-campaign ROAS instead).
  const tiktokCampaigns = useProviderInsights({
    provider: "tiktok",
    accountIds: hasTiktokAds ? [tiktokAccountId] : [],
    range,
    customRange,
    level: "campaign",
  });

  const tiktokCampaignRoasById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const insight of tiktokCampaigns.insights) {
      if (insight.campaignId) m.set(insight.campaignId, insight.roas);
    }
    return m;
  }, [tiktokCampaigns.insights]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-gray-50 rounded-lg aspect-square animate-pulse"
          />
        ))}
      </div>
    );
  }

  const filterOptions: Array<{ value: CreativeStatusFilter; label: string }> =
    [
      { value: "all", label: "الكل" },
      { value: "ACTIVE", label: "نشط" },
      { value: "PAUSED", label: "موقوف" },
    ];

  return (
    <>
      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-1 flex-wrap">
          {filterOptions.map((opt) => {
            const count =
              opt.value === "all"
                ? ads.length
                : ads.filter((a) => a.status === opt.value).length;
            return (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 text-xs rounded-lg transition ${
                  statusFilter === opt.value
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {opt.label}
                {count > 0 && (
                  <span className="mr-1.5 opacity-75">({count})</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="sm:mr-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as CreativeSortKey)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="roas">الأعلى ROAS</option>
            <option value="spend">الأعلى إنفاق</option>
            <option value="purchases">الأعلى مبيعات</option>
          </select>
        </div>
      </div>

      {filteredAds.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">
            {ads.length === 0
              ? "لا توجد إعلانات في هذه الفترة"
              : "لا توجد إعلانات مطابقة"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filteredAds.slice(0, visibleCount).map((ad) => (
            <div key={ad.id}>
              {renderAdCard(ad, {
                accountCurrency,
                displayCurrency,
                onClick: () => setSelectedAd(ad),
                tiktokUrlsByAdId,
                tiktokUrlErrors,
                tiktokUrlsLoading,
              })}
            </div>
          ))}
          {visibleCount < filteredAds.length && (
            <div className="col-span-full flex flex-wrap justify-center gap-3 mt-6">
              <button
                onClick={() =>
                  setVisibleCount((c) => c + CREATIVES_PAGE_SIZE)
                }
                className="px-6 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700 transition"
              >
                تحميل المزيد ({filteredAds.length - visibleCount} متبقي)
              </button>
              <button
                onClick={() => setVisibleCount(filteredAds.length)}
                className="px-6 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-500 transition"
              >
                تحميل الكل
              </button>
            </div>
          )}
        </div>
      )}

      {selectedAd && (
        <AdDetailModal
          ad={selectedAd}
          accountCurrency={accountCurrency}
          displayCurrency={displayCurrency}
          onClose={() => setSelectedAd(null)}
          // M7 / ADR-015 §Decision 7 — count of ads sharing the same
          // ad_group as the selected ad. Used in the keywords section
          // header to show "shared with N ads" context. Computed at the
          // call site (CreativesGrid has the full ads list).
          adGroupAdCount={
            selectedAd.adsetId
              ? ads.filter((a) => a.adsetId === selectedAd.adsetId).length
              : 0
          }
          // ADR-019 (M9.1) — forward the active date range so the modal's
          // lazy search-terms + keywords fetches align with the cards.
          range={range}
          customRange={customRange}
          // Phase 7 / ADR-020 §2b — campaign-level ROAS for the TikTok
          // branch. Wired in 2f: lookup via selectedAd.campaignId in
          // tiktokCampaignRoasById. For non-TikTok selectedAd, the
          // ternary's null branch fires → AdDetailModal ignores the
          // prop for Meta/Google variants (passed through to the
          // TikTokAdDetailModal early-return only). Modal's "غير متوفر"
          // tooltip renders when the lookup misses (e.g. campaign with
          // no spend in window → no insight row → no Map entry).
          campaignRoas={
            selectedAd.ad_type === "TIKTOK_AD"
              ? tiktokCampaignRoasById.get(selectedAd.campaignId ?? "") ??
                null
              : null
          }
        />
      )}
    </>
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
  connections,
  workspaces,
  activeWorkspaceId,
}: ReportsClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Derived from the workspace-scoped connections. Keeping the existing
  // `connectedPlatforms` shape used throughout the JSX avoids touching
  // every usage site — the underlying data still flows from the server.
  const connectedPlatforms = useMemo(
    () => Array.from(new Set(connections.map((c) => c.platform))),
    [connections]
  );

  // Meta is single-account: the active workspace has at most one Meta
  // connection. We pass its account_id to all Meta data fetches so the
  // API picks exactly that connection — important after Phase 4.3 because
  // the user may have Meta connections in multiple workspaces. Wired into
  // the 6 Meta call sites in the next commit.
  const metaAccountId = useMemo(
    () =>
      connections.find((c) => c.platform === "meta")?.account_id ?? undefined,
    [connections]
  );

  // Google is multi-account: the active workspace can have N active Google
  // connections. useProviderInsights fans out one API call per account in
  // parallel; empty array → skip. Mirrors DashboardClient pattern.
  const googleAccountIds = useMemo(
    () =>
      connections
        .filter((c) => c.platform === "google")
        .map((c) => c.account_id),
    [connections]
  );

  // Account ID → name lookup for the Google accounts breakdown table.
  // Names come from connections (populated by sync-accounts), insights
  // payloads don't carry the name. Falls back to "حساب <id>" in the UI
  // for accounts where sync hasn't populated the name yet (e.g. the
  // suspended accounts that returned skipped in the May 17 sync).
  const googleAccountNames = useMemo(() => {
    return new Map(
      connections
        .filter((c) => c.platform === "google")
        .map((c) => [c.account_id, c.account_name])
    );
  }, [connections]);

  // Phase 7 / ADR-020 — TikTok account list. Multi-account at the
  // data-fetch level (useProviderAds + useProviderInsights both fan
  // out per account), but URL-resolve is single-account in v1 (the
  // batch route + the on-mount modal hook each take ONE account_id).
  // IMAA is single-account; workspaces with multiple TikTok accounts
  // get an amber warning banner in the tab content.
  const tiktokAccountIds = useMemo(
    () =>
      connections
        .filter((c) => c.platform === "tiktok")
        .map((c) => c.account_id),
    [connections]
  );

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

  // Phase 4.8 M4 Commit 2 — Google campaigns filter/sort state
  const [googleSearchQuery, setGoogleSearchQuery] = useState("");
  const [googleStatusFilter, setGoogleStatusFilter] = useState<
    "all" | "ACTIVE" | "PAUSED"
  >("all");
  const [googleSortBy, setGoogleSortBy] = useState<SortableColumn | null>(
    "spend"
  );
  const [googleSortDir, setGoogleSortDir] = useState<"asc" | "desc">("desc");

  // Reports tab (campaigns table vs creatives grid), persisted to localStorage
  const [activeTab, setActiveTab] = useState<"campaigns" | "creatives">(
    "campaigns"
  );

  // Phase 4.8 M5 Commit 1B — separate sub-tab state for Google to allow
  // independent toggling per platform.
  const [googleActiveTab, setGoogleActiveTab] = useState<
    "campaigns" | "creatives"
  >("campaigns");

  // Outer platform tab (Phase 4.8 M1, widened Phase 7 / ADR-020).
  // Defaults to Meta; auto-switch cascade picks the first available
  // tab when the default isn't connected. In-memory only — NOT
  // persisted to localStorage (intentional: the active platform
  // should follow the workspace's connections, not stale per-tab
  // muscle memory from another workspace).
  const [platformTab, setPlatformTab] = useState<
    "meta" | "google" | "tiktok"
  >("meta");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("arabiadash:reportsTab");
    if (saved === "campaigns" || saved === "creatives") {
      setActiveTab(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("arabiadash:reportsTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("arabiadash:googleReportsTab");
    if (saved === "campaigns" || saved === "creatives") {
      setGoogleActiveTab(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("arabiadash:googleReportsTab", googleActiveTab);
  }, [googleActiveTab]);

  useEffect(() => {
    // Cascade: prefer Meta → Google → TikTok. Fires only when the
    // default (Meta) isn't available; doesn't override a user's
    // explicit tab click.
    if (
      !metaAccountId &&
      googleAccountIds.length === 0 &&
      tiktokAccountIds.length > 0
    ) {
      setPlatformTab("tiktok");
    } else if (!metaAccountId && googleAccountIds.length > 0) {
      setPlatformTab("google");
    }
  }, [
    metaAccountId,
    googleAccountIds.length,
    tiktokAccountIds.length,
  ]);

  // Ads (for the Creatives tab + tab badge count). Same dateRange as the rest.
  const {
    ads,
    loading: adsLoading,
    source: adsSource,
    fetchedAt: adsFetchedAt,
    revalidating: adsRevalidating,
    rateLimited: adsRateLimited,
    refresh: refreshAds,
  } = useAds({
    range: dateRange,
    accountId: metaAccountId,
    skip: !metaAccountId,
  });

  // Manual refresh button has a 30s cooldown to avoid hammering Meta.
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);
  // Start with 0 to ensure SSR/client match. Real value set after mount.
  const [now, setNow] = useState<number>(0);

  useEffect(() => {
    // 1Hz tick so the relative-time badge updates without a manual refresh.
    setNow(Date.now()); // Initial value after mount
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Measure the chart wrapper height so we can pass an explicit pixel value
  // to ResponsiveContainer. Avoids Recharts' `width(-1)/height(-1)` warning
  // that fires on the first render before its ResizeObserver settles.
  const [chartRef, chartHeight] = useElementHeight<HTMLDivElement>();

  const REFRESH_COOLDOWN_MS = 30_000;
  const refreshCooldownRemaining = Math.max(
    0,
    Math.ceil((lastRefreshAt + REFRESH_COOLDOWN_MS - now) / 1000)
  );
  const refreshDisabled =
    adsLoading || adsRevalidating || refreshCooldownRemaining > 0;

  const handleRefreshAds = async () => {
    if (refreshDisabled) return;
    setLastRefreshAt(Date.now());
    await refreshAds();
  };

  // Show ALL ads in the Creatives tab — the in-tab status filter (الكل / نشط /
  // موقوف) controls visibility from there. Filtering by spend > 0 here was
  // hiding paused/archived ads (e.g. 194 → 15 in lifetime range).
  const activeAds = useMemo(() => ads, [ads]);

  // Fetch account currency
  //
  // When metaAccountId is undefined (no Meta in this workspace), skip the
  // fetch. The previous accountCurrency value persists — same trade-off
  // as DashboardClient: useInsights/useAds skip means no Meta numbers
  // render, so stale source currency is inert.
  //
  // Important: this depends on the Meta data hooks (useInsights, useAds)
  // skipping when metaAccountId is undefined. If those guards are
  // removed, stale currency could surface in conversions.
  useEffect(() => {
    if (!metaAccountId) return;
    fetch(`/api/ads/account?provider=meta&account_id=${metaAccountId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const c = data?.currency;
        if (c === "USD" || c === "SAR") setAccountCurrency(c);
      })
      .catch(() => {});
  }, [metaAccountId]);

  // Fetch campaigns (for status JOIN)
  useEffect(() => {
    if (!metaAccountId) return;
    fetch(`/api/ads/campaigns?provider=meta&account_id=${metaAccountId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.data && Array.isArray(data.data)) {
          setCampaigns(data.data);
        }
      })
      .catch((err) => console.error("[reports/campaigns] Error:", err));
  }, [metaAccountId]);

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
    accountId: metaAccountId,
    skip: !metaAccountId,
  });

  // Google KPIs — account-level (Google doesn't have a single-API campaign
  // equivalent that maps cleanly; deferred to Phase 4.8 tabs work).
  // account-level aggregation is the right shape for cross-platform totals.
  const googleInsights = useProviderInsights({
    provider: "google",
    accountIds: googleAccountIds,
    ...dateRangeValueToOptions(dateRange),
    level: "account",
  });

  // Google campaigns — per-campaign breakdown for the campaigns table (Phase 4.8 M4)
  const googleCampaigns = useProviderInsights({
    provider: "google",
    accountIds: googleAccountIds,
    ...dateRangeValueToOptions(dateRange),
    level: "campaign",
  });

  // Phase 4.8 M5 Commit 1B — multi-account Google ads fanout
  const {
    ads: googleAds,
    loading: googleAdsLoading,
    error: googleAdsError,
    noConnection: googleAdsNoConnection,
    refresh: refreshGoogleAds,
  } = useProviderAds({
    provider: "google",
    accountIds: googleAccountIds,
    ...dateRangeValueToOptions(dateRange),
  });

  const visibleGoogleAdsCount = googleAds.length;

  // Phase 7 / ADR-020 — TikTok data fanout (mirrors Google's 4-hook
  // pattern). All hooks short-circuit cleanly via the synthetic
  // noConnection state when tiktokAccountIds is empty, so they're
  // cheap when no TikTok is connected.
  const tiktokInsights = useProviderInsights({
    provider: "tiktok",
    accountIds: tiktokAccountIds,
    ...dateRangeValueToOptions(dateRange),
    level: "account",
  });

  // Note: campaign-level TikTok insights deliberately deferred to 2f
  // (the campaign-ROAS Map lookup for the modal). 2e doesn't render
  // a campaigns table for TikTok, so no consumer exists for them yet.

  const {
    ads: tiktokAds,
    loading: tiktokAdsLoading,
    error: tiktokAdsError,
    noConnection: tiktokAdsNoConnection,
    refresh: refreshTiktokAds,
  } = useProviderAds({
    provider: "tiktok",
    accountIds: tiktokAccountIds,
    ...dateRangeValueToOptions(dateRange),
  });

  // Per-provider cooldown for TikTok — Meta's `lastRefreshAt` rationale
  // ("avoid hammering Meta") doesn't apply to TikTok's separate rate
  // limit. Independent state per provider; no cross-platform spillover
  // when the user clicks Meta's button + then wants to refresh TikTok.
  // Reuses REFRESH_COOLDOWN_MS + the existing `now` clock tick — no
  // duplicate effect / interval.
  //
  // Note: useProviderAds doesn't expose a `revalidating` flag (unlike
  // useAds for Meta), so refreshDisabledTiktok gates only on the
  // hook's `loading` + the per-provider cooldown. The Meta-style
  // timestamp + "stale revalidating" + "rate-limited" banners are
  // deferred — they'd require extending useProviderAds to expose
  // those fields, which would touch the Google adapter path too and
  // is out of scope for this commit.
  const [lastRefreshAtTiktok, setLastRefreshAtTiktok] = useState<number>(0);
  const refreshCooldownRemainingTiktok = Math.max(
    0,
    Math.ceil((lastRefreshAtTiktok + REFRESH_COOLDOWN_MS - now) / 1000)
  );
  const refreshDisabledTiktok =
    tiktokAdsLoading || refreshCooldownRemainingTiktok > 0;

  const handleRefreshTiktokAds = async () => {
    if (refreshDisabledTiktok) return;
    setLastRefreshAtTiktok(Date.now());
    await refreshTiktokAds();
  };

  // Phase 4.8 M4 Commit 2 — filter, status filter, sort pipeline
  const processedGoogleCampaigns = useMemo(() => {
    let result = googleCampaigns.insights.filter((r) => r.spend > 0);

    if (googleSearchQuery.trim()) {
      const q = googleSearchQuery.toLowerCase().trim();
      result = result.filter((r) =>
        (r.campaignName ?? "").toLowerCase().includes(q)
      );
    }

    if (googleStatusFilter !== "all") {
      result = result.filter((r) => r.status === googleStatusFilter);
    }

    if (googleSortBy) {
      result = [...result].sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;
        if (googleSortBy === "status") {
          aVal = a.status ?? "";
          bVal = b.status ?? "";
        } else if (googleSortBy === "campaignName") {
          aVal = a.campaignName ?? "";
          bVal = b.campaignName ?? "";
        } else {
          aVal =
            ((a as unknown as Record<string, unknown>)[googleSortBy] as number) ??
            0;
          bVal =
            ((b as unknown as Record<string, unknown>)[googleSortBy] as number) ??
            0;
        }
        if (typeof aVal === "string" && typeof bVal === "string") {
          return googleSortDir === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        const numA = typeof aVal === "number" ? aVal : 0;
        const numB = typeof bVal === "number" ? bVal : 0;
        return googleSortDir === "asc" ? numA - numB : numB - numA;
      });
    }

    return result;
  }, [
    googleCampaigns.insights,
    googleSearchQuery,
    googleStatusFilter,
    googleSortBy,
    googleSortDir,
  ]);

  const handleGoogleSort = (column: SortableColumn) => {
    if (googleSortBy === column) {
      setGoogleSortDir(googleSortDir === "asc" ? "desc" : "asc");
    } else {
      setGoogleSortBy(column);
      setGoogleSortDir("desc");
    }
  };

  const googleHasActiveFilters =
    googleSearchQuery !== "" || googleStatusFilter !== "all";

  // Insights for chart (account level + daily breakdown when applicable,
  // uses chartDateRange so lifetime falls back to 90d)
  const { insights: chartInsights, loading: chartLoading } = useInsights({
    ...dateRangeValueToOptions(chartDateRange),
    level: "account",
    timeIncrement: chartShouldShowDaily ? 1 : undefined,
    accountId: metaAccountId,
    skip: !metaAccountId,
  });

  const googleChartInsights = useProviderInsights({
    provider: "google",
    accountIds: googleAccountIds,
    ...dateRangeValueToOptions(chartDateRange),
    level: "account",
    timeIncrement: chartShouldShowDaily ? 1 : undefined,
  });

  // Phase 7 / ADR-020 — TikTok chart insights (separate hook because
  // the chart uses chartDateRange + timeIncrement, both distinct from
  // the table-level dateRange).
  const tiktokChartInsights = useProviderInsights({
    provider: "tiktok",
    accountIds: tiktokAccountIds,
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

  // Fetch previous period insights for KPI deltas. When previousPeriod is
  // null we still need a valid options object; previousSummary below guards
  // on previousPeriod and returns null, so deltas are hidden in lifetime
  // mode. skip also bypasses the fetch when the workspace has no Meta
  // (Phase 4.3) — accountCurrency stays stale but conversions don't run.
  const { insights: previousInsights } = useInsights(
    previousPeriod
      ? {
          customRange: previousPeriod,
          level: "campaign",
          accountId: metaAccountId,
          skip: !metaAccountId,
        }
      : {
          range: "30d",
          level: "campaign",
          accountId: metaAccountId,
          skip: !metaAccountId,
        }
  );

  const googlePreviousInsights = useProviderInsights(
    previousPeriod
      ? {
          provider: "google",
          accountIds: googleAccountIds,
          customRange: previousPeriod,
          level: "account",
        }
      : {
          provider: "google",
          accountIds: googleAccountIds,
          range: "30d",
          level: "account",
        }
  );

  const aggregated = useMemo(() => {
    const allInsights = [...insights, ...googleInsights.insights];
    if (allInsights.length === 0) return null;

    const supportedRows = allInsights.filter((ins) => {
      const c = ins.currency;
      return !c || c === "USD" || c === "SAR";
    });
    const unsupportedRows = allInsights.filter((ins) => {
      const c = ins.currency;
      return c && c !== "USD" && c !== "SAR";
    });

    const totals = supportedRows.reduce(
      (acc, ins) => {
        const src = (ins.currency as Currency) || "USD";
        return {
          spend: acc.spend + convertCurrency(ins.spend, src, currency),
          revenue: acc.revenue + convertCurrency(ins.revenue ?? 0, src, currency),
          purchases: acc.purchases + (ins.purchases ?? 0),
          impressions: acc.impressions + ins.impressions,
          clicks: acc.clicks + ins.clicks,
        };
      },
      { spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0 }
    );

    const unsupportedByCurrency = unsupportedRows.reduce(
      (acc, ins) => {
        const c = ins.currency as string;
        if (!acc[c]) acc[c] = { spend: 0, revenue: 0, purchases: 0 };
        acc[c].spend += ins.spend;
        acc[c].revenue += ins.revenue ?? 0;
        acc[c].purchases += ins.purchases ?? 0;
        return acc;
      },
      {} as Record<string, { spend: number; revenue: number; purchases: number }>
    );

    const unsupportedTotals = Object.entries(unsupportedByCurrency).map(
      ([cur, vals]) => ({ currency: cur, ...vals })
    );

    return {
      campaignsCount: insights.length, // preserve Reports-specific count
      spend: totals.spend,
      revenue: totals.revenue,
      profit: totals.revenue - totals.spend,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      purchases: totals.purchases,
      aov: totals.purchases > 0 ? totals.revenue / totals.purchases : 0,
      impressions: totals.impressions,
      clicks: totals.clicks,
      ctr:
        totals.impressions > 0
          ? (totals.clicks / totals.impressions) * 100
          : 0,
      cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
      cpm:
        totals.impressions > 0
          ? (totals.spend / totals.impressions) * 1000
          : 0,
      isMixed: unsupportedTotals.length > 0,
      unsupportedTotals,
    };
  }, [insights, googleInsights.insights, currency]);

  // Previous period totals (for KPI deltas). Null when previousPeriod is null
  // (lifetime) — KPI cards will hide their delta indicators. Same row-level
  // currency policy as `aggregated`: only USD/SAR rows feed the converted
  // total. Unsupported currencies silently dropped here — deltas across
  // mismatched currency bases would be meaningless. Phase 4.9 fixes via FX.
  const previousSummary = useMemo(() => {
    if (!previousPeriod) return null;
    const allPrevious = [
      ...previousInsights,
      ...googlePreviousInsights.insights,
    ];
    const supportedRows = allPrevious.filter((ins) => {
      const c = ins.currency;
      return !c || c === "USD" || c === "SAR";
    });
    const totals = supportedRows.reduce(
      (acc, ins) => {
        const src = (ins.currency as Currency) || "USD";
        return {
          spend: acc.spend + convertCurrency(ins.spend, src, currency),
          revenue: acc.revenue + convertCurrency(ins.revenue ?? 0, src, currency),
          purchases: acc.purchases + (ins.purchases ?? 0),
        };
      },
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      spend: totals.spend,
      revenue: totals.revenue,
      profit: totals.revenue - totals.spend,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      purchases: totals.purchases,
      aov: totals.purchases > 0 ? totals.revenue / totals.purchases : 0,
    };
  }, [previousInsights, googlePreviousInsights.insights, previousPeriod, currency]);

  // Merge Meta + Google daily breakdowns by date. Per-row currency:
  //   - USD/SAR or missing (cached pre-C0): convert to display currency
  //   - Unsupported (AED, EGP, …): row dropped from the chart (Phase 4.9 fix)
  const displayChartData = useMemo(() => {
    type Row = { date: string; spend: number; revenue: number };
    const byDate = new Map<string, Row>();

    const addRow = (insight: UnifiedInsight) => {
      const c = insight.currency;
      const isSupported = !c || c === "USD" || c === "SAR";
      if (!isSupported) return;

      const src = (c as Currency) || "USD";
      const sp = convertCurrency(insight.spend, src, currency);
      const rv = convertCurrency(insight.revenue ?? 0, src, currency);

      const existing = byDate.get(insight.dateStart);
      if (existing) {
        existing.spend += sp;
        existing.revenue += rv;
      } else {
        byDate.set(insight.dateStart, {
          date: insight.dateStart,
          spend: sp,
          revenue: rv,
        });
      }
    };

    chartInsights.forEach(addRow);
    googleChartInsights.insights.forEach(addRow);

    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(row.date, chartDayCount)
          : row.date,
        tooltipLabel: formatChartTooltipLabel(row.date),
        displaySpend: row.spend,
        displayRevenue: row.revenue,
      }));
  }, [
    chartInsights,
    googleChartInsights.insights,
    chartShouldShowDaily,
    chartDayCount,
    currency,
  ]);

  // Meta-only KPIs (excludes Google). Drives the Meta platform tab's
  // mini KPI strip. Same supported-currency policy as `aggregated`.
  const metaAggregated = useMemo(() => {
    if (insights.length === 0) return null;
    const supportedRows = insights.filter((ins) => {
      const c = ins.currency;
      return !c || c === "USD" || c === "SAR";
    });
    const totals = supportedRows.reduce(
      (acc, ins) => {
        const src = (ins.currency as Currency) || "USD";
        return {
          spend: acc.spend + convertCurrency(ins.spend, src, currency),
          revenue: acc.revenue + convertCurrency(ins.revenue ?? 0, src, currency),
          purchases: acc.purchases + (ins.purchases ?? 0),
        };
      },
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      spend: totals.spend,
      revenue: totals.revenue,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      purchases: totals.purchases,
    };
  }, [insights, currency]);

  // Meta-only chart data — daily breakdown, same currency policy.
  const metaChartData = useMemo(() => {
    type Row = { date: string; spend: number; revenue: number };
    const byDate = new Map<string, Row>();

    chartInsights.forEach((insight) => {
      const c = insight.currency;
      const isSupported = !c || c === "USD" || c === "SAR";
      if (!isSupported) return;

      const src = (c as Currency) || "USD";
      const sp = convertCurrency(insight.spend, src, currency);
      const rv = convertCurrency(insight.revenue ?? 0, src, currency);

      const existing = byDate.get(insight.dateStart);
      if (existing) {
        existing.spend += sp;
        existing.revenue += rv;
      } else {
        byDate.set(insight.dateStart, {
          date: insight.dateStart,
          spend: sp,
          revenue: rv,
        });
      }
    });

    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(row.date, chartDayCount)
          : row.date,
        tooltipLabel: formatChartTooltipLabel(row.date),
        displaySpend: row.spend,
        displayRevenue: row.revenue,
      }));
  }, [chartInsights, chartShouldShowDaily, chartDayCount, currency]);

  // Google-only KPIs. "purchases" here is semantically Google's
  // conversions metric (form fills, calls, page views, etc.) — labeled
  // "تحويلات" in the UI to disambiguate from Meta e-commerce purchases.
  // See #15 for the full semantic discussion.
  const googleAggregated = useMemo(() => {
    if (googleInsights.insights.length === 0) return null;
    const supportedRows = googleInsights.insights.filter((ins) => {
      const c = ins.currency;
      return !c || c === "USD" || c === "SAR";
    });
    const totals = supportedRows.reduce(
      (acc, ins) => {
        const src = (ins.currency as Currency) || "USD";
        return {
          spend: acc.spend + convertCurrency(ins.spend, src, currency),
          revenue: acc.revenue + convertCurrency(ins.revenue ?? 0, src, currency),
          purchases: acc.purchases + (ins.purchases ?? 0),
        };
      },
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      spend: totals.spend,
      revenue: totals.revenue,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      conversions: totals.purchases,
    };
  }, [googleInsights.insights, currency]);

  // Google-only chart data — daily breakdown, same currency policy.
  const googleChartData = useMemo(() => {
    type Row = { date: string; spend: number; revenue: number };
    const byDate = new Map<string, Row>();

    googleChartInsights.insights.forEach((insight) => {
      const c = insight.currency;
      const isSupported = !c || c === "USD" || c === "SAR";
      if (!isSupported) return;

      const src = (c as Currency) || "USD";
      const sp = convertCurrency(insight.spend, src, currency);
      const rv = convertCurrency(insight.revenue ?? 0, src, currency);

      const existing = byDate.get(insight.dateStart);
      if (existing) {
        existing.spend += sp;
        existing.revenue += rv;
      } else {
        byDate.set(insight.dateStart, {
          date: insight.dateStart,
          spend: sp,
          revenue: rv,
        });
      }
    });

    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(row.date, chartDayCount)
          : row.date,
        tooltipLabel: formatChartTooltipLabel(row.date),
        displaySpend: row.spend,
        displayRevenue: row.revenue,
      }));
  }, [googleChartInsights.insights, chartShouldShowDaily, chartDayCount, currency]);

  // Phase 7 / ADR-020 §2b — TikTok aggregated KPIs. Account-level ROAS
  // is valid (§2b live-verified 5.37 at IMAA); revenue field already
  // carries the §2b-corrected total_complete_payment_rate (the
  // website-pixel attribution surface), wired in the normalizer.
  // Same currency-filter policy as Google: USD + SAR supported,
  // others dropped — matches the existing aggregation contract.
  const tiktokAggregated = useMemo(() => {
    if (tiktokInsights.insights.length === 0) return null;
    const supportedRows = tiktokInsights.insights.filter((ins) => {
      const c = ins.currency;
      return !c || c === "USD" || c === "SAR";
    });
    const totals = supportedRows.reduce(
      (acc, ins) => {
        const src = (ins.currency as Currency) || "SAR";
        return {
          spend: acc.spend + convertCurrency(ins.spend, src, currency),
          revenue: acc.revenue + convertCurrency(ins.revenue ?? 0, src, currency),
          purchases: acc.purchases + (ins.purchases ?? 0),
        };
      },
      { spend: 0, revenue: 0, purchases: 0 }
    );
    return {
      spend: totals.spend,
      revenue: totals.revenue,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      conversions: totals.purchases,
    };
  }, [tiktokInsights.insights, currency]);

  // TikTok chart data — mirrors googleChartData. Source currency
  // fallback is SAR (TikTok's primary GCC currency) rather than USD.
  const tiktokChartData = useMemo(() => {
    type Row = { date: string; spend: number; revenue: number };
    const byDate = new Map<string, Row>();

    tiktokChartInsights.insights.forEach((insight) => {
      const c = insight.currency;
      const isSupported = !c || c === "USD" || c === "SAR";
      if (!isSupported) return;

      const src = (c as Currency) || "SAR";
      const sp = convertCurrency(insight.spend, src, currency);
      const rv = convertCurrency(insight.revenue ?? 0, src, currency);

      const existing = byDate.get(insight.dateStart);
      if (existing) {
        existing.spend += sp;
        existing.revenue += rv;
      } else {
        byDate.set(insight.dateStart, {
          date: insight.dateStart,
          spend: sp,
          revenue: rv,
        });
      }
    });

    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        dayLabel: chartShouldShowDaily
          ? formatChartDayLabel(row.date, chartDayCount)
          : row.date,
        tooltipLabel: formatChartTooltipLabel(row.date),
        displaySpend: row.spend,
        displayRevenue: row.revenue,
      }));
  }, [tiktokChartInsights.insights, chartShouldShowDaily, chartDayCount, currency]);

  // Real KPI cards from aggregated insights (Meta + Google after M2).
  //
  // `aggregated.spend` / `.revenue` are already in the display currency
  // (converted during aggregation), so we use formatCurrencyWithSymbol —
  // NOT formatAndConvert, which would double-convert.
  //
  // `unsupportedBadges` carry per-currency raw totals (AED, EGP, …) so the
  // UI can render "+ 5,000 AED" alongside the main number. ROAS, profit,
  // and AOV have no badges — mixing currencies in those derived values is
  // meaningless.
  const kpiCards = useMemo(() => {
    if (!aggregated) return [];

    const formatBadge = (amount: number, currencyCode: string): string =>
      `+ ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currencyCode}`;

    const spendBadges = aggregated.isMixed
      ? aggregated.unsupportedTotals.map((u) => formatBadge(u.spend, u.currency))
      : undefined;
    const revenueBadges = aggregated.isMixed
      ? aggregated.unsupportedTotals.map((u) => formatBadge(u.revenue, u.currency))
      : undefined;
    const purchasesBadges = aggregated.isMixed
      ? aggregated.unsupportedTotals.map(
          (u) => `+ ${Math.round(u.purchases).toLocaleString("en-US")} (${u.currency})`
        )
      : undefined;

    return [
      {
        label: "إجمالي الإنفاق",
        value: formatCurrencyWithSymbol(aggregated.spend, currency),
        icon: DollarSign,
        color: "indigo",
        delta: previousSummary
          ? computeDelta(aggregated.spend, previousSummary.spend)
          : null,
        deltaInverse: false,
        unsupportedBadges: spendBadges,
      },
      {
        label: "إجمالي الإيرادات",
        value: formatCurrencyWithSymbol(aggregated.revenue, currency),
        icon: ShoppingCart,
        color: "green",
        delta: previousSummary
          ? computeDelta(aggregated.revenue, previousSummary.revenue)
          : null,
        deltaInverse: false,
        unsupportedBadges: revenueBadges,
      },
      {
        label: "صافي الربح",
        value: formatCurrencyWithSymbol(aggregated.profit, currency),
        icon: TrendingUp,
        color: "emerald",
        delta: previousSummary
          ? computeDelta(aggregated.profit, previousSummary.profit)
          : null,
        deltaInverse: false,
        unsupportedBadges: undefined as string[] | undefined,
      },
      {
        label: "متوسط ROAS",
        value: `${aggregated.roas.toFixed(2)}x`,
        icon: Target,
        color: "purple",
        delta: previousSummary
          ? computeDelta(aggregated.roas, previousSummary.roas)
          : null,
        deltaInverse: false,
        unsupportedBadges: undefined as string[] | undefined,
      },
      {
        label: "عدد المبيعات*",
        value: Math.round(aggregated.purchases).toLocaleString("en-US"),
        icon: Users,
        color: "blue",
        delta: previousSummary
          ? computeDelta(aggregated.purchases, previousSummary.purchases)
          : null,
        deltaInverse: false,
        unsupportedBadges: purchasesBadges,
        footnote: "يشمل تحويلات Google",
      },
      {
        label: "متوسط قيمة الطلب",
        value:
          aggregated.aov > 0
            ? formatCurrencyWithSymbol(aggregated.aov, currency)
            : "—",
        icon: Percent,
        color: "pink",
        delta: previousSummary
          ? computeDelta(aggregated.aov, previousSummary.aov)
          : null,
        deltaInverse: false,
        unsupportedBadges: undefined as string[] | undefined,
      },
    ];
  }, [aggregated, currency, previousSummary]);

  // Secondary 5 — engagement metrics, mini-size cards
  const secondaryKpiCards = useMemo(() => {
    if (!aggregated) return [];
    return [
      {
        label: "الظهور (Impressions)",
        value: Math.round(aggregated.impressions).toLocaleString("en-US"),
        icon: Eye,
        color: "pink" as const,
      },
      {
        label: "النقرات",
        value: Math.round(aggregated.clicks).toLocaleString("en-US"),
        icon: MousePointerClick,
        color: "blue" as const,
      },
      {
        label: "نسبة النقر (CTR)",
        value: `${aggregated.ctr.toFixed(2)}%`,
        icon: Percent,
        color: "green" as const,
        footnote: "نسبة النقرات إلى الظهور",
      },
      {
        label: "تكلفة النقرة (CPC)",
        value: formatCurrencyWithSymbol(aggregated.cpc, currency),
        icon: Coins,
        color: "purple" as const,
        footnote: "متوسط تكلفة كل نقرة",
      },
      {
        label: "تكلفة الألف ظهور (CPM)",
        value: formatCurrencyWithSymbol(aggregated.cpm, currency),
        icon: TrendingUp,
        color: "indigo" as const,
        footnote: "تكلفة كل 1000 ظهور",
      },
    ];
  }, [aggregated, currency]);

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

  // ============================================================
  // Empty state — no connections at all
  // ============================================================
  if (!hasConnections) {
    return (
      <div className="min-h-screen bg-gray-50" dir="rtl">
        <DashboardSidebar
          fullName={fullName}
          email={email}
          activeRoute="/dashboard/reports"
          sidebarOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />

        <div className="lg:mr-64">
          {/* Minimal header for mobile drawer access — empty state still
              needs sign-out / nav reachable on small screens. */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-30 lg:hidden">
            <div className="flex items-center h-16 px-4">
              <button onClick={() => setSidebarOpen(true)}>
                <Menu className="w-6 h-6" />
              </button>
            </div>
          </header>

          <div className="p-8">
            <div className="max-w-2xl mx-auto text-center pt-20">
              <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <FileText className="w-10 h-10 text-indigo-600" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3">
                لا توجد بيانات لعرضها
              </h1>
              <p className="text-gray-600 mb-8 leading-relaxed">
                اربط منصاتك الإعلانية أولاً لتتمكن من رؤية التقارير
                والتحليلات التفصيلية لحملاتك
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard/reports"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />

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
                  : kpiCards.map((stat, i) => (
                      <KpiCard
                        key={i}
                        label={stat.label}
                        value={stat.value}
                        icon={stat.icon}
                        color={stat.color as KpiCardProps["color"]}
                        delta={stat.delta}
                        deltaInverse={stat.deltaInverse}
                        unsupportedBadges={stat.unsupportedBadges}
                        footnote={stat.footnote}
                        previousPeriod={previousPeriod}
                      />
                    ))}
              </div>

              {/* Secondary 5 — engagement metrics (mini) */}
              {aggregated && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                  {secondaryKpiCards.map((stat, i) => (
                    <KpiCard
                      key={`secondary-${i}`}
                      label={stat.label}
                      value={stat.value}
                      icon={stat.icon}
                      color={stat.color}
                      footnote={stat.footnote}
                      size="mini"
                    />
                  ))}
                </div>
              )}

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
                <div ref={chartRef} dir="ltr" className="h-56 sm:h-80">
                  {!chartShouldShowDaily ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <p className="text-sm text-gray-500">
                        التوزيع اليومي متاح للفترات حتى 90 يوم. استخدم النظرة
                        الشاملة من البطاقات أعلاه.
                      </p>
                    </div>
                  ) : chartLoading ? (
                    <div className="h-full w-full animate-pulse bg-gradient-to-b from-gray-100 to-gray-50 rounded" />
                  ) : displayChartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-gray-500 text-sm">
                        لا توجد بيانات لهذه الفترة
                      </p>
                    </div>
                  ) : (
                    chartHeight > 0 && (
                    <ResponsiveContainer width="100%" height={chartHeight}>
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
                          dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="displaySpend"
                          name="الإنفاق"
                          stroke="#6366f1"
                          fillOpacity={1}
                          fill="url(#colorSpd)"
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


              {/* Outer: Platform tabs (Phase 4.8 M1) */}
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-4 sm:mb-6">
                <div className="border-b border-gray-100 px-4 sm:px-6 pt-4 sm:pt-6">
                  <div className="flex items-center gap-1">
                    {metaAccountId && (
                      <button
                        onClick={() => setPlatformTab("meta")}
                        className={`px-5 py-3 text-base font-bold border-b-2 transition -mb-px ${
                          platformTab === "meta"
                            ? "border-indigo-600 text-indigo-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        📘 Meta
                      </button>
                    )}
                    {googleAccountIds.length > 0 && (
                      <button
                        onClick={() => setPlatformTab("google")}
                        className={`px-5 py-3 text-base font-bold border-b-2 transition -mb-px ${
                          platformTab === "google"
                            ? "border-indigo-600 text-indigo-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        🔵 Google
                      </button>
                    )}
                    {tiktokAccountIds.length > 0 && (
                      <button
                        onClick={() => setPlatformTab("tiktok")}
                        className={`px-5 py-3 text-base font-bold border-b-2 transition -mb-px ${
                          platformTab === "tiktok"
                            ? "border-pink-500 text-pink-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        🎵 TikTok
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 sm:p-6">
                  {platformTab === "meta" && (
                    <div>
                      {/* Meta mini KPIs */}
                      {metaAggregated && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                          <KpiCard
                            size="mini"
                            label="إنفاق Meta"
                            value={formatCurrencyWithSymbol(metaAggregated.spend, currency)}
                            icon={DollarSign}
                            color="indigo"
                          />
                          <KpiCard
                            size="mini"
                            label="إيرادات Meta"
                            value={formatCurrencyWithSymbol(metaAggregated.revenue, currency)}
                            icon={ShoppingCart}
                            color="green"
                          />
                          <KpiCard
                            size="mini"
                            label="ROAS Meta"
                            value={`${metaAggregated.roas.toFixed(2)}x`}
                            icon={Target}
                            color="purple"
                          />
                          <KpiCard
                            size="mini"
                            label="مبيعات Meta"
                            value={Math.round(metaAggregated.purchases).toLocaleString("en-US")}
                            icon={Users}
                            color="blue"
                          />
                        </div>
                      )}

                      {/* Meta chart */}
                      {metaChartData.length > 0 && (
                        <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mb-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">
                            أداء Meta — الإنفاق مقابل الإيرادات
                          </h4>
                          <div dir="ltr" className="h-48 sm:h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={metaChartData}>
                                <defs>
                                  <linearGradient id="colorMetaRev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                  </linearGradient>
                                  <linearGradient id="colorMetaSpd" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                <XAxis dataKey="dayLabel" stroke="#9ca3af" fontSize={11} />
                                <YAxis stroke="#9ca3af" fontSize={11} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                                  labelFormatter={(label, payload) => {
                                    const data = payload?.[0]?.payload as { tooltipLabel?: string } | undefined;
                                    return data?.tooltipLabel ?? label;
                                  }}
                                  formatter={(value, name) => {
                                    const num = typeof value === "number" ? value : 0;
                                    return [formatCurrencyWithSymbol(num, currency), name as string];
                                  }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="displayRevenue" name="الإيرادات" stroke="#10b981" fillOpacity={1} fill="url(#colorMetaRev)" />
                                <Area type="monotone" dataKey="displaySpend" name="الإنفاق" stroke="#6366f1" fillOpacity={1} fill="url(#colorMetaSpd)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Inner: Campaigns/Creatives tabs */}
                      <div className="border-b border-gray-100 mb-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setActiveTab("campaigns")}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                              activeTab === "campaigns"
                                ? "border-indigo-600 text-indigo-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            الحملات
                            {insights.length > 0 && (
                              <span className="mr-2 px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                                {insights.length}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => setActiveTab("creatives")}
                            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                              activeTab === "creatives"
                                ? "border-indigo-600 text-indigo-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            الإبداعات
                            {ads.length > 0 && (
                              <span className="mr-2 px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                                {ads.length}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {activeTab === "campaigns" ? (
                    <>
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
                                  {insight.revenue !== null
                                    ? formatAndConvert(
                                        insight.revenue,
                                        accountCurrency,
                                        currency
                                      )
                                    : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  ROAS
                                </p>
                                {insight.roas !== null ? (
                                  <p
                                    className={`text-sm font-semibold ${getROASColor(
                                      insight.roas
                                    )}`}
                                  >
                                    {insight.roas.toFixed(2)}x
                                  </p>
                                ) : (
                                  <p className="text-sm font-semibold text-gray-400">
                                    —
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-0.5">
                                  المبيعات
                                </p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {insight.purchases !== null
                                    ? Math.round(insight.purchases).toLocaleString("en-US")
                                    : (
                                      <span className="text-gray-400">—</span>
                                    )}
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
                                  {insight.revenue !== null
                                    ? formatAndConvert(
                                        insight.revenue,
                                        accountCurrency,
                                        currency
                                      )
                                    : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                </td>
                                {insight.roas !== null ? (
                                  <td
                                    className={`py-3 px-2 font-semibold ${getROASColor(
                                      insight.roas
                                    )}`}
                                  >
                                    {insight.roas.toFixed(2)}x
                                  </td>
                                ) : (
                                  <td className="py-3 px-2 font-semibold text-gray-400">
                                    —
                                  </td>
                                )}
                                <td className="py-3 px-2 text-gray-700">
                                  {insight.purchases !== null
                                    ? Math.round(insight.purchases).toLocaleString("en-US")
                                    : (
                                      <span className="text-gray-400">—</span>
                                    )}
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
                    </>
                  ) : (
                    <>
                      {/* Freshness badge + manual refresh */}
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-100">
                        <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                          {adsRevalidating && (
                            <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                          )}
                          {adsFetchedAt ? (
                            <span>
                              آخر تحديث:{" "}
                              {formatArabicRelativeTime(adsFetchedAt, now)}
                            </span>
                          ) : adsLoading ? (
                            <span>جاري التحميل...</span>
                          ) : null}
                          {adsSource === "cache-stale" && (
                            <span className="text-amber-600">
                              (يتم التحديث في الخلفية)
                            </span>
                          )}
                          {(adsSource === "rate-limited" || adsRateLimited) && (
                            <span className="text-amber-600">
                              (تم تجاوز الحد المؤقت — نعرض البيانات المخزّنة)
                            </span>
                          )}
                        </div>
                        <button
                          onClick={handleRefreshAds}
                          disabled={refreshDisabled}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          title={
                            refreshCooldownRemaining > 0
                              ? `انتظر ${refreshCooldownRemaining} ثانية`
                              : "تحديث البيانات"
                          }
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              adsRevalidating || adsLoading
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          {refreshCooldownRemaining > 0
                            ? `تحديث (${refreshCooldownRemaining}ث)`
                            : "تحديث"}
                        </button>
                      </div>

                      <CreativesGrid
                        ads={activeAds}
                        loading={adsLoading}
                        accountCurrency={accountCurrency}
                        displayCurrency={currency}
                        {...dateRangeValueToOptions(dateRange)}
                      />
                    </>
                  )}
                    </div>
                  )}

                  {platformTab === "google" && (
                    <div>
                      {/* Google mini KPIs */}
                      {googleAggregated && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                          <KpiCard
                            size="mini"
                            label="إنفاق Google"
                            value={formatCurrencyWithSymbol(googleAggregated.spend, currency)}
                            icon={DollarSign}
                            color="indigo"
                          />
                          <KpiCard
                            size="mini"
                            label="إيرادات Google"
                            value={formatCurrencyWithSymbol(googleAggregated.revenue, currency)}
                            icon={ShoppingCart}
                            color="green"
                          />
                          <KpiCard
                            size="mini"
                            label="ROAS Google"
                            value={`${googleAggregated.roas.toFixed(2)}x`}
                            icon={Target}
                            color="purple"
                          />
                          <KpiCard
                            size="mini"
                            label="تحويلات Google"
                            value={Math.round(googleAggregated.conversions).toLocaleString("en-US")}
                            icon={Users}
                            color="blue"
                          />
                        </div>
                      )}

                      {/* Google chart */}
                      {googleChartData.length > 0 && (
                        <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mb-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">
                            أداء Google — الإنفاق مقابل الإيرادات
                          </h4>
                          <div dir="ltr" className="h-48 sm:h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={googleChartData}>
                                <defs>
                                  <linearGradient id="colorGoogleRev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                  </linearGradient>
                                  <linearGradient id="colorGoogleSpd" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                <XAxis dataKey="dayLabel" stroke="#9ca3af" fontSize={11} />
                                <YAxis stroke="#9ca3af" fontSize={11} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                                  labelFormatter={(label, payload) => {
                                    const data = payload?.[0]?.payload as { tooltipLabel?: string } | undefined;
                                    return data?.tooltipLabel ?? label;
                                  }}
                                  formatter={(value, name) => {
                                    const num = typeof value === "number" ? value : 0;
                                    return [formatCurrencyWithSymbol(num, currency), name as string];
                                  }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="displayRevenue" name="الإيرادات" stroke="#10b981" fillOpacity={1} fill="url(#colorGoogleRev)" />
                                <Area type="monotone" dataKey="displaySpend" name="الإنفاق" stroke="#6366f1" fillOpacity={1} fill="url(#colorGoogleSpd)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Phase 4.8 M5 Commit 1B — Google sub-tab toggle */}
                      <div className="border-b border-gray-100 mb-4 mt-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setGoogleActiveTab("campaigns")}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                              googleActiveTab === "campaigns"
                                ? "border-indigo-600 text-indigo-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            الحملات
                            {googleCampaigns.insights.length > 0 && (
                              <span className="mr-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {googleCampaigns.insights.length}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => setGoogleActiveTab("creatives")}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                              googleActiveTab === "creatives"
                                ? "border-indigo-600 text-indigo-600"
                                : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            الإبداعات
                            {visibleGoogleAdsCount > 0 && (
                              <span className="mr-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {visibleGoogleAdsCount}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {googleActiveTab === "campaigns" ? (
                      <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mt-4">
                        <h4 className="text-sm font-bold text-gray-900 mb-3">
                          تفاصيل الحملات
                        </h4>

                        {/* Filters Bar */}
                        <div className="flex flex-col sm:flex-row gap-3 mb-4 pb-4 border-b border-gray-100">
                          <div className="flex-1 relative">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            <input
                              type="text"
                              value={googleSearchQuery}
                              onChange={(e) =>
                                setGoogleSearchQuery(e.target.value)
                              }
                              placeholder="بحث باسم الحملة..."
                              className="w-full pr-9 pl-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <select
                            value={googleStatusFilter}
                            onChange={(e) =>
                              setGoogleStatusFilter(
                                e.target.value as "all" | "ACTIVE" | "PAUSED"
                              )
                            }
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="all">الكل</option>
                            <option value="ACTIVE">نشطة</option>
                            <option value="PAUSED">موقوفة</option>
                          </select>
                          {googleHasActiveFilters && (
                            <button
                              onClick={() => {
                                setGoogleSearchQuery("");
                                setGoogleStatusFilter("all");
                              }}
                              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
                            >
                              مسح الفلاتر
                            </button>
                          )}
                        </div>

                        {/* Results count */}
                        <p className="text-xs text-gray-500 mb-3">
                          {processedGoogleCampaigns.length ===
                          googleCampaigns.insights.filter((r) => r.spend > 0)
                            .length
                            ? `${processedGoogleCampaigns.length} حملة`
                            : `${processedGoogleCampaigns.length} من ${
                                googleCampaigns.insights.filter(
                                  (r) => r.spend > 0
                                ).length
                              } حملة`}
                        </p>

                        {googleCampaigns.loading ? (
                          <div className="space-y-2">
                            {[0, 1, 2, 3, 4].map((i) => (
                              <div
                                key={i}
                                className="h-12 bg-gray-50 rounded animate-pulse"
                              />
                            ))}
                          </div>
                        ) : processedGoogleCampaigns.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-8">
                            لا توجد حملات صرفت في هذه الفترة
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="text-xs text-gray-500 border-b border-gray-100">
                                <tr>
                                  {googleAccountIds.length > 1 && (
                                    <th className="text-right py-2 px-2 font-medium">الحساب</th>
                                  )}
                                  <SortableHeader
                                    column="campaignName"
                                    label="اسم الحملة"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <SortableHeader
                                    column="status"
                                    label="الحالة"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <SortableHeader
                                    column="spend"
                                    label="الإنفاق"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <SortableHeader
                                    column="revenue"
                                    label="الإيرادات"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <SortableHeader
                                    column="roas"
                                    label="ROAS"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <SortableHeader
                                    column="purchases"
                                    label="التحويلات"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                  <th className="text-right py-2 px-2 font-medium">الظهور</th>
                                  <th className="text-right py-2 px-2 font-medium">النقرات</th>
                                  <SortableHeader
                                    column="ctr"
                                    label="CTR"
                                    sortBy={googleSortBy}
                                    sortDir={googleSortDir}
                                    onSort={handleGoogleSort}
                                  />
                                </tr>
                              </thead>
                              <tbody>
                                {processedGoogleCampaigns.map((row, idx) => {
                                  const accountName =
                                    (row.accountId &&
                                      googleAccountNames.get(row.accountId)) ||
                                    `حساب ${row.accountId ?? "—"}`;
                                  const srcCurrency =
                                    (row.currency as Currency) || "USD";
                                  return (
                                    <tr
                                      key={`${row.accountId}-${row.campaignId}-${idx}`}
                                      className="border-b border-gray-50 hover:bg-gray-50 transition"
                                    >
                                      {googleAccountIds.length > 1 && (
                                        <td className="text-right py-2 px-2 text-gray-700">
                                          {accountName}
                                        </td>
                                      )}
                                      <td className="text-right py-2 px-2 text-gray-900 font-medium">
                                        {row.campaignName ?? "—"}
                                      </td>
                                      <td className="text-right py-2 px-2">
                                        <StatusBadge status={row.status} />
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-900">
                                        {formatCurrencyWithSymbol(
                                          convertCurrency(row.spend, srcCurrency, currency),
                                          currency
                                        )}
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-900">
                                        {row.revenue !== null
                                          ? formatCurrencyWithSymbol(
                                              convertCurrency(row.revenue, srcCurrency, currency),
                                              currency
                                            )
                                          : "—"}
                                      </td>
                                      <td className={`text-right py-2 px-2 font-semibold ${row.roas !== null ? getROASColor(row.roas) : "text-gray-400"}`}>
                                        {row.roas !== null ? `${row.roas.toFixed(2)}x` : "—"}
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-900">
                                        {row.purchases !== null
                                          ? Math.round(row.purchases).toLocaleString("en-US")
                                          : "—"}
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-700">
                                        {row.impressions.toLocaleString("en-US")}
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-700">
                                        {row.clicks.toLocaleString("en-US")}
                                      </td>
                                      <td className="text-right py-2 px-2 text-gray-700">
                                        {row.ctr.toFixed(2)}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                      ) : (
                      <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mt-4">
                        {googleAdsNoConnection ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">لا توجد حسابات Google مربوطة</p>
                          </div>
                        ) : googleAdsError === "reauth_required" ? (
                          /* ADR-017: Arabic CTA banner for invalid_grant / consent_revoked */
                          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
                            <h3 className="font-bold text-amber-900">إعادة ربط حساب Google مطلوبة</h3>
                            <p className="text-sm text-amber-800 mt-1">
                              انتهت صلاحية الربط مع Google Ads. اضغط على الزر أدناه لإعادة الربط
                              والاستمرار في عرض بيانات حملاتك.
                            </p>
                            <a
                              href="/dashboard/connections/google"
                              className="inline-block mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-semibold"
                            >
                              أعد ربط حساب Google
                            </a>
                          </div>
                        ) : googleAdsLoading && googleAds.length === 0 ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">جاري التحميل...</p>
                          </div>
                        ) : googleAdsError === "fetch_failed" ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm text-red-600">تعذّر تحميل الإعلانات</p>
                            <button
                              onClick={() => refreshGoogleAds()}
                              className="mt-2 text-sm text-indigo-600 hover:underline"
                            >
                              إعادة المحاولة
                            </button>
                          </div>
                        ) : googleAds.length === 0 ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">لا توجد إعلانات بإنفاق في هذه الفترة</p>
                            <button
                              onClick={() => refreshGoogleAds()}
                              className="mt-2 text-sm text-indigo-600 hover:underline"
                            >
                              تحديث
                            </button>
                          </div>
                        ) : (
                          <>
                            <h4 className="text-sm font-bold text-gray-900 mb-3">
                              تفاصيل الإعلانات
                            </h4>
                            <CreativesGrid
                              ads={googleAds}
                              loading={googleAdsLoading}
                              accountCurrency={"USD" as Currency}
                              displayCurrency={currency}
                              {...dateRangeValueToOptions(dateRange)}
                            />
                            {googleAdsError === "partial_failure" && (
                              <p className="text-xs text-amber-600 mt-2 text-center">
                                ⚠️ بعض الحسابات لم يتم تحميلها — قد تكون البيانات غير مكتملة
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      )}
                    </div>
                  )}

                  {/* Phase 7 / ADR-020 — TikTok tab. Mirrors Google's
                      structure: optional multi-account warning,
                      mini-KPI strip (§2b-verified account metrics),
                      AreaChart, then 5-state creatives dispatch. No
                      campaigns sub-tab in 2e (scope: data-flowing
                      + cards rendering). */}
                  {platformTab === "tiktok" && (
                    <div>
                      {/* Single-account constraint warning per
                          ADR-020 §12c §2: the URL-resolve route + the
                          batch hook each take ONE account_id. In v1
                          we use the first tiktok account; additional
                          accounts surface in insights but not in
                          card URL resolution. IMAA is single-account
                          so this is dormant for the current test
                          path. */}
                      {tiktokAccountIds.length > 1 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
                          <p className="text-xs text-amber-800 leading-relaxed">
                            تم اكتشاف عدة حسابات TikTok — الإصدار الحالي يدعم حساباً واحداً فقط في معاينات الإعلانات.
                          </p>
                        </div>
                      )}

                      {/* TikTok mini KPIs — §2b-verified metric set.
                          Account-level ROAS is valid here (live-verified
                          5.37 at IMAA against the platform UI). */}
                      {tiktokAggregated && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                          <KpiCard
                            size="mini"
                            label="إنفاق TikTok"
                            value={formatCurrencyWithSymbol(tiktokAggregated.spend, currency)}
                            icon={DollarSign}
                            color="pink"
                          />
                          <KpiCard
                            size="mini"
                            label="إيرادات TikTok"
                            value={formatCurrencyWithSymbol(tiktokAggregated.revenue, currency)}
                            icon={ShoppingCart}
                            color="green"
                          />
                          <KpiCard
                            size="mini"
                            label="ROAS TikTok"
                            value={`${tiktokAggregated.roas.toFixed(2)}x`}
                            icon={Target}
                            color="purple"
                          />
                          <KpiCard
                            size="mini"
                            label="مبيعات TikTok"
                            value={Math.round(tiktokAggregated.conversions).toLocaleString("en-US")}
                            icon={Users}
                            color="blue"
                          />
                        </div>
                      )}

                      {/* TikTok chart — same AreaChart treatment as
                          Google, with pink (spend) + green (revenue)
                          gradients. Pink mirrors the brand palette
                          used in the card/modal so the tab feels
                          unified. */}
                      {tiktokChartData.length > 0 && (
                        <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mb-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">
                            أداء TikTok — الإنفاق مقابل الإيرادات
                          </h4>
                          <div dir="ltr" className="h-48 sm:h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={tiktokChartData}>
                                <defs>
                                  <linearGradient id="colorTiktokRev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                  </linearGradient>
                                  <linearGradient id="colorTiktokSpd" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                <XAxis dataKey="dayLabel" stroke="#9ca3af" fontSize={11} />
                                <YAxis stroke="#9ca3af" fontSize={11} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                                  labelFormatter={(label, payload) => {
                                    const data = payload?.[0]?.payload as { tooltipLabel?: string } | undefined;
                                    return data?.tooltipLabel ?? label;
                                  }}
                                  formatter={(value, name) => {
                                    const num = typeof value === "number" ? value : 0;
                                    return [formatCurrencyWithSymbol(num, currency), name as string];
                                  }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="displayRevenue" name="الإيرادات" stroke="#10b981" fillOpacity={1} fill="url(#colorTiktokRev)" />
                                <Area type="monotone" dataKey="displaySpend" name="الإنفاق" stroke="#ec4899" fillOpacity={1} fill="url(#colorTiktokSpd)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Creatives container — 5-state dispatch mirroring
                          Google's. Reauth banner links to /dashboard/
                          connections (the parent index that lists all
                          platforms) — TikTok has no dedicated
                          per-platform connections page yet. */}
                      <div className="border border-gray-100 rounded-lg p-3 sm:p-4 mt-4">
                        {tiktokAdsNoConnection ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">لا توجد حسابات TikTok مربوطة</p>
                          </div>
                        ) : tiktokAdsError === "reauth_required" ? (
                          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
                            <h3 className="font-bold text-amber-900">إعادة ربط حساب TikTok مطلوبة</h3>
                            <p className="text-sm text-amber-800 mt-1">
                              انتهت صلاحية الربط مع TikTok Ads. اضغط على الزر أدناه لإعادة الربط
                              والاستمرار في عرض بيانات حملاتك.
                            </p>
                            <a
                              href="/dashboard/connections"
                              className="inline-block mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-semibold"
                            >
                              أعد ربط حساب TikTok
                            </a>
                          </div>
                        ) : tiktokAdsLoading && tiktokAds.length === 0 ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">جاري التحميل...</p>
                          </div>
                        ) : tiktokAdsError === "fetch_failed" ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm text-red-600">تعذّر تحميل الإعلانات</p>
                            <button
                              onClick={() => refreshTiktokAds()}
                              className="mt-2 text-sm text-indigo-600 hover:underline"
                            >
                              إعادة المحاولة
                            </button>
                          </div>
                        ) : tiktokAds.length === 0 ? (
                          <div className="text-center py-10 text-gray-500">
                            <p className="text-sm">لا توجد إعلانات بإنفاق في هذه الفترة</p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-bold text-gray-900">
                                تفاصيل الإعلانات
                              </h4>
                              <button
                                onClick={handleRefreshTiktokAds}
                                disabled={refreshDisabledTiktok}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                title={
                                  refreshCooldownRemainingTiktok > 0
                                    ? `انتظر ${refreshCooldownRemainingTiktok} ثانية`
                                    : "تحديث البيانات"
                                }
                              >
                                <RefreshCw
                                  className={`w-3.5 h-3.5 ${
                                    tiktokAdsLoading ? "animate-spin" : ""
                                  }`}
                                />
                                {refreshCooldownRemainingTiktok > 0
                                  ? `تحديث (${refreshCooldownRemainingTiktok}ث)`
                                  : "تحديث"}
                              </button>
                            </div>
                            <CreativesGrid
                              ads={tiktokAds}
                              loading={tiktokAdsLoading}
                              accountCurrency={"SAR" as Currency}
                              displayCurrency={currency}
                              {...dateRangeValueToOptions(dateRange)}
                            />
                            {tiktokAdsError === "partial_failure" && (
                              <p className="text-xs text-amber-600 mt-2 text-center">
                                ⚠️ بعض الحسابات لم يتم تحميلها — قد تكون البيانات غير مكتملة
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

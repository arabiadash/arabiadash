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
import type { Workspace, WorkspaceConnection } from "@/lib/workspaces";
import {
  useInsights,
  dateRangeValueToOptions,
} from "@/lib/hooks/use-insights";
import { useProviderInsights } from "@/lib/hooks/use-provider-insights";
import { useAds } from "@/lib/hooks/use-ads";
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
  convertCurrency,
  CURRENCY_LABELS,
  type Currency,
} from "@/lib/currency";
import {
  formatChartDayLabel,
  formatChartTooltipLabel,
  type DateRangeValue,
  type UnifiedCampaign,
  type UnifiedAd,
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
  const imageUrl = ad.imageUrl || ad.thumbnailUrl;
  const isVideo = ad.creativeType === "video";
  const isCatalog = ad.creativeType === "catalog";
  const isCarousel = ad.creativeType === "carousel";
  const hasCatalogProducts =
    isCatalog &&
    Array.isArray(ad.catalogProducts) &&
    ad.catalogProducts.length > 0;
  const hasCarouselImages =
    isCarousel &&
    Array.isArray(ad.carouselImages) &&
    ad.carouselImages.length > 1;

  return (
    <div
      className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition cursor-pointer"
      onClick={onClick}
    >
      <div className="aspect-square relative bg-gray-100 overflow-hidden">
        {hasCarouselImages ? (
          <CarouselImage images={ad.carouselImages!} />
        ) : hasCatalogProducts ? (
          <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px bg-gray-200">
            {ad.catalogProducts!.slice(0, 4).map((product) => (
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
              length: Math.max(0, 4 - ad.catalogProducts!.length),
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
          className="font-semibold text-gray-900 text-xs line-clamp-2 mb-2 min-h-[2rem]"
          title={ad.name}
        >
          {ad.name}
        </h4>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-gray-500 text-[10px]">ROAS</p>
            <p className={`font-bold ${getROASColor(ad.roas)}`}>
              {ad.roas.toFixed(2)}x
            </p>
          </div>
          <div className="text-left">
            <p className="text-gray-500 text-[10px]">المبيعات</p>
            <p className="font-bold text-gray-900">{ad.purchases}</p>
          </div>
          <div className="col-span-2">
            <p className="text-gray-500 text-[10px]">الإنفاق</p>
            <p className="font-bold text-gray-900">
              {formatAndConvert(ad.spend, accountCurrency, displayCurrency)}
            </p>
          </div>
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
}

function AdDetailModal({
  ad,
  accountCurrency,
  displayCurrency,
  onClose,
}: AdDetailModalProps) {
  const imageUrl = ad.imageUrl || ad.thumbnailUrl;
  const isCatalog = ad.creativeType === "catalog";
  const isVideo = ad.creativeType === "video";
  const hasCatalogProducts =
    isCatalog &&
    Array.isArray(ad.catalogProducts) &&
    ad.catalogProducts.length > 0;
  // Show multi-image gallery whenever 2+ images exist — works for classic
  // carousels AND Meta's Flexible Ads (asset_feed_spec.images).
  const hasCarouselImages = (ad.carouselImages?.length ?? 0) >= 2;

  const [carouselIndex, setCarouselIndex] = useState(0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
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
              ad.thumbnailUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ad.thumbnailUrl}
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
                images={ad.carouselImages!}
                currentIndex={carouselIndex}
                setCurrentIndex={setCarouselIndex}
              />
            ) : hasCatalogProducts ? (
              <div className="grid grid-cols-2 gap-1 aspect-square">
                {ad.catalogProducts!.slice(0, 4).map((product) => (
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

          {ad.title && (
            <div>
              <p className="text-xs text-gray-500 mb-1">عنوان الإعلان</p>
              <p className="text-sm font-medium text-gray-900">{ad.title}</p>
            </div>
          )}

          {ad.body && (
            <div>
              <p className="text-xs text-gray-500 mb-1">نص الإعلان</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {ad.body}
              </p>
            </div>
          )}

          {ad.callToAction && (
            <div>
              <p className="text-xs text-gray-500 mb-1">زر الإجراء</p>
              <span className="inline-block px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold">
                {CTA_LABELS_AR[ad.callToAction] ?? ad.callToAction}
              </span>
            </div>
          )}

          {hasCatalogProducts && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                أفضل المنتجات في الكتالوج
              </p>
              <div className="space-y-2">
                {ad.catalogProducts!.map((product) => (
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
                <p
                  className={`text-lg font-bold ${getROASColor(ad.roas)}`}
                >
                  {ad.roas.toFixed(2)}x
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">الإنفاق</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatAndConvert(ad.spend, accountCurrency, displayCurrency)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">الإيرادات</p>
                <p className="text-lg font-bold text-green-600">
                  {formatAndConvert(
                    ad.revenue,
                    accountCurrency,
                    displayCurrency
                  )}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">المبيعات</p>
                <p className="text-lg font-bold text-gray-900">
                  {ad.purchases}
                </p>
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
                  {formatAndConvert(ad.cpc, accountCurrency, displayCurrency)}
                </p>
              </div>
            </div>
          </div>

          {/* Facebook preview link — always available when Meta exposes it */}
          {ad.previewLink && (
            <div className="border-t border-gray-100 pt-4">
              <a
                href={ad.previewLink}
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

interface CreativesGridProps {
  ads: UnifiedAd[];
  loading: boolean;
  accountCurrency: Currency;
  displayCurrency: Currency;
}

type CreativeStatusFilter = "all" | "ACTIVE" | "PAUSED";
type CreativeSortKey = "roas" | "spend" | "purchases";

const CREATIVES_PAGE_SIZE = 20;

function CreativesGrid({
  ads,
  loading,
  accountCurrency,
  displayCurrency,
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
            <CreativeCard
              key={ad.id}
              ad={ad}
              accountCurrency={accountCurrency}
              displayCurrency={displayCurrency}
              onClick={() => setSelectedAd(ad)}
            />
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

  // Reports tab (campaigns table vs creatives grid), persisted to localStorage
  const [activeTab, setActiveTab] = useState<"campaigns" | "creatives">(
    "campaigns"
  );

  // Outer platform tab (Phase 4.8 M1). Defaults to Meta; auto-switches to
  // Google when the workspace has no Meta connection but has Google.
  const [platformTab, setPlatformTab] = useState<"meta" | "google">("meta");

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
    if (!metaAccountId && googleAccountIds.length > 0) {
      setPlatformTab("google");
    }
  }, [metaAccountId, googleAccountIds.length]);

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

  // Per-account breakdown for the Google tab. Groups insights by accountId,
  // computes per-account totals + ROAS. Sorted by spend desc so the biggest
  // spenders appear first — that's the row most actionable for budget
  // decisions. `hasUnsupported` flags accounts with non-USD/SAR data so the
  // UI can surface a note (those rows are excluded from the displayed totals).
  const googleAccountsBreakdown = useMemo(() => {
    type AccountRow = {
      accountId: string;
      spend: number;
      revenue: number;
      roas: number;
      conversions: number;
      hasUnsupported: boolean;
    };

    const byAccount = new Map<string, AccountRow>();

    googleInsights.insights.forEach((insight) => {
      const accId = insight.accountId;
      if (!accId) return;

      const c = insight.currency;
      const isSupported = !c || c === "USD" || c === "SAR";

      if (!byAccount.has(accId)) {
        byAccount.set(accId, {
          accountId: accId,
          spend: 0,
          revenue: 0,
          roas: 0,
          conversions: 0,
          hasUnsupported: false,
        });
      }

      const row = byAccount.get(accId)!;

      if (!isSupported) {
        row.hasUnsupported = true;
        return;
      }

      const src = (c as Currency) || "USD";
      row.spend += convertCurrency(insight.spend, src, currency);
      row.revenue += convertCurrency(insight.revenue ?? 0, src, currency);
      row.conversions += insight.purchases ?? 0;
    });

    byAccount.forEach((row) => {
      row.roas = row.spend > 0 ? row.revenue / row.spend : 0;
    });

    return Array.from(byAccount.values()).sort((a, b) => b.spend - a.spend);
  }, [googleInsights.insights, currency]);

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

                      {/* Per-account breakdown */}
                      {googleAccountsBreakdown.length > 0 && (
                        <div className="border border-gray-100 rounded-lg p-3 sm:p-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-3">
                            تفاصيل الحسابات
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="text-xs text-gray-500 border-b border-gray-100">
                                <tr>
                                  <th className="text-right py-2 px-2 font-medium">الحساب</th>
                                  <th className="text-right py-2 px-2 font-medium">الإنفاق</th>
                                  <th className="text-right py-2 px-2 font-medium">الإيرادات</th>
                                  <th className="text-right py-2 px-2 font-medium">ROAS</th>
                                  <th className="text-right py-2 px-2 font-medium">التحويلات</th>
                                </tr>
                              </thead>
                              <tbody>
                                {googleAccountsBreakdown.map((row) => (
                                  <tr key={row.accountId} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                    <td className="py-2 px-2 font-medium text-gray-900">
                                      {googleAccountNames.get(row.accountId) || `حساب ${row.accountId}`}
                                      {row.hasUnsupported && (
                                        <span className="mr-1 text-[10px] text-amber-600">*</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-gray-700">
                                      {formatCurrencyWithSymbol(row.spend, currency)}
                                    </td>
                                    <td className="py-2 px-2 text-gray-900 font-medium">
                                      {formatCurrencyWithSymbol(row.revenue, currency)}
                                    </td>
                                    <td className={`py-2 px-2 font-semibold ${getROASColor(row.roas)}`}>
                                      {row.roas.toFixed(2)}x
                                    </td>
                                    <td className="py-2 px-2 text-gray-700">
                                      {Math.round(row.conversions).toLocaleString("en-US")}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {googleAccountsBreakdown.some((r) => r.hasUnsupported) && (
                              <p className="text-[10px] text-amber-600 mt-2">
                                * بعض البيانات بعملات غير مدعومة (تظهر بدون تحويل في الإجماليات)
                              </p>
                            )}
                          </div>
                        </div>
                      )}
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

import type { UnifiedAd } from "@/lib/ads/types";
import { formatCurrency, type Currency } from "@/lib/currency";

// =================================================================
// PMaxAssetGroupCard — Phase 4.8 M-PMax / ADR-013 Commit 10
// =================================================================
//
// Renders the PMAX_ASSET_GROUP variant of UnifiedAd. New file in
// src/components/creatives/ — the canonical home for per-variant card
// renderers going forward (Phase 7+ TikTok / Snap / Salla / Zid will
// add their own card sibling-files following the same pattern).
//
// Visual polish (icon refinement, density, color tweaks) deferred to
// Memory #30's design-pass phase. This commit gets the structure right
// — labels in Arabic per CLAUDE.md i18n convention, ad_strength badge
// per ADR-013 Decision 5, hasConversionData-aware metric rendering per
// the ADR-011 "configured vs zero" distinction (Commit 4 retrofit).

type PMaxAssetGroupAd = Extract<
  UnifiedAd,
  { ad_type: "PMAX_ASSET_GROUP" }
>;

type AssetGroupAsset = PMaxAssetGroupAd["type_data"]["assets"][number];

type PMaxAssetGroupCardProps = {
  ad: PMaxAssetGroupAd;
  onClick?: (ad: UnifiedAd) => void;
};

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

// Inline ROAS color rule — mirrors the existing inline helper in
// ReportsClient.tsx so visual parity holds when the dispatcher
// (Commit 12) mixes inline M5/M6 cards alongside these PMax cards.
function roasColorClass(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

// Forward-compat reader for the per-asset `performanceLabel` field.
// The PMAX_ASSET_GROUP variant doesn't include this field in its type
// today (Google Ads API v23 rejects `asset_group_asset.performance_label`
// at runtime — fourth instance of the SDK-vs-runtime trap; see ADR-013
// Trade-offs and Phase 4 recon). When Google eventually enables the
// field and we widen `AssetGroupAsset`, the badge starts rendering
// automatically — no other code change required. Until then this
// reader returns undefined for every asset and the chip renders no badge.
function readAssetPerformanceLabel(asset: AssetGroupAsset): string | undefined {
  if (
    asset &&
    typeof asset === "object" &&
    "performanceLabel" in asset
  ) {
    const value = (asset as { performanceLabel?: unknown }).performanceLabel;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function groupAssetsByFieldType(
  assets: ReadonlyArray<AssetGroupAsset>
): Array<{ fieldType: string; items: AssetGroupAsset[] }> {
  const byType = new Map<string, AssetGroupAsset[]>();
  for (const asset of assets) {
    const list = byType.get(asset.fieldType) ?? [];
    list.push(asset);
    byType.set(asset.fieldType, list);
  }
  // Preserve insertion order — matches Google's own asset_group_asset
  // result ordering (HEADLINE rows first, then descriptions, then images).
  return Array.from(byType.entries()).map(([fieldType, items]) => ({
    fieldType,
    items,
  }));
}

// -----------------------------------------------------------------
// Localization tables (Arabic labels per CLAUDE.md i18n convention)
// -----------------------------------------------------------------

const AD_STRENGTH_BADGE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  EXCELLENT: {
    label: "ممتاز",
    className: "bg-green-100 text-green-800",
  },
  GOOD: {
    label: "جيد",
    className: "bg-lime-100 text-lime-800",
  },
  AVERAGE: {
    label: "متوسط",
    className: "bg-yellow-100 text-yellow-800",
  },
  POOR: {
    label: "ضعيف",
    className: "bg-red-100 text-red-800",
  },
  NO_ADS: {
    label: "لا توجد إعلانات",
    className: "bg-gray-100 text-gray-700",
  },
  PENDING: {
    label: "قيد المراجعة",
    className: "bg-gray-100 text-gray-600",
  },
  UNSPECIFIED: {
    label: "غير محدد",
    className: "bg-gray-100 text-gray-600",
  },
  UNKNOWN: {
    label: "غير معروف",
    className: "bg-gray-100 text-gray-600",
  },
};

const FIELD_TYPE_LABEL_AR: Record<string, string> = {
  HEADLINE: "عنوان",
  LONG_HEADLINE: "عنوان طويل",
  DESCRIPTION: "وصف",
  BUSINESS_NAME: "اسم النشاط",
  MARKETING_IMAGE: "صورة تسويقية",
  SQUARE_MARKETING_IMAGE: "صورة مربعة",
  PORTRAIT_MARKETING_IMAGE: "صورة عمودية",
  LOGO: "شعار",
  LANDSCAPE_LOGO: "شعار أفقي",
  YOUTUBE_VIDEO: "فيديو يوتيوب",
  VIDEO: "فيديو",
  CALL_TO_ACTION_SELECTION: "دعوة لاتخاذ إجراء",
  MANDATORY_AD_TEXT: "نص إعلاني إلزامي",
};

// `performance_label` is deferred (see readAssetPerformanceLabel docstring).
// Config stays available for forward-compat — chip renders if reader
// returns a value, no-op otherwise.
const PERFORMANCE_LABEL_BADGE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  BEST: { label: "الأفضل", className: "bg-green-100 text-green-700" },
  GOOD: { label: "جيد", className: "bg-yellow-100 text-yellow-700" },
  LOW: { label: "ضعيف", className: "bg-red-100 text-red-700" },
  LEARNING: { label: "تعلّم", className: "bg-gray-100 text-gray-600" },
  PENDING: { label: "قيد التقييم", className: "bg-gray-50 text-gray-500" },
};

// -----------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------

function AdStrengthBadge({ adStrength }: { adStrength: string }) {
  // Falls back to UNKNOWN config for any value not in the table
  // (covers future Google additions + the `OTHER_${n}` shape returned
  // by `readAdStrength` when the integer enum drifts).
  const config =
    AD_STRENGTH_BADGE_CONFIG[adStrength] ??
    AD_STRENGTH_BADGE_CONFIG.UNKNOWN;
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function PerformanceLabelBadge({ label }: { label: string }) {
  const config = PERFORMANCE_LABEL_BADGE_CONFIG[label];
  if (!config) return null;
  return (
    <span
      className={`ms-1 px-1.5 py-px rounded text-[9px] font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function MetricCell({
  label,
  value,
  className = "text-gray-900",
  unavailable = false,
}: {
  label: string;
  value: string;
  className?: string;
  unavailable?: boolean;
}) {
  return (
    <div>
      <p className="text-gray-500 text-[10px]">{label}</p>
      {unavailable ? (
        <p
          className="font-bold text-gray-400"
          title="لم يتم إعداد تتبع الشراء في الحساب"
        >
          —
        </p>
      ) : (
        <p className={`font-bold ${className}`}>{value}</p>
      )}
    </div>
  );
}

function AssetChip({ asset }: { asset: AssetGroupAsset }) {
  const performanceLabel = readAssetPerformanceLabel(asset);

  if (asset.imageUrl) {
    return (
      <div className="inline-flex items-center gap-1 align-top">
        <img
          src={asset.imageUrl}
          alt=""
          loading="lazy"
          className="w-12 h-12 object-cover rounded border border-gray-200 bg-gray-50"
          onError={(e) => {
            // Graceful broken-image fallback — collapse to a neutral box
            // so the layout doesn't shift around a broken icon.
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        {performanceLabel && <PerformanceLabelBadge label={performanceLabel} />}
      </div>
    );
  }

  if (asset.youtubeVideoId) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-50 border border-purple-100 text-xs text-purple-700">
        <span aria-hidden>📹</span>
        <span className="font-mono text-[10px]">{asset.youtubeVideoId}</span>
        {performanceLabel && <PerformanceLabelBadge label={performanceLabel} />}
      </span>
    );
  }

  if (asset.text) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-800 max-w-full"
        title={asset.text}
      >
        <span className="truncate max-w-[14rem] inline-block align-bottom">
          {asset.text}
        </span>
        {performanceLabel && <PerformanceLabelBadge label={performanceLabel} />}
      </span>
    );
  }

  // No text / image / video — render an empty placeholder chip with
  // diagnostic visibility (assetType visible on hover).
  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded bg-gray-50 border border-dashed border-gray-300 text-[10px] text-gray-400"
      title={asset.assetType}
    >
      (فارغ)
    </span>
  );
}

function AssetGrid({ assets }: { assets: AssetGroupAsset[] }) {
  if (assets.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">
        لا توجد أصول مرئية متاحة
      </p>
    );
  }

  const grouped = groupAssetsByFieldType(assets);

  return (
    <div className="space-y-2">
      {grouped.map((group) => (
        <div key={group.fieldType}>
          <p className="text-[10px] font-semibold text-gray-500 mb-1">
            {FIELD_TYPE_LABEL_AR[group.fieldType] ?? group.fieldType}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((asset, idx) => (
              <AssetChip
                key={`${group.fieldType}-${idx}`}
                asset={asset}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function PMaxAssetGroupCard({ ad, onClick }: PMaxAssetGroupCardProps) {
  const currency: Currency = (ad.currency as Currency) ?? "USD";

  // Format helpers using only the row's source currency — currency
  // conversion (multi-account workspaces with mixed currencies) is the
  // dispatcher's concern in Commit 12; this component stays platform-
  // agnostic and renders one row's worth of data faithfully.
  const formatSpend = (n: number) => formatCurrency(n, currency);
  const formatCount = (n: number) =>
    Math.round(n).toLocaleString("en-US");

  const purchaseAvailable = ad.hasConversionData && ad.purchases !== null;
  const revenueAvailable = ad.hasConversionData && ad.revenue !== null;
  const roasAvailable = ad.hasConversionData && ad.roas !== null;

  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(ad) : undefined}
      className="w-full text-right bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-gray-300 transition cursor-pointer"
    >
      {/* Header: name + ad_strength badge */}
      <div className="p-3 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4
            className="font-semibold text-gray-900 text-sm line-clamp-2"
            title={ad.name}
          >
            {ad.name}
          </h4>
          {ad.campaignName && (
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">
              {ad.campaignName}
            </p>
          )}
        </div>
        <AdStrengthBadge adStrength={ad.type_data.adStrength} />
      </div>

      {/* Metrics: 3-col x 2-row */}
      <div className="p-3 border-b border-gray-100">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <MetricCell
            label="الظهور"
            value={formatCount(ad.impressions)}
          />
          <MetricCell label="النقرات" value={formatCount(ad.clicks)} />
          <MetricCell label="الإنفاق" value={formatSpend(ad.spend)} />
          <MetricCell
            label="المبيعات"
            value={purchaseAvailable ? formatCount(ad.purchases!) : ""}
            unavailable={!purchaseAvailable}
          />
          <MetricCell
            label="الإيرادات"
            value={revenueAvailable ? formatSpend(ad.revenue!) : ""}
            className="text-green-700"
            unavailable={!revenueAvailable}
          />
          <MetricCell
            label="ROAS"
            value={roasAvailable ? `${ad.roas!.toFixed(2)}x` : ""}
            className={roasAvailable ? roasColorClass(ad.roas!) : undefined}
            unavailable={!roasAvailable}
          />
        </div>
      </div>

      {/* Assets section */}
      <div className="p-3">
        <p className="text-[10px] font-semibold text-gray-600 mb-2">
          الأصول
        </p>
        <AssetGrid assets={ad.type_data.assets} />
      </div>

      {/* Footer: primary_status text */}
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 rounded-b-lg">
        <p className="text-[10px] text-gray-500">
          الحالة: <span className="font-medium">{ad.type_data.primaryStatus}</span>
        </p>
      </div>
    </button>
  );
}

import type { UnifiedAd } from "@/lib/ads/types";
import { formatAndConvert, type Currency } from "@/lib/currency";

// =================================================================
// PMaxAssetGroupCard — compact variant (Stage 5 UX redesign, ADR-013)
// =================================================================
//
// Renders PMAX_ASSET_GROUP at the SAME visual size and shape as
// CreativeCard in ReportsClient.tsx so the two render side-by-side
// without breaking grid rhythm. All asset details live in the modal
// (PMaxAssetGroupModalContent inside ReportsClient.tsx) — opening via
// onClick, identical interaction model to Search RDA cards.
//
// Previous implementation rendered all ~163 assets inline inside the
// card, producing a 4-6× taller card and breaking the dispatcher's
// "all cards look like CreativeCard" contract. That version is
// replaced wholesale.
//
// Status labels (STATUS_LABELS_AR) and ROAS color thresholds duplicate
// CreativeCard inline helpers — same DRY deferral rule as Commits 10/11.

type PMaxAssetGroupAd = Extract<
  UnifiedAd,
  { ad_type: "PMAX_ASSET_GROUP" }
>;

type AssetGroupAsset = PMaxAssetGroupAd["type_data"]["assets"][number];

interface PMaxAssetGroupCardProps {
  ad: PMaxAssetGroupAd;
  accountCurrency: Currency;
  displayCurrency: Currency;
  onClick?: () => void;
}

// -----------------------------------------------------------------
// Localization + visual config (mirrors CreativeCard's inline tables)
// -----------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-yellow-100 text-yellow-700",
  DELETED: "bg-red-100 text-red-700",
};

const STATUS_LABELS_AR: Record<string, string> = {
  ACTIVE: "نشط",
  PAUSED: "موقوف",
  DELETED: "محذوف",
};

const AD_STRENGTH_BADGE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  EXCELLENT: { label: "ممتاز", className: "bg-green-100 text-green-800" },
  GOOD: { label: "جيد", className: "bg-blue-100 text-blue-800" },
  AVERAGE: { label: "متوسط", className: "bg-amber-100 text-amber-800" },
  POOR: { label: "ضعيف", className: "bg-red-100 text-red-800" },
  NO_ADS: { label: "لا توجد إعلانات", className: "bg-gray-100 text-gray-700" },
  PENDING: { label: "قيد المراجعة", className: "bg-gray-100 text-gray-600" },
  UNSPECIFIED: { label: "غير محدد", className: "bg-gray-100 text-gray-600" },
  UNKNOWN: { label: "غير معروف", className: "bg-gray-100 text-gray-600" },
};

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function roasColor(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

// Hero image picker — priority per design spec:
//   1) IMAGE asset with fieldType ∈ {MARKETING_IMAGE, SQUARE_MARKETING_IMAGE,
//      PORTRAIT_MARKETING_IMAGE, TALL_PORTRAIT_MARKETING_IMAGE}
//   2) LOGO image (fieldType ∈ {LOGO, LANDSCAPE_LOGO})
//   3) null → caller renders gradient placeholder
const MARKETING_IMAGE_FIELDS = new Set([
  "MARKETING_IMAGE",
  "SQUARE_MARKETING_IMAGE",
  "PORTRAIT_MARKETING_IMAGE",
  "TALL_PORTRAIT_MARKETING_IMAGE",
]);
const LOGO_IMAGE_FIELDS = new Set(["LOGO", "LANDSCAPE_LOGO"]);

function pickHeroImageUrl(
  assets: ReadonlyArray<AssetGroupAsset>
): string | undefined {
  let logoFallback: string | undefined;
  for (const asset of assets) {
    if (asset.assetType !== "IMAGE" || !asset.imageUrl) continue;
    if (MARKETING_IMAGE_FIELDS.has(asset.fieldType)) {
      return asset.imageUrl;
    }
    if (!logoFallback && LOGO_IMAGE_FIELDS.has(asset.fieldType)) {
      logoFallback = asset.imageUrl;
    }
  }
  return logoFallback;
}

// Asset counts for the footer hint ("X صورة • Y فيديو • Z عنوان").
function countAssets(assets: ReadonlyArray<AssetGroupAsset>): {
  images: number;
  videos: number;
  headlines: number;
} {
  let images = 0;
  let videos = 0;
  let headlines = 0;
  for (const a of assets) {
    if (a.assetType === "IMAGE") images++;
    else if (a.assetType === "YOUTUBE_VIDEO") videos++;
    if (a.fieldType === "HEADLINE" || a.fieldType === "LONG_HEADLINE") headlines++;
  }
  return { images, videos, headlines };
}

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function PMaxAssetGroupCard({
  ad,
  accountCurrency,
  displayCurrency,
  onClick,
}: PMaxAssetGroupCardProps) {
  const heroImageUrl = pickHeroImageUrl(ad.type_data.assets);
  const counts = countAssets(ad.type_data.assets);

  const strengthCfg =
    AD_STRENGTH_BADGE_CONFIG[ad.type_data.adStrength] ??
    AD_STRENGTH_BADGE_CONFIG.UNKNOWN;

  // Asset counts hint — only render the segments that have items, so
  // an account with no videos doesn't show "0 فيديو" noise.
  const hintParts: string[] = [];
  if (counts.images > 0) hintParts.push(`${counts.images} صورة`);
  if (counts.videos > 0) hintParts.push(`${counts.videos} فيديو`);
  if (counts.headlines > 0) hintParts.push(`${counts.headlines} عنوان`);
  const countsHint = hintParts.join(" • ");

  return (
    <div
      className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition cursor-pointer"
      onClick={onClick}
    >
      <div className="aspect-square relative bg-gray-100 overflow-hidden">
        {heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImageUrl}
            alt={ad.name}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 text-indigo-600 p-4">
            <svg
              className="w-10 h-10 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <p className="text-xs font-semibold">Performance Max</p>
          </div>
        )}

        {/* Top-left: Performance Max identifier badge */}
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
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            PMax
          </span>
        </div>

        {/* Top-right: status badge (same shape as CreativeCard) */}
        <div className="absolute top-2 right-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              STATUS_COLORS[ad.status] ?? STATUS_COLORS.PAUSED
            }`}
          >
            {STATUS_LABELS_AR[ad.status] ?? ad.status}
          </span>
        </div>

        {/* Bottom-left: ad_strength chip (PMax-specific overlay) */}
        <div className="absolute bottom-2 left-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${strengthCfg.className}`}
          >
            {strengthCfg.label}
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
            {ad.hasConversionData && ad.roas !== null ? (
              <p className={`font-bold ${roasColor(ad.roas)}`}>
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
              <p className="font-bold text-gray-900">{ad.purchases}</p>
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
              {formatAndConvert(
                ad.spend,
                (ad.currency as Currency) || accountCurrency,
                displayCurrency
              )}
            </p>
          </div>
          {countsHint && (
            <div className="col-span-2 mt-1">
              <p className="text-[10px] text-gray-500">{countsHint}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

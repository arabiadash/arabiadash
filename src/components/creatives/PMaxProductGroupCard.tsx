import type { UnifiedAd } from "@/lib/ads/types";
import { formatCurrency, type Currency } from "@/lib/currency";

// =================================================================
// PMaxProductGroupCard — Phase 4.8 M-PMax / ADR-013 Commit 11
// =================================================================
//
// Renders the PMAX_PRODUCT_GROUP variant of UnifiedAd. New file in
// src/components/creatives/ — sibling to PMaxAssetGroupCard (Commit 10)
// and PMaxShoppingProductCard (this same commit).
//
// PMAX_PRODUCT_GROUP rows correspond to listing-group filter buckets
// in the retail PMax tree (per Q7 recon — see Phase 3 in pmax-recon-
// stage-2-3-2026-05-24.md). Visual emphasis on the dimension path
// breadcrumb + a ROAS-colored border per ADR-013 Decision 5.
//
// DRY note: MetricCell + formatCount + roasColorClass + the "—"
// fallback wording are duplicated from PMaxAssetGroupCard. Extraction
// to a shared module is deferred to the post-M-PMax Commit 9 phase
// per chat-approved discipline (premature consolidation after N=1
// example creates wrong-shape extraction debt).

type PMaxProductGroupAd = Extract<
  UnifiedAd,
  { ad_type: "PMAX_PRODUCT_GROUP" }
>;

type ProductGroupDimension =
  PMaxProductGroupAd["type_data"]["productGroupDimensionPath"][number];

type PMaxProductGroupCardProps = {
  ad: PMaxProductGroupAd;
  onClick?: (ad: UnifiedAd) => void;
};

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

// ROAS thresholds match ADR-013 Decision 5 retail product cards.
// Same numeric thresholds the existing inline CreativeCard uses for
// text color — here applied to the card's left border to match the
// ADR's "ROAS-colored borders" visual spec.
function roasBorderClass(
  roas: number | null,
  hasConversionData: boolean
): string {
  if (!hasConversionData || roas === null) return "border-gray-200";
  if (roas > 3) return "border-green-400";
  if (roas >= 1) return "border-yellow-400";
  return "border-red-400";
}

// Inline text-color variant for the ROAS metric cell itself — same
// thresholds, separate output (Tailwind doesn't compose colors across
// border vs text properties).
function roasTextColorClass(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

// -----------------------------------------------------------------
// Localization tables
// -----------------------------------------------------------------

// Extensible map — Google's listing-group dimension keys to Arabic
// labels. Unmapped keys fall through to the raw dimension string so
// the UI gracefully surfaces dimensions we haven't translated yet.
const DIMENSION_LABEL_AR: Record<string, string> = {
  product_item_id: "رقم المنتج",
  product_brand: "العلامة التجارية",
  product_category_level1: "الفئة الرئيسية",
  product_category_level2: "الفئة الفرعية",
  product_category_level3: "فئة المستوى الثالث",
  product_category_level4: "فئة المستوى الرابع",
  product_category_level5: "فئة المستوى الخامس",
  product_type_l1: "النوع",
  product_type_l2: "النوع الفرعي",
  product_type_l3: "نوع المستوى الثالث",
  product_type_l4: "نوع المستوى الرابع",
  product_type_l5: "نوع المستوى الخامس",
  product_condition: "حالة المنتج",
  product_channel: "القناة",
  product_channel_exclusivity: "حصرية القناة",
};

function localizeDimensionKey(key: string): string {
  return DIMENSION_LABEL_AR[key] ?? key;
}

// -----------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------

function DimensionPathBreadcrumb({
  path,
}: {
  path: ReadonlyArray<ProductGroupDimension>;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-800">
      {path.map((dim, idx) => {
        const arLabel = localizeDimensionKey(dim.dimension);
        const isSubdivision = dim.value === undefined;
        return (
          <li
            key={`${dim.dimension}-${idx}`}
            className="inline-flex items-center"
          >
            {isSubdivision ? (
              <span className="italic text-gray-600">
                ({arLabel}: تصنيف فرعي)
              </span>
            ) : (
              <span>
                <span className="text-gray-600">{arLabel}:</span>{" "}
                <span className="font-semibold">{dim.value}</span>
              </span>
            )}
            {idx < path.length - 1 && (
              <span aria-hidden className="mx-1.5 text-gray-400">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RootGroupHeader() {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold"
      >
        *
      </span>
      <span className="font-semibold text-gray-900">جميع المنتجات</span>
      <span className="text-[10px] text-gray-500">(جميع المنتجات)</span>
    </div>
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

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function PMaxProductGroupCard({
  ad,
  onClick,
}: PMaxProductGroupCardProps) {
  const currency: Currency = (ad.currency as Currency) ?? "USD";
  const formatSpend = (n: number) => formatCurrency(n, currency);
  const formatCount = (n: number) =>
    Math.round(n).toLocaleString("en-US");

  const purchaseAvailable = ad.hasConversionData && ad.purchases !== null;
  const revenueAvailable = ad.hasConversionData && ad.revenue !== null;
  const roasAvailable = ad.hasConversionData && ad.roas !== null;

  const borderClass = roasBorderClass(ad.roas, ad.hasConversionData);

  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(ad) : undefined}
      className={`w-full text-right bg-white border-2 ${borderClass} rounded-lg shadow-sm hover:shadow-md transition cursor-pointer`}
    >
      {/* Header: dimension breadcrumb (or root indicator) + asset group context */}
      <div className="p-3 border-b border-gray-100">
        {ad.type_data.isRootGroup ? (
          <RootGroupHeader />
        ) : (
          <DimensionPathBreadcrumb
            path={ad.type_data.productGroupDimensionPath}
          />
        )}
        {ad.type_data.assetGroupName && (
          <p className="text-[10px] text-gray-500 mt-1.5 truncate">
            ضمن: {ad.type_data.assetGroupName}
          </p>
        )}
      </div>

      {/* Metrics: 3-col × 2-row */}
      <div className="p-3">
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
            className={
              roasAvailable ? roasTextColorClass(ad.roas!) : undefined
            }
            unavailable={!roasAvailable}
          />
        </div>
      </div>
    </button>
  );
}

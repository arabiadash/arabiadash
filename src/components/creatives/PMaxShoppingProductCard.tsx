import type { UnifiedAd } from "@/lib/ads/types";
import { formatCurrency, type Currency } from "@/lib/currency";

// =================================================================
// PMaxShoppingProductCard — Phase 4.8 M-PMax / ADR-013 Commit 11
// =================================================================
//
// Renders the PMAX_SHOPPING_PRODUCT variant of UnifiedAd. New file in
// src/components/creatives/ — sibling to PMaxAssetGroupCard (Commit
// 10) and PMaxProductGroupCard (this same commit).
//
// PMAX_SHOPPING_PRODUCT rows correspond to individual Merchant Center
// products (SKU-level) from shopping_performance_view (per Q8 recon —
// see Phase 4 in pmax-recon-stage-2-3-2026-05-24.md). The component
// surfaces what the resource actually exposes (title / brand /
// category / type / condition); image, price, and listing-group
// cross-reference fields are deferred per ADR-013 Alternative 6.
//
// DRY note: MetricCell + formatCount + roasColorClass + the "—"
// fallback wording are duplicated from PMaxAssetGroupCard /
// PMaxProductGroupCard. Extraction to a shared module is deferred to
// the post-M-PMax Commit 9 phase per chat-approved discipline
// (premature consolidation after N=1 example creates wrong-shape
// extraction debt).

type PMaxShoppingProductAd = Extract<
  UnifiedAd,
  { ad_type: "PMAX_SHOPPING_PRODUCT" }
>;

type ProductCondition = NonNullable<
  PMaxShoppingProductAd["type_data"]["productCondition"]
>;

type PMaxShoppingProductCardProps = {
  ad: PMaxShoppingProductAd;
  onClick?: (ad: UnifiedAd) => void;
};

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function roasTextColorClass(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

// -----------------------------------------------------------------
// Localization tables
// -----------------------------------------------------------------

const PRODUCT_CONDITION_BADGE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  NEW: { label: "جديد", className: "bg-green-100 text-green-800" },
  USED: { label: "مستخدم", className: "bg-yellow-100 text-yellow-800" },
  REFURBISHED: {
    label: "مُجدّد",
    className: "bg-orange-100 text-orange-800",
  },
  UNKNOWN: { label: "غير محدد", className: "bg-gray-100 text-gray-600" },
  UNSPECIFIED: {
    label: "غير محدد",
    className: "bg-gray-100 text-gray-600",
  },
};

// -----------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------

function ProductConditionBadge({ condition }: { condition: ProductCondition }) {
  // Fallback covers the OTHER_${number} template-literal members of the
  // ProductCondition union (returned by readProductCondition when the
  // integer enum drifts) — they collapse to the UNKNOWN visual.
  const config =
    PRODUCT_CONDITION_BADGE_CONFIG[condition] ??
    PRODUCT_CONDITION_BADGE_CONFIG.UNKNOWN;
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${config.className}`}
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

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function PMaxShoppingProductCard({
  ad,
  onClick,
}: PMaxShoppingProductCardProps) {
  const currency: Currency = (ad.currency as Currency) ?? "USD";
  const formatSpend = (n: number) => formatCurrency(n, currency);
  const formatCount = (n: number) =>
    Math.round(n).toLocaleString("en-US");

  const purchaseAvailable = ad.hasConversionData && ad.purchases !== null;
  const revenueAvailable = ad.hasConversionData && ad.revenue !== null;
  const roasAvailable = ad.hasConversionData && ad.roas !== null;

  const {
    productId,
    productTitle,
    productBrand,
    productCategoryLevel1,
    productTypeL1,
    productCondition,
  } = ad.type_data;

  // Fall back to a stable identifier if Merchant Center didn't populate
  // a title — matches the fetchShoppingProducts (Commit 7) name-derivation
  // rule so this card displays the same heading as the rest of the app.
  const headingTitle = productTitle ?? `Product ${productId}`;

  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(ad) : undefined}
      className="w-full text-right bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-gray-300 transition cursor-pointer"
    >
      {/* Header: title + brand + condition badge */}
      <div className="p-3 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4
            className="font-semibold text-gray-900 text-sm line-clamp-2"
            title={headingTitle}
          >
            {headingTitle}
          </h4>
          {productBrand && (
            <p className="text-[10px] text-gray-600 mt-0.5 truncate">
              {productBrand}
            </p>
          )}
          {!productTitle && (
            // Diagnostic hint when the SKU has no Merchant Center title.
            // Real Saudi/Gulf ecommerce feeds populate this; imaa's
            // doesn't for some SKUs (Q8 recon).
            <p className="text-[10px] text-gray-400 italic mt-0.5">
              (لا يوجد عنوان في خلاصة Merchant Center)
            </p>
          )}
        </div>
        {productCondition && (
          <ProductConditionBadge condition={productCondition} />
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

      {/* Footer: category + type metadata (when feed populates them) */}
      {(productCategoryLevel1 || productTypeL1) && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 rounded-b-lg space-y-0.5">
          {productCategoryLevel1 && (
            <p className="text-[10px] text-gray-500 truncate" title={productCategoryLevel1}>
              <span className="font-medium">الفئة:</span> {productCategoryLevel1}
            </p>
          )}
          {productTypeL1 && (
            <p className="text-[10px] text-gray-500 truncate" title={productTypeL1}>
              <span className="font-medium">النوع:</span> {productTypeL1}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

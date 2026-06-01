import { useEffect } from "react";
import { Play, Camera } from "lucide-react";
import type { UnifiedAd } from "@/lib/ads/types";
import type { TikTokCreativeUrls } from "@/lib/tiktok/normalize";
import { formatAndConvert, formatCount, type Currency } from "@/lib/currency";

// =================================================================
// TikTokCreativeCard — TikTok variant (Phase 7 / ADR-020 §12c)
// =================================================================
//
// Renders TIKTOK_AD at the SAME visual size + shape as CreativeCard
// in ReportsClient.tsx so TikTok ads share grid rhythm with Meta and
// Google Search/Display variants when surfaced side-by-side. Detail
// view (caption, campaign ROAS, full video player, "View on TikTok"
// link, path-B/C diagnostics) lives in TikTokAdDetailModal (2d-3) —
// opened via onClick, mirroring PMaxAssetGroupCard's interaction model.
//
// Why no per-ad ROAS in the footer (unlike CreativeCard + PMax):
// TikTok's spend/revenue split between app pixel + web pixel surfaces
// is a per-CAMPAIGN concern (see ADR-020 §2b). Per-ad ROAS would mix
// the two attribution surfaces silently. ROAS is surfaced at the
// campaign level in the modal instead.
//
// 4-state dispatch (§12c §3):
//   1. LOADING            — urlsLoading=true (batch resolve in flight)
//   2. POSTER             — resolvedUrls set; show signed poster URL
//   3. EMBED_PLACEHOLDER  — urls null + tiktokVideoUrl set (path B
//                            without resolved URL, e.g. unauthorized
//                            Spark Ad). Modal can still embed via
//                            tiktok.com/player/v1/<item_id>.
//   4. PLACEHOLDER        — urls null + no tiktokVideoUrl (path C
//                            pure-image or UNKNOWN with no fallback).
//
// Status labels (STATUS_LABELS_AR) duplicate CreativeCard inline
// helpers — same DRY deferral rule as Commits 10/11 + PMax.

type TikTokAd = Extract<UnifiedAd, { ad_type: "TIKTOK_AD" }>;

interface TikTokCreativeCardProps {
  ad: TikTokAd;
  /**
   * Resolved signed URLs from the tiktok-url-resolve route. NEVER
   * cached at the parent level — the batch hook re-fetches on mount
   * + tab switch because the URLs expire in ~1 hour (§12c §2).
   * `null` means resolution returned no URL (path C, UNKNOWN, or
   * resolve-route returned null for this ad).
   */
  resolvedUrls: TikTokCreativeUrls | null;
  /** True while the batch resolve request is in flight. */
  urlsLoading: boolean;
  /**
   * Per-ad resolve error message, if any. Surfaced as a console.warn
   * signal only (no visual treatment in the card) — the card falls
   * through to embed/placeholder state on error. Errors that warrant
   * user action (e.g. reauth_required) are handled at the tab level
   * by the hook consumer.
   */
  urlError?: string;
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
  ARCHIVED: "bg-gray-100 text-gray-700",
};

const STATUS_LABELS_AR: Record<string, string> = {
  ACTIVE: "نشط",
  PAUSED: "موقوف",
  DELETED: "محذوف",
  ARCHIVED: "مؤرشف",
};

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function TikTokCreativeCard({
  ad,
  resolvedUrls,
  urlsLoading,
  urlError,
  accountCurrency,
  displayCurrency,
  onClick,
}: TikTokCreativeCardProps) {
  // Surface URL-resolve errors as a console signal so they show up in
  // dev/QA without polluting the user's grid. Reauth/rate-limit errors
  // are handled at the tab level by the hook consumer.
  useEffect(() => {
    if (urlError) {
      console.warn(
        `[TikTokCreativeCard] URL resolve error for ad ${ad.id} (${ad.name}): ${urlError}`
      );
    }
  }, [urlError, ad.id, ad.name]);

  // 4-state dispatch — exactly one of these is true.
  const hasPoster = !!resolvedUrls?.posterUrl;
  const hasEmbedFallback =
    !hasPoster && !urlsLoading && !!ad.type_data.tiktokVideoUrl;
  // Pure placeholder catches: path C without resolution, UNKNOWN, and
  // path-B errors where tiktokVideoUrl is also absent (rare).

  // Path-D DCO/SPC detection per ADR-020 §DCO-Identity. Mirrors the
  // dispatcher's path-D gate condition at normalize.ts:routeCreativeByIdentityType
  // (itemId truthy AND identityType falsy).
  const isDco = !!ad.type_data.tiktokItemId && !ad.type_data.identityType;

  const currency = (ad.currency as Currency) || accountCurrency;

  // ?? 0 is defensive — TikTok normalizer guarantees non-null for
  // both videoViews and purchases, but the field types remain
  // `number | undefined` for forward-compat with cached rows
  // pre-dating the v1 schema.
  const videoViews = ad.type_data.videoViews ?? 0;
  const purchases = ad.purchases ?? 0;

  return (
    <div
      className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition cursor-pointer"
      onClick={onClick}
    >
      <div className="aspect-square relative bg-gray-100 overflow-hidden">
        {urlsLoading ? (
          // STATE 1 — LOADING: skeleton gradient + ad name + pulse.
          // No spinner per design: animate-pulse on the whole tile is
          // less visually noisy across a grid of many cards.
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-fuchsia-50 to-rose-50 text-fuchsia-700 p-4 animate-pulse">
            <Play className="w-10 h-10 mb-2 opacity-60" />
            <p className="text-[10px] text-center line-clamp-2 opacity-70">
              {ad.name}
            </p>
          </div>
        ) : hasPoster ? (
          // STATE 2 — POSTER: signed URL from tiktok-url-resolve.
          // object-center crop ensures faces/products in vertical 9:16
          // posters stay centered when squeezed into aspect-square.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolvedUrls.posterUrl}
            alt={ad.name}
            className="w-full h-full object-cover object-center group-hover:scale-105 transition duration-300"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : hasEmbedFallback ? (
          // STATE 3 — EMBED_PLACEHOLDER: poster missing but the ad has
          // a public tiktok.com URL (path B Spark Ad). Modal can embed
          // tiktok.com/player/v1/<item_id> as the fallback player.
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-fuchsia-50 to-rose-50 text-fuchsia-700 p-4">
            <Play className="w-10 h-10 mb-2" />
            <p className="text-[10px] text-center line-clamp-2">{ad.name}</p>
          </div>
        ) : (
          // STATE 4 — PLACEHOLDER: no poster, no embed fallback. Path C
          // pure-image with unresolved image_ids, or UNKNOWN ad shape.
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-fuchsia-50 to-rose-50 text-fuchsia-700 p-4">
            <Camera className="w-10 h-10 mb-2 opacity-70" />
            <p className="text-[10px] text-center opacity-80">
              صورة الإعلان غير متوفرة في المعاينة
            </p>
          </div>
        )}

        {/* Play overlay — only on the POSTER state, to hint that the
            card opens a video player in the modal. Subtle scrim so it
            doesn't compete with the poster art. */}
        {hasPoster && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}

        {/* Top-left: TikTok identifier badge — text, not SVG logo, per
            design spec. Pink/fuchsia gradient mirrors TikTok's brand
            palette without copying the trademarked logo. Path-D DCO ads
            get a sibling "إعلان ديناميكي" chip so the user can tell at
            a glance these are dynamic-creative auto-assembled ads. */}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="px-2 py-0.5 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white rounded text-[10px] font-semibold">
            TikTok
          </span>
          {isDco && (
            <span className="px-2 py-0.5 bg-white/90 text-fuchsia-700 border border-fuchsia-200 rounded text-[10px] font-semibold">
              إعلان ديناميكي
            </span>
          )}
        </div>

        {/* Top-right: status badge (same shape as CreativeCard) */}
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
          <span className="min-w-0 truncate">{ad.name}</span>
        </h4>
        {resolvedUrls?.creatorHandle && (
          <p className="text-[10px] text-gray-500 -mt-1 mb-2 truncate">
            @{resolvedUrls.creatorHandle}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-gray-500 text-[10px]">المشاهدات</p>
            <p className="font-bold text-gray-900">{formatCount(videoViews)}</p>
          </div>
          <div className="text-left">
            <p className="text-gray-500 text-[10px]">المبيعات</p>
            <p className="font-bold text-gray-900">{formatCount(purchases)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-gray-500 text-[10px]">الإنفاق</p>
            <p className="font-bold text-gray-900">
              {formatAndConvert(ad.spend, currency, displayCurrency)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { X, Play, Camera, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import type { UnifiedAd } from "@/lib/ads/types";
import { formatAndConvert, formatCount, type Currency } from "@/lib/currency";
import { useTiktokCreativeUrl } from "@/lib/hooks/use-tiktok-creative-urls";

// =================================================================
// TikTokAdDetailModal — TikTok variant (Phase 7 / ADR-020 §12c)
// =================================================================
//
// Detail modal for TIKTOK_AD rows. Reached via the early-branch
// dispatch at the top of AdDetailModal (ReportsClient.tsx), mirroring
// the PMaxAssetGroupModalContent precedent.
//
// Why a dedicated modal instead of widening AdDetailModal's narrowing:
//   - 9:16 vertical video player (vs 16:9 Meta video / 1:1 catalog)
//   - On-mount async URL fetch via useTiktokCreativeUrl — fresh signed
//     URL on every modal open (§12c §2: ~1 hour TTL)
//   - 3-path media dispatch (resolved → embed → placeholder) with
//     iframe security attrs the rest of the modal doesn't need
//   - Campaign-level ROAS (NOT per-ad) per §2b — TikTok's app/web pixel
//     attribution split makes per-ad ROAS misleading
//
// 3-path media dispatch (matches card's 4-state, with embed taking
// over for "no resolved URL but has tiktok.com URL"):
//   A/B (resolved)        → <video> tag, click-to-play with controls
//   UNKNOWN+tiktokVideoUrl → <iframe> tiktok.com/player/v1/<item_id>
//   no urls + no embed    → placeholder gradient + Arabic message
//
// Status labels duplicate CreativeCard inline helpers — same DRY
// deferral as TikTokCreativeCard + PMaxAssetGroupCard.

type TikTokAd = Extract<UnifiedAd, { ad_type: "TIKTOK_AD" }>;

interface TikTokAdDetailModalProps {
  ad: TikTokAd;
  accountCurrency: Currency;
  displayCurrency: Currency;
  onClose: () => void;
  /**
   * Per-CAMPAIGN ROAS for the ad's parent campaign. Per §2b TikTok's
   * spend/revenue split between app pixel + web pixel surfaces is a
   * per-CAMPAIGN concern; per-ad ROAS would mix the two surfaces
   * silently. Null when:
   *   - The campaign has no purchase conversions in window
   *   - 2d-4 hasn't wired the real lookup yet (current state)
   * Rendered as em-dash + tooltip when null.
   */
  campaignRoas: number | null;
}

// -----------------------------------------------------------------
// Localization + visual config (mirrors CreativeCard/PMax inline tables)
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

// ROAS color thresholds — same as CreativeCard's getROASColor / PMax's
// roasColor. Inlined here to avoid the circular-import risk when 2d-4
// makes ReportsClient.tsx import this modal.
function roasColor(roas: number): string {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-600";
}

// -----------------------------------------------------------------
// Main component
// -----------------------------------------------------------------

export function TikTokAdDetailModal({
  ad,
  accountCurrency,
  displayCurrency,
  onClose,
  campaignRoas,
}: TikTokAdDetailModalProps) {
  // Fresh signed-URL fetch on modal mount. Hook unmount (modal close)
  // aborts in-flight request via AbortController. enabled=true is the
  // default but spelled out for symmetry with the keywords + search-
  // terms hooks elsewhere in the modal layer.
  const {
    urls,
    loading: urlsLoading,
    error: urlError,
    refresh,
  } = useTiktokCreativeUrl({
    accountId: ad.accountId ?? "",
    ad,
    enabled: true,
  });

  const currency = (ad.currency as Currency) || accountCurrency;
  const videoViews = ad.type_data.videoViews ?? 0;
  const purchases = ad.purchases ?? 0;

  // 3-path media dispatch — first match wins.
  const hasResolvedVideo = !urlsLoading && !!urls?.playableUrl;
  const hasEmbedFallback =
    !urlsLoading && !urls && !!ad.type_data.tiktokVideoUrl;
  // Final fallback = no resolved video, no embed URL (path C deferred
  // or UNKNOWN with no public tiktok.com URL).

  // Badge type derivation — mirrors TikTokCreativeCard.tsx (2026-06-01
  // unified design). Both gate on !videoId to exclude direct uploads
  // (path A gets no sub-badge per the user's spec).
  const isDco =
    !ad.type_data.videoId &&
    !!ad.type_data.tiktokItemId &&
    !ad.type_data.identityType;
  const isSpark =
    !ad.type_data.videoId &&
    !!ad.type_data.tiktokItemId &&
    !!ad.type_data.identityType;

  // "View on TikTok" link — render whenever the ad has a public
  // tiktok.com URL, regardless of resolve state. Covers paths B + any
  // UNKNOWN ad that carried tiktok_item_id.
  const tiktokExternalUrl = ad.type_data.tiktokVideoUrl;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — matches AdDetailModal pattern */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white rounded text-[10px] font-semibold">
              TikTok
            </span>
            {isSpark && (
              <span className="px-2 py-0.5 bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 rounded text-[10px] font-semibold">
                سبارك
              </span>
            )}
            {isDco && (
              <span className="px-2 py-0.5 bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 rounded text-[10px] font-semibold">
                سمارت
              </span>
            )}
            <h3 className="font-bold text-gray-900 text-lg">تفاصيل الإعلان</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {/* -----------------------------------------------------------
              Media block — vertical 9:16 friendly. max-w-sm wrapper
              centers the player inside the wider modal so the rest
              (metrics, caption) uses full width.
              ----------------------------------------------------------- */}
          <div className="mx-auto max-w-sm">
            <div className="aspect-[9/16] relative bg-black rounded-lg overflow-hidden">
              {urlsLoading ? (
                // STATE 1 — LOADING
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-fuchsia-50 to-rose-50 text-fuchsia-700 p-4">
                  <Loader2 className="w-10 h-10 mb-3 animate-spin" />
                  <p className="text-xs">جاري تحميل المعاينة...</p>
                </div>
              ) : hasResolvedVideo ? (
                // STATE 2 — RESOLVED VIDEO (paths A + B)
                // controls + preload="metadata" → click-to-play, no
                // autoplay (intentional: many ads in a row would all
                // hammer the bandwidth + violate browser autoplay
                // policies).
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={urls.playableUrl}
                  poster={urls.posterUrl}
                  controls
                  preload="metadata"
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
              ) : hasEmbedFallback ? (
                // STATE 3 — EMBED FALLBACK (tiktok.com/player/v1/<id>)
                // Iframe security per Decision 2:
                //   - allow: minimum-needed player permissions (no
                //     accelerometer/gyroscope/clipboard — not used in
                //     non-fullscreen embed)
                //   - sandbox: scripts + same-origin + popups (player
                //     UI needs all three); explicitly NO
                //     allow-top-navigation (iframe can't redirect us)
                //     and NO allow-forms (player has none)
                //   - referrerPolicy: strict-origin-when-cross-origin
                //     (sends only origin, never path/query)
                //   - loading=lazy (defer fetch until in viewport)
                <iframe
                  src={tiktokExternalUrl}
                  allow="autoplay; encrypted-media; picture-in-picture; web-share"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                  title={`TikTok video preview: ${ad.name}`}
                  className="w-full h-full"
                />
              ) : (
                // STATE 4 — PLACEHOLDER (path C deferred, or UNKNOWN
                // with no tiktok.com URL). landingPageUrl link
                // intentionally omitted — not threaded into
                // UnifiedAdTiktok.type_data per 2b-2; would be scope
                // creep mid-modal to add now.
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-50 via-fuchsia-50 to-rose-50 text-fuchsia-700 p-6">
                  <Camera className="w-12 h-12 mb-3 opacity-70" />
                  <p className="text-xs text-center opacity-80 leading-relaxed">
                    صورة الإعلان غير متوفرة في المعاينة
                  </p>
                </div>
              )}
            </div>

            {/* Creator byline — populated by path-D oEmbed lookup per
                ADR-020 §DCO-Identity. Player-adjacent (under video,
                above CTA) so the user sees who MADE the content next
                to the content itself. Hidden when no creator data
                (paths A/B/C/UNKNOWN never populate these fields). */}
            {urls?.creatorName && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-gray-500 text-xs flex-shrink-0">
                  المنشئ:
                </span>
                <span className="font-medium text-gray-900 truncate">
                  {urls.creatorName}
                </span>
                {urls.creatorHandle &&
                  (urls.creatorUrl ? (
                    <a
                      href={urls.creatorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-fuchsia-700 hover:underline truncate flex-shrink-0"
                    >
                      @{urls.creatorHandle}
                    </a>
                  ) : (
                    <span className="text-xs text-gray-500 truncate flex-shrink-0">
                      @{urls.creatorHandle}
                    </span>
                  ))}
              </div>
            )}

            {/* "View on TikTok" external link — beneath the player.
                Renders whenever a public tiktok.com URL exists, even
                in the resolved-video state (lets users jump to the
                source post). */}
            {tiktokExternalUrl && (
              <a
                href={tiktokExternalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white text-xs font-semibold rounded-lg hover:opacity-90 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                مشاهدة على TikTok
              </a>
            )}
          </div>

          {/* -----------------------------------------------------------
              URL-resolve error banners — visible above the metadata
              so users see them immediately. Each state gets its own
              treatment (reauth = red no-retry; rate-limit = yellow
              retry; generic = gray retry).
              ----------------------------------------------------------- */}
          {urlError === "reauth_required" && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 leading-relaxed">
                انتهت صلاحية ربط حساب TikTok — أعد الربط من الإعدادات
              </p>
            </div>
          )}
          {urlError === "rate_limited" && (
            <div className="flex items-start justify-between gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-800 leading-relaxed">
                  تم تجاوز حد الطلبات — حاول مرة أخرى بعد قليل
                </p>
              </div>
              <button
                onClick={() => refresh()}
                className="text-xs text-yellow-800 hover:underline whitespace-nowrap"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
          {urlError === "fetch_failed" && (
            <div className="flex items-start justify-between gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-gray-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 leading-relaxed">
                  تعذّر تحميل معاينة الإعلان
                </p>
              </div>
              <button
                onClick={() => refresh()}
                className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* -----------------------------------------------------------
              Ad name + status + campaign context
              ----------------------------------------------------------- */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500 mb-1">اسم الإعلان</p>
              <h4 className="font-semibold text-gray-900">{ad.name}</h4>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                STATUS_COLORS[ad.status] ?? STATUS_COLORS.ARCHIVED
              }`}
            >
              {STATUS_LABELS_AR[ad.status] ?? ad.status}
            </span>
          </div>

          {(ad.campaignName || ad.adsetName) && (
            <div>
              <p className="text-xs text-gray-500 mb-1">الحملة / المجموعة</p>
              <p className="text-sm text-gray-700">
                {ad.campaignName ?? "—"}
                {ad.adsetName ? ` / ${ad.adsetName}` : ""}
              </p>
            </div>
          )}

          {/* -----------------------------------------------------------
              Path B bonus fields — caption + itemType + authStatus.
              Each is independently optional; we render only what's
              present. Visual language mirrors M6 sitelinks / structured
              snippets chips (purple/emerald) for consistency.
              ----------------------------------------------------------- */}
          {urls?.caption && (
            <div>
              <p className="text-xs text-gray-500 mb-1">نص المنشور</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {urls.caption}
              </p>
            </div>
          )}

          {(urls?.itemType || urls?.authStatus) && (
            <div className="flex flex-wrap gap-2">
              {urls.itemType && (
                <span className="inline-block bg-purple-50 text-purple-700 px-2.5 py-1 rounded text-[10px] border border-purple-100">
                  نوع المنشور: {urls.itemType}
                </span>
              )}
              {urls.authStatus && (
                <span className="inline-block bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-[10px] border border-emerald-100">
                  حالة الترخيص: {urls.authStatus}
                </span>
              )}
            </div>
          )}

          {/* -----------------------------------------------------------
              Performance metrics — 6-cell grid mirrors AdDetailModal
              visual language but shifted for TikTok semantics:
                row 1: المشاهدات / المبيعات / الإنفاق
                row 2: CTR / CPC / ROAS (campaign-level)
              No per-ad revenue or ROAS — §2b reasoning.
              ----------------------------------------------------------- */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 mb-3">
              الأداء في الفترة المختارة
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">المشاهدات</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatCount(videoViews)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">المبيعات</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatCount(purchases)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">الإنفاق</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatAndConvert(ad.spend, currency, displayCurrency)}
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
                  {formatAndConvert(ad.cpc, currency, displayCurrency)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs text-gray-500">ROAS</p>
                  <p className="text-[10px] text-gray-500">على مستوى الحملة</p>
                </div>
                {campaignRoas !== null ? (
                  <p className={`text-lg font-bold ${roasColor(campaignRoas)}`}>
                    {campaignRoas.toFixed(2)}x
                  </p>
                ) : (
                  <p
                    className="text-lg font-bold text-gray-400"
                    title="ROAS غير متوفر على مستوى الإعلان من TikTok — متوفر على مستوى الحملة"
                  >
                    —
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

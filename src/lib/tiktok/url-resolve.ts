/**
 * Shared types + builder for the /api/ads/creatives/tiktok-url-resolve
 * route + the useTiktokCreativeUrls hooks per ADR-020 §12c §2.
 *
 * Single source of truth for the AdResolveRequest payload shape — the
 * route validates against it, the hook builds it from UnifiedAdTiktok.
 * Drift between the two would reintroduce the kind of bug that bit us
 * with `total_purchase_value` vs `total_complete_payment_rate`
 * (parallel type definitions → silent divergence). The shared module
 * prevents that.
 *
 * Pure types + 1 builder function — no I/O, no React, runtime-free
 * (the builder is sync + pure). Importable from server (route) AND
 * client (hook) code.
 */

import type { UnifiedAdTiktok } from "@/lib/ads/types";
import {
  routeCreativeByIdentityType,
  type TikTokCreativePath,
} from "./normalize";

/**
 * Path-routing discriminator union. Re-exported as the SAME union the
 * dispatcher in normalize.ts uses, so any future addition to
 * TikTokCreativePath (e.g. when path C goes live) automatically widens
 * the route's accepted kinds + the hook's payload type — no parallel
 * lists to keep in sync.
 */
export type CreativeKind = TikTokCreativePath["kind"];

/**
 * Wire payload for /api/ads/creatives/tiktok-url-resolve.
 *
 * Both forms of the route consume this shape:
 *   - GET form: each field becomes a query param (kind + ad_id +
 *     optional video_id / item_id / identity_type / identity_id)
 *   - POST form: each entry of body.ads[] has this shape
 *
 * Discriminator-field validity is enforced by the route's
 * validateAdRequest:
 *   kind=A_DIRECT_VIDEO        → video_id required
 *   kind=B_SPARK_AD            → item_id + identity_type + identity_id all required
 *   kind=D_DCO_OEMBED          → item_id required (no identity — that's the point)
 *   kind=C_PURE_IMAGE_DEFERRED → no extra fields required
 *   kind=UNKNOWN               → no extra fields required
 *
 * Client callers MUST go through `buildAdResolveRequest` to guarantee
 * the kind↔fields invariant matches the dispatcher in normalize.ts.
 */
export interface AdResolveRequest {
  ad_id: string;
  kind: CreativeKind;
  video_id?: string;
  item_id?: string;
  identity_type?: string;
  identity_id?: string;
}

/**
 * Build an AdResolveRequest from a UnifiedAdTiktok.
 *
 * Wraps `routeCreativeByIdentityType` (the dispatcher in normalize.ts)
 * into the route's payload shape. The dispatcher already enforces the
 * kind↔IDs invariant; this builder is a pure shape translation.
 *
 * Both callers (the React hooks for client-side building, plus any
 * future server-side caller) get the same routing logic — no
 * duplication, no drift.
 */
export function buildAdResolveRequest(ad: UnifiedAdTiktok): AdResolveRequest {
  const path = routeCreativeByIdentityType(ad.type_data);
  switch (path.kind) {
    case "A_DIRECT_VIDEO":
      return {
        ad_id: ad.id,
        kind: "A_DIRECT_VIDEO",
        video_id: path.videoId,
      };
    case "B_SPARK_AD":
      return {
        ad_id: ad.id,
        kind: "B_SPARK_AD",
        item_id: path.itemId,
        identity_type: path.identityType,
        identity_id: path.identityId,
      };
    case "D_DCO_OEMBED":
      return {
        ad_id: ad.id,
        kind: "D_DCO_OEMBED",
        item_id: path.itemId,
      };
    case "C_PURE_IMAGE_DEFERRED":
      return {
        ad_id: ad.id,
        kind: "C_PURE_IMAGE_DEFERRED",
      };
    case "UNKNOWN":
      return {
        ad_id: ad.id,
        kind: "UNKNOWN",
      };
  }
}

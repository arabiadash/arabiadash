import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * THROWAWAY — Vercel-side TikTok oEmbed reachability probe.
 *
 * Purpose: confirm the production runtime (Vercel serverless, non-Saudi
 * egress) can reach https://www.tiktok.com/oembed and recover a thumbnail
 * for a known DCO/SPC ad's tiktok_item_id. If this returns 200 + thumbnail,
 * Path-D resolver is production-viable for ADR-020 §DCO-Identity.
 *
 * Target item_id 7635328220438613269 = IMAA "_001" ad with 740K views,
 * confirmed via local probe (scripts/_tiktok-oembed-probe.mts) to return
 * author "موسى بن ابراهيم 🇸🇦" + 576×1024 thumbnail through WARP.
 *
 * Probe captures: HTTP status, Vercel region/env, latency, thumbnail
 * presence + URL, author display name + handle, response cache headers.
 *
 * DELETE this route after the probe result is captured in the ADR. Not
 * a long-lived endpoint, not auth-gated — throwaway one-shot diagnostic.
 */
export async function GET() {
  const TARGET_ITEM_ID = "7635328220438613269";
  const url = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@_/video/${TARGET_ITEM_ID}`;

  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArabiaDashOEmbedProbe/1.0)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const elapsedMs = Date.now() - t0;
    const ctype = r.headers.get("content-type") ?? "";
    const isJson = ctype.includes("json");
    const body: unknown = isJson ? await r.json() : await r.text();
    const obj = (isJson && body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const thumb = typeof obj.thumbnail_url === "string" ? obj.thumbnail_url : undefined;

    return NextResponse.json({
      ok: r.ok && !!thumb,
      vercelRegion: process.env.VERCEL_REGION ?? "(not on vercel)",
      vercelEnv: process.env.VERCEL_ENV ?? "(local)",
      elapsedMs,
      probedAt: new Date().toISOString(),
      target: { itemId: TARGET_ITEM_ID, url },
      response: {
        status: r.status,
        statusText: r.statusText,
        contentType: ctype,
        cacheControl: r.headers.get("cache-control"),
      },
      result: isJson
        ? {
            hasThumbnail: !!thumb,
            thumbnailUrl: thumb ?? null,
            thumbnailWidth: obj.thumbnail_width ?? null,
            thumbnailHeight: obj.thumbnail_height ?? null,
            authorName: typeof obj.author_name === "string" ? obj.author_name : null,
            authorHandle: typeof obj.author_unique_id === "string" ? obj.author_unique_id : null,
            title: typeof obj.title === "string" ? obj.title : null,
          }
        : { rawBodyPreview: String(body).slice(0, 300) },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        vercelRegion: process.env.VERCEL_REGION ?? "(not on vercel)",
        vercelEnv: process.env.VERCEL_ENV ?? "(local)",
        elapsedMs: Date.now() - t0,
        probedAt: new Date().toISOString(),
        target: { itemId: TARGET_ITEM_ID, url },
        error:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { name: "Unknown", message: String(err) },
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVideoSource } from "@/lib/meta/api";

export async function GET(request: NextRequest) {
  try {
    const videoId = request.nextUrl.searchParams.get("video_id");

    if (!videoId) {
      return NextResponse.json(
        { error: "missing_video_id" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: connection } = await supabase
      .from("connections")
      .select("access_token")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("status", "active")
      .maybeSingle();

    if (!connection?.access_token) {
      return NextResponse.json(
        { error: "no_connection" },
        { status: 404 }
      );
    }

    const result = await getVideoSource(connection.access_token, videoId);

    if (!result.source && !result.permalinkUrl) {
      return NextResponse.json(
        { error: "video_not_available" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ads/video-source] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}

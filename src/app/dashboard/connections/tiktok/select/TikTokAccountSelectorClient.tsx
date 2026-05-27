"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface DiscoverableAdvertiser {
  advertiser_id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  country: string | null;
  status: string;
  is_already_connected: boolean;
}

interface PlanInfo {
  current: number;
  limit: number;
  remaining: number;
  tier: string;
}

interface Props {
  initialWorkspaceId: number | null;
  fromOAuth: boolean;
}

const TIER_LABELS: Record<string, string> = {
  trial: "تجربة مجانية",
  starter: "أساسية",
  growth: "نمو",
  agency: "وكالات",
};

/**
 * TikTok advertiser selector. Mirrors GoogleAccountSelectorClient
 * structure per ADR-020 §Decision 5 (industry-standard account
 * selection flow from ADR-010).
 */
export default function TikTokAccountSelectorClient({
  initialWorkspaceId,
  fromOAuth,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [advertisers, setAdvertisers] = useState<DiscoverableAdvertiser[]>([]);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [discoverRes, planRes] = await Promise.all([
          fetch("/api/auth/tiktok/discover"),
          fetch("/api/plans/limits"),
        ]);

        if (cancelled) return;

        if (!discoverRes.ok) {
          const errData = await discoverRes.json().catch(() => ({}));
          if (errData.error === "no_oauth_token") {
            setError(
              "لم يتم العثور على ربط مع TikTok. الرجاء البدء من صفحة ربط المنصات."
            );
          } else {
            setError("فشل تحميل حسابات TikTok. حاول مرة أخرى.");
          }
          return;
        }

        const discoverData = await discoverRes.json();
        const fetched: DiscoverableAdvertiser[] =
          discoverData.advertisers ?? [];
        setAdvertisers(fetched);

        if (planRes.ok) {
          const planData = await planRes.json();
          setPlanInfo({
            current: planData.current ?? 0,
            limit: planData.limit ?? 0,
            remaining: planData.remaining ?? 0,
            tier: planData.tier ?? "trial",
          });
        }

        // Pre-select already-active advertisers.
        const alreadyConnected = fetched
          .filter((a) => a.is_already_connected)
          .map((a) => a.advertiser_id);
        setSelected(new Set(alreadyConnected));
      } catch (err) {
        if (cancelled) return;
        console.error("[tiktok-selector] load error:", err);
        setError("خطأ غير متوقع. حاول مرة أخرى.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAdvertiser = (id: string, disabled: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Only newly-selected advertisers count toward the plan budget.
  const newlySelected = useMemo(() => {
    return Array.from(selected).filter(
      (id) =>
        !advertisers.find((a) => a.advertiser_id === id)?.is_already_connected
    );
  }, [selected, advertisers]);

  const canSelectMore = useMemo(() => {
    if (!planInfo) return true;
    if (!Number.isFinite(planInfo.limit)) return true;
    return planInfo.current + newlySelected.length < planInfo.limit;
  }, [planInfo, newlySelected]);

  const limitReached = !canSelectMore;

  async function handleSubmit() {
    if (newlySelected.length === 0) {
      router.push("/dashboard/connections");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/tiktok/select-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiser_ids: newlySelected,
          workspace_id: initialWorkspaceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "plan_limit_exceeded") {
          setError(data.message ?? `حد الخطة: ${data.limit} حسابات`);
        } else {
          setError("فشل حفظ الاختيار. حاول مرة أخرى.");
        }
        setSubmitting(false);
        return;
      }
      router.push(
        `/dashboard/connections?success=tiktok_accounts_added&count=${newlySelected.length}`
      );
    } catch (err) {
      console.error("[tiktok-selector] submit error:", err);
      setError("خطأ غير متوقع. حاول مرة أخرى.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div
        className="min-h-screen bg-gray-50 p-6 flex items-center justify-center"
        dir="rtl"
      >
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل حسابات TikTok...</span>
        </div>
      </div>
    );
  }

  if (error && advertisers.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" dir="rtl">
        <div className="max-w-2xl mx-auto rounded-xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
            <div>
              <p className="text-red-900 font-semibold mb-2">
                تعذّر تحميل الحسابات
              </p>
              <p className="text-red-800 text-sm mb-4">{error}</p>
              <Link
                href="/dashboard/connections"
                className="inline-flex items-center gap-2 text-sm text-red-700 underline hover:text-red-900"
              >
                <ArrowLeft className="w-4 h-4" />
                العودة لربط المنصات
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tierLabel = planInfo ? TIER_LABELS[planInfo.tier] ?? planInfo.tier : "";
  const progressPct =
    planInfo && Number.isFinite(planInfo.limit)
      ? Math.min(
          100,
          ((planInfo.current + newlySelected.length) / planInfo.limit) * 100
        )
      : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/dashboard/connections"
          className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          العودة لربط المنصات
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TT</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
              اختر حسابات TikTok Ads
            </h1>
          </div>
          <p className="text-sm sm:text-base text-gray-600">
            {fromOAuth
              ? "تم الربط بنجاح! اختر حسابات الإعلانات التي تريد استيرادها إلى ArabiaDash."
              : "اختر حسابات TikTok الإضافية التي تريد إضافتها."}
          </p>
        </div>

        {/* Plan-limit progress card */}
        {planInfo && Number.isFinite(planInfo.limit) && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  خطتك: {tierLabel}
                </p>
                <p className="text-xs text-blue-700 mt-0.5">
                  {planInfo.current + newlySelected.length} من {planInfo.limit}{" "}
                  حسابات
                </p>
              </div>
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {limitReached && (
                  <Link
                    href="/dashboard/settings"
                    className="text-xs text-blue-700 underline mt-2 inline-block"
                  >
                    ترقية الخطة
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Advertiser list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {advertisers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-sm">لا توجد حسابات TikTok مرتبطة بهذا الربط.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {advertisers.map((adv) => {
                const isSelected = selected.has(adv.advertiser_id);
                const isAlready = adv.is_already_connected;
                const wouldExceedLimit =
                  !isSelected && !isAlready && limitReached;
                const disabled = wouldExceedLimit;
                return (
                  <li
                    key={adv.advertiser_id}
                    onClick={() =>
                      toggleAdvertiser(adv.advertiser_id, disabled)
                    }
                    className={`px-4 sm:px-6 py-4 flex items-center gap-4 cursor-pointer transition ${
                      disabled
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      disabled={disabled}
                      className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">
                          {adv.name || `Advertiser ${adv.advertiser_id}`}
                        </p>
                        {isAlready && (
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] px-1.5 py-0.5 rounded">
                            <CheckCircle2 className="w-3 h-3" />
                            مرتبط
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        ID: {adv.advertiser_id}
                        {adv.currency ? ` · ${adv.currency}` : ""}
                        {adv.country ? ` · ${adv.country}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/dashboard/connections"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            إلغاء
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting || newlySelected.length === 0}
            className="inline-flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {newlySelected.length > 0
              ? `إضافة ${newlySelected.length} حساب`
              : "تخطي"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface DiscoverableAccount {
  account_id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  is_manager: boolean;
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

export default function GoogleAccountSelectorClient({
  initialWorkspaceId,
  fromOAuth,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<DiscoverableAccount[]>([]);
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
          fetch("/api/google-ads/discover"),
          fetch("/api/plans/limits"),
        ]);

        if (cancelled) return;

        if (!discoverRes.ok) {
          const errData = await discoverRes.json().catch(() => ({}));
          if (errData.error === "reauth_required") {
            // Discover route surfaced reauth state (#46 fix). The render
            // branch below detects this sentinel and shows the one-click
            // recovery banner inline. Same target as the Reports banner
            // (#47): /api/google-ads/auth?workspace=X.
            setError("reauth_required");
          } else if (errData.error === "no_oauth_token") {
            setError(
              "لم يتم العثور على ربط مع Google. الرجاء البدء من صفحة ربط المنصات."
            );
          } else {
            setError("فشل تحميل الحسابات. حاول مرة أخرى.");
          }
          return;
        }

        const discoverData = await discoverRes.json();
        const fetched: DiscoverableAccount[] = discoverData.accounts ?? [];
        setAccounts(fetched);

        if (planRes.ok) {
          const planData = await planRes.json();
          setPlanInfo({
            current: planData.current ?? 0,
            limit: planData.limit ?? 0,
            remaining: planData.remaining ?? 0,
            tier: planData.tier ?? "trial",
          });
        }

        // Pre-select accounts already active in DB so the user can see
        // their existing selection and just add/remove.
        const alreadyConnected = fetched
          .filter((a) => a.is_already_connected)
          .map((a) => a.account_id);
        setSelected(new Set(alreadyConnected));
      } catch (err) {
        if (cancelled) return;
        console.error("[selector] load error:", err);
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

  const toggleAccount = (id: string, disabled: boolean) => {
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

  // Only accounts that aren't already-active count toward the
  // remaining plan budget — re-selecting an already-active account
  // doesn't change the total.
  const newlySelected = useMemo(() => {
    return Array.from(selected).filter(
      (id) => !accounts.find((a) => a.account_id === id)?.is_already_connected
    );
  }, [selected, accounts]);

  // Limit gate: how many MORE new ones can the user still add?
  const canSelectMore = useMemo(() => {
    if (!planInfo) return true;
    if (planInfo.limit === null || planInfo.limit === undefined) return true;
    // limit could be Infinity (agency tier) — JSON encodes Infinity as null,
    // so the server must serialize it as a number or sentinel. Our API
    // returns Infinity → JSON treats it as null. Treat null as unlimited.
    if (!Number.isFinite(planInfo.limit)) return true;
    return planInfo.current + newlySelected.length < planInfo.limit;
  }, [planInfo, newlySelected]);

  const limitReached = !canSelectMore;

  async function handleSubmit() {
    if (newlySelected.length === 0) {
      router.push("/dashboard/connections/google");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/google-ads/select-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: newlySelected,
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
        `/dashboard/connections/google?success=accounts_added&count=${newlySelected.length}`
      );
    } catch (err) {
      console.error("[selector] submit error:", err);
      setError("خطأ غير متوقع. حاول مرة أخرى.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center" dir="rtl">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل الحسابات...</span>
        </div>
      </div>
    );
  }

  if (error === "reauth_required") {
    // ADR-017 reauth banner — fires when /api/google-ads/discover returns
    // 401 + reauth_required (#46). CTA points directly to the one-step
    // OAuth init, matching the Reports tab banner (#47). If
    // initialWorkspaceId is null (someone direct-URLs /select without a
    // workspace param), fall back to the connections page where the
    // user's default workspace is resolved.
    // Consider extracting to <GoogleReauthBanner workspaceId={X}/> when
    // #48/#49 add more occurrences (currently 2 inline copies).
    return (
      <div className="min-h-screen bg-gray-50 p-6" dir="rtl">
        <div className="max-w-2xl mx-auto rounded-xl border-2 border-amber-400 bg-amber-50 p-6">
          <h3 className="font-bold text-amber-900 mb-2">إعادة ربط حساب Google مطلوبة</h3>
          <p className="text-sm text-amber-800 mb-4">
            انتهت صلاحية الربط مع Google Ads. اضغط على الزر أدناه لإعادة الربط لإتمام إضافة الحساب.
          </p>
          <a
            href={
              initialWorkspaceId
                ? `/api/google-ads/auth?workspace=${initialWorkspaceId}`
                : "/dashboard/connections/google"
            }
            className="inline-block px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-semibold"
          >
            أعد ربط حساب Google
          </a>
        </div>
      </div>
    );
  }

  if (error && accounts.length === 0) {
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

  const tierLabel = planInfo ? (TIER_LABELS[planInfo.tier] ?? planInfo.tier) : "";
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
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <span className="text-red-600 font-bold text-lg">G</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
              اختر حسابات Google Ads
            </h1>
          </div>
          <p className="text-sm sm:text-base text-gray-600">
            {fromOAuth
              ? "تم الربط بنجاح! اختر الحسابات التي تريد استيرادها إلى ArabiaDash."
              : "اختر الحسابات الإضافية التي تريد إضافتها."}
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

        {/* Accounts list */}
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {accounts.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              لا توجد حسابات متاحة للاستيراد.
            </div>
          ) : (
            accounts.map((acc) => {
              const isSelected = selected.has(acc.account_id);
              const isAlreadyConnected = acc.is_already_connected;
              // Already-connected can't be deselected from here (use the
              // connections page to deactivate). Disabled when at limit
              // and trying to add a new one.
              const disabled =
                isAlreadyConnected || (!isSelected && limitReached);
              return (
                <label
                  key={acc.account_id}
                  className={`flex items-center gap-4 p-4 transition ${
                    disabled
                      ? "opacity-60 cursor-not-allowed"
                      : "cursor-pointer hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => toggleAccount(acc.account_id, disabled)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      acc.is_manager ? "bg-purple-50" : "bg-red-50"
                    }`}
                  >
                    {acc.is_manager ? (
                      <Building2 className="w-5 h-5 text-purple-600" />
                    ) : (
                      <span className="text-red-600 font-bold">G</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">
                        {acc.name || `حساب ${acc.account_id}`}
                      </span>
                      {acc.is_manager && (
                        <span className="text-[10px] sm:text-xs bg-purple-50 text-purple-700 font-semibold px-2 py-0.5 rounded">
                          حساب إداري
                        </span>
                      )}
                      {isAlreadyConnected && (
                        <span className="text-[10px] sm:text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          مرتبط
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap" dir="ltr">
                      <span>ID: {acc.account_id}</span>
                      {acc.currency && (
                        <span className="bg-gray-100 px-2 py-0.5 rounded">
                          {acc.currency}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* Submission errors */}
        {error && accounts.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Action bar */}
        <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
          <Link
            href="/dashboard/connections"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            إلغاء
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting || newlySelected.length === 0}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري الحفظ...
              </>
            ) : newlySelected.length === 0 ? (
              <>لم يتم اختيار حسابات جديدة</>
            ) : (
              <>إضافة {newlySelected.length} حساب</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MetaAdAccount } from "@/lib/meta/oauth";

interface Props {
  accounts: MetaAdAccount[];
}

const ACCOUNT_STATUS_LABELS: Record<number, { label: string; color: string }> =
  {
    1: { label: "نشط", color: "text-green-600" },
    2: { label: "مُعطّل", color: "text-red-600" },
    3: { label: "محذوف", color: "text-gray-500" },
    7: { label: "مُعلّق", color: "text-orange-600" },
    9: { label: "في انتظار المراجعة", color: "text-yellow-600" },
    100: { label: "قيد الإغلاق", color: "text-red-500" },
    101: { label: "مُغلق", color: "text-gray-700" },
    201: { label: "بانتظار شخصي", color: "text-blue-600" },
    202: { label: "بانتظار طلب", color: "text-blue-600" },
  };

const ERROR_MESSAGES: Record<string, string> = {
  session_expired: "انتهت جلسة الربط. الرجاء المحاولة من جديد.",
  invalid_session: "حدث خطأ في الجلسة. الرجاء المحاولة من جديد.",
  account_not_owned: "هذا الحساب لا ينتمي إليك.",
  db_error: "حدث خطأ في حفظ الحساب.",
  unauthorized: "الرجاء تسجيل الدخول.",
  invalid_account_id: "الحساب المحدد غير صالح.",
  unexpected: "حدث خطأ غير متوقع.",
};

export function SelectAccountClient({ accounts }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async () => {
    if (!selectedId) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/meta/select-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: selectedId }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(ERROR_MESSAGES[data.error] || "حدث خطأ غير متوقع.");
        setSubmitting(false);
        return;
      }

      router.push("/dashboard/connections?success=meta_connected");
      router.refresh();
    } catch (err) {
      console.error("[select-account] submit error:", err);
      setError("حدث خطأ في الاتصال. الرجاء المحاولة من جديد.");
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 md:p-8 max-w-3xl" dir="rtl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">اختر حساباً إعلانياً</h1>
        <p className="text-gray-600">
          وجدنا {accounts.length} حساب إعلاني مرتبط بـ Meta. اختر الحساب الذي
          تريد ربطه.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {accounts.map((account) => {
          const isSelected = selectedId === account.id;
          const status = ACCOUNT_STATUS_LABELS[account.account_status] || {
            label: "غير معروف",
            color: "text-gray-500",
          };

          return (
            <button
              key={account.id}
              onClick={() => setSelectedId(account.id)}
              disabled={submitting}
              className={`w-full text-right p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              } ${submitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate">
                    {account.name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 font-mono">
                    {account.id}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-2 text-sm">
                    <span className={`font-medium ${status.color}`}>
                      ● {status.label}
                    </span>
                    <span className="text-gray-600">{account.currency}</span>
                    <span className="text-gray-600">
                      {account.timezone_name}
                    </span>
                  </div>
                </div>
                {isSelected && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 justify-end">
        <button
          onClick={() => router.push("/dashboard/connections")}
          disabled={submitting}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          إلغاء
        </button>
        <button
          onClick={handleSelect}
          disabled={!selectedId || submitting}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "جاري الربط..." : "ربط الحساب"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Mail,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordClient() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      );

      if (resetError) {
        const msg = resetError.message.toLowerCase();
        if (msg.includes("user not found") || msg.includes("not registered")) {
          setError("هذا الإيميل غير مسجل لدينا");
        } else if (msg.includes("invalid email")) {
          setError("الإيميل غير صحيح");
        } else if (msg.includes("rate") || msg.includes("too many")) {
          setError(
            "تم إرسال طلبات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى."
          );
        } else {
          setError("حدث خطأ. يرجى المحاولة مرة أخرى.");
        }
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error("Reset password error:", err);
      setError("حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div
        className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4"
        dir="rtl"
      >
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            تم إرسال رابط الاستعادة إلى إيميلك
          </h1>
          <p className="text-gray-600 mb-2 leading-relaxed">
            أرسلنا رابط إعادة تعيين كلمة السر إلى:
          </p>
          <p className="font-semibold text-gray-900 mb-6" dir="ltr">
            {email}
          </p>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            افتح إيميلك واضغط على الرابط لإعادة تعيين كلمة السر. الرابط صالح
            لمدة محدودة.
          </p>
          <p className="text-xs text-gray-400 mb-6">
            لم يصلك الإيميل؟ تأكد من مجلد البريد المزعج (Spam) أو حاول من جديد.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setSuccess(false);
                setEmail("");
              }}
              className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition"
            >
              إرسال إلى إيميل آخر
            </button>
            <Link
              href="/login"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
            >
              العودة لتسجيل الدخول
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-gray-900">ArabiaDash</span>
        </Link>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              نسيت كلمة السر؟
            </h1>
            <p className="text-gray-600 leading-relaxed">
              لا مشكلة! أدخل إيميلك وسنرسل لك رابطاً لإعادة تعيين كلمة السر.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  dir="ltr"
                  className="w-full pr-11 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-right"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري الإرسال...
                </>
              ) : (
                "إرسال رابط الاستعادة"
              )}
            </button>
          </form>

          {/* Back to login */}
          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              تذكرت كلمة السر؟{" "}
              <Link
                href="/login"
                className="text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                العودة لتسجيل الدخول
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-6">
          ليس لديك حساب؟{" "}
          <Link
            href="/signup"
            className="text-indigo-600 hover:text-indigo-700 font-semibold"
          >
            إنشاء حساب جديد
          </Link>
        </p>
      </div>
    </div>
  );
}

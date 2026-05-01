"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Mail,
  Lock,
  User,
  Building2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const router = useRouter();
  const supabase = createClient();

  // States
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form data
  const [formData, setFormData] = useState({
    fullName: "",
    companyName: "",
    email: "",
    password: "",
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError(null);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Basic validation
    if (formData.password.length < 8) {
      setError("كلمة السر يجب أن تكون 8 أحرف على الأقل");
      setLoading(false);
      return;
    }

    try {
      // Sign up with Supabase
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
            company_name: formData.companyName,
          },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (signUpError) {
        // Translate common errors to Arabic
        if (signUpError.message.includes("already registered")) {
          setError("هذا الإيميل مسجل بالفعل. حاول تسجيل الدخول بدلاً من ذلك.");
        } else if (signUpError.message.includes("invalid email")) {
          setError("الإيميل غير صحيح");
        } else {
          setError("حدث خطأ. يرجى المحاولة مرة أخرى.");
        }
        setLoading(false);
        return;
      }

      // Success - show confirmation message
      if (data.user) {
        setSuccess(true);
      }
    } catch (err) {
      console.error("Sign up error:", err);
      setError("حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  // Show success message after sign up
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
            تم إنشاء حسابك بنجاح! 🎉
          </h1>
          <p className="text-gray-600 mb-6 leading-relaxed">
            أرسلنا رابط تأكيد إلى:
            <br />
            <span className="font-semibold text-gray-900">{formData.email}</span>
            <br />
            <br />
            افتح إيميلك واضغط على الرابط لتفعيل حسابك.
          </p>
          <Link
            href="/login"
            className="inline-block bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition"
          >
            الذهاب لتسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4 py-12"
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
              إنشاء حساب جديد
            </h1>
            <p className="text-gray-600">
              ابدأ تجربتك المجانية لمدة 14 يوم
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
            {/* Full Name */}
            <div>
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                الاسم الكامل
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={handleChange}
                  placeholder="أحمد محمد"
                  className="w-full pr-11 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Company Name */}
            <div>
              <label
                htmlFor="companyName"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                اسم الشركة أو المتجر
              </label>
              <div className="relative">
                <Building2 className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={handleChange}
                  placeholder="متجر الأناقة"
                  className="w-full pr-11 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Email */}
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
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  dir="ltr"
                  className="w-full pr-11 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-right"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                كلمة السر
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="8 أحرف على الأقل"
                  className="w-full pr-11 pl-11 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                استخدم 8 أحرف أو أكثر مع مزيج من الأرقام والرموز
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري إنشاء الحساب...
                </>
              ) : (
                "إنشاء حساب"
              )}
            </button>

            {/* Terms */}
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              بإنشاء حساب، أنت توافق على{" "}
              <Link href="/terms" className="text-indigo-600 hover:underline">
                الشروط والأحكام
              </Link>{" "}
              و{" "}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                سياسة الخصوصية
              </Link>
            </p>
          </form>

          {/* Login Link */}
          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              لديك حساب بالفعل؟{" "}
              <Link
                href="/login"
                className="text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-6">
          14 يوم مجاناً • بدون بطاقة ائتمان • إلغاء في أي وقت
        </p>
      </div>
    </div>
  );
}

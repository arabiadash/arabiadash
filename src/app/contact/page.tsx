"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ArrowLeft,
  Mail,
  Globe,
  MapPin,
  Clock,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  MessageSquare,
} from "lucide-react";

// lucide-react removed brand-specific icons in recent versions, so we inline
// the LinkedIn and X (Twitter) glyphs here.
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
    </svg>
  );
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setStatus(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    // Client-side validation
    if (!formData.name.trim() || !formData.email.trim() || !formData.subject.trim()) {
      setStatus({ type: "error", text: "جميع الحقول مطلوبة" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setStatus({ type: "error", text: "البريد الإلكتروني غير صحيح" });
      return;
    }

    if (formData.message.trim().length < 10) {
      setStatus({
        type: "error",
        text: "الرسالة يجب أن تكون 10 أحرف على الأقل",
      });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({
          type: "error",
          text: data.error || "❌ حدث خطأ، يرجى المحاولة مرة أخرى.",
        });
        setSubmitting(false);
        return;
      }

      setStatus({
        type: "success",
        text: "✅ تم إرسال رسالتك بنجاح، سنرد عليك خلال 24 ساعة.",
      });
      setFormData({ name: "", email: "", subject: "", message: "" });
    } catch (err) {
      console.error("Contact submit error:", err);
      setStatus({
        type: "error",
        text: "❌ حدث خطأ، يرجى المحاولة مرة أخرى.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const contactInfo = [
    {
      icon: Mail,
      label: "البريد الإلكتروني",
      value: "support@arabiadash.com",
      href: "mailto:support@arabiadash.com",
      ltr: true,
    },
    {
      icon: Globe,
      label: "الموقع",
      value: "arabiadash.com",
      href: "https://arabiadash.com",
      ltr: true,
    },
    {
      icon: MapPin,
      label: "العنوان",
      value: "المملكة العربية السعودية",
    },
    {
      icon: Clock,
      label: "ساعات الدعم",
      value: "الأحد - الخميس، 9 صباحاً - 5 مساءً",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-gray-900">
                ArabiaDash
              </span>
            </Link>
            <Link
              href="/"
              className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">العودة للرئيسية</span>
              <span className="sm:hidden">الرئيسية</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16">
        {/* Hero */}
        <section className="text-center mb-10 sm:mb-14">
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 mb-3 leading-tight">
            تواصل{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              معنا
            </span>
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl mx-auto">
            عندك سؤال أو اقتراح؟ يسعدنا نسمع منك. فريقنا جاهز للرد خلال 24 ساعة.
          </p>
        </section>

        {/* 2-column layout */}
        <div className="grid lg:grid-cols-5 gap-6 sm:gap-8">
          {/* Form (3 columns) */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">
              أرسل لنا رسالة
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              املأ النموذج التالي وسنتواصل معك بأقرب وقت
            </p>

            {status && (
              <div
                className={`mb-6 px-4 py-3 rounded-lg text-sm flex items-start gap-2 border ${
                  status.type === "success"
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {status.type === "success" ? (
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                )}
                <span>{status.text}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  الاسم الكامل
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="أحمد محمد"
                    className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
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
                  <Mail className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="you@example.com"
                    dir="ltr"
                    className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-right"
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label
                  htmlFor="subject"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  الموضوع
                </label>
                <input
                  id="subject"
                  name="subject"
                  type="text"
                  required
                  value={formData.subject}
                  onChange={handleChange}
                  placeholder="استفسار عن الباقات"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="message"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  الرسالة
                </label>
                <div className="relative">
                  <MessageSquare className="w-4 h-4 text-gray-400 absolute right-3 top-3" />
                  <textarea
                    id="message"
                    name="message"
                    required
                    rows={5}
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="اكتب رسالتك هنا... (10 أحرف على الأقل)"
                    className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.message.length} حرف
                </p>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    جاري الإرسال...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    إرسال الرسالة
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Info (2 columns) */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-5">
                معلومات التواصل
              </h3>
              <div className="space-y-4">
                {contactInfo.map((info, i) => {
                  const content = (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <info.icon className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 mb-0.5">
                          {info.label}
                        </p>
                        <p
                          className="text-sm font-medium text-gray-900 break-words"
                          dir={info.ltr ? "ltr" : undefined}
                        >
                          {info.value}
                        </p>
                      </div>
                    </div>
                  );
                  return info.href ? (
                    <a
                      key={i}
                      href={info.href}
                      target={info.href.startsWith("http") ? "_blank" : undefined}
                      rel={info.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="block hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg transition"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={i}>{content}</div>
                  );
                })}
              </div>
            </div>

            {/* Social */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                تابعنا على السوشيال
              </h3>
              <div className="flex gap-3">
                <a
                  href="#"
                  aria-label="LinkedIn"
                  className="w-11 h-11 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 rounded-lg flex items-center justify-center transition"
                >
                  <LinkedinIcon className="w-5 h-5" />
                </a>
                <a
                  href="#"
                  aria-label="Twitter / X"
                  className="w-11 h-11 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 rounded-lg flex items-center justify-center transition"
                >
                  <XIcon className="w-5 h-5" />
                </a>
              </div>
              <p className="text-xs text-gray-500 mt-4">
                روابط السوشيال قريباً
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white/50 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <p>© 2026 ArabiaDash. جميع الحقوق محفوظة.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-gray-900 transition">
              الشروط والأحكام
            </Link>
            <Link href="/privacy" className="hover:text-gray-900 transition">
              سياسة الخصوصية
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

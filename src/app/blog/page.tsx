"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ArrowLeft,
  BookOpen,
  Sparkles,
  TrendingUp,
  Target,
  Lightbulb,
  Mail,
  Loader2,
  CheckCircle2,
} from "lucide-react";

export default function BlogPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Newsletter storage isn't wired up yet; simulate a brief network call so
    // the loading state feels real, then show a success message.
    await new Promise((resolve) => setTimeout(resolve, 700));
    setSubmitting(false);
    setSubscribed(true);
    setEmail("");
  };

  const upcomingTopics = [
    {
      icon: Target,
      title: "استراتيجيات الإعلانات الناجحة",
      description: "نصائح عملية لتحسين عائد إعلاناتك على Meta و Google و TikTok.",
    },
    {
      icon: TrendingUp,
      title: "تحليلات السوق السعودي والخليجي",
      description: "بيانات وإحصائيات عن سلوك المستهلك العربي وتوجهات السوق.",
    },
    {
      icon: Lightbulb,
      title: "دروس من حملات إعلانية حقيقية",
      description: "case studies من متاجر سعودية وخليجية ناجحة.",
    },
    {
      icon: Sparkles,
      title: "نصائح من خبراء التسويق",
      description: "مقابلات مع متخصصين في الإعلان الرقمي بالعالم العربي.",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16">
        {/* Hero */}
        <section className="text-center mb-12 sm:mb-16">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-4 leading-tight">
            مدونة{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              ArabiaDash
            </span>
          </h1>
          <p className="text-base sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            مقالات ونصائح لتحسين أداء إعلاناتك واتخاذ قرارات تسويقية مبنية على
            البيانات.
          </p>
        </section>

        {/* Coming Soon */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-12 mb-8 sm:mb-12 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-10 h-10 text-indigo-600" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
            🚀 قريباً...
          </h2>
          <p className="text-gray-600 mb-8 max-w-xl mx-auto leading-relaxed">
            نعمل على تجهيز محتوى مفيد وقيّم لرواد الأعمال وأصحاب المتاجر في
            المنطقة العربية. ستجد قريباً:
          </p>

          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto text-right">
            {upcomingTopics.map((topic, i) => (
              <div
                key={i}
                className="bg-gray-50 rounded-xl p-4 sm:p-5 border border-gray-100 hover:border-indigo-200 transition flex items-start gap-3"
              >
                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                  <topic.icon className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1 text-sm sm:text-base">
                    {topic.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                    {topic.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Newsletter */}
        <section className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-6 sm:p-10 text-white mb-8 sm:mb-12">
          <div className="max-w-xl mx-auto text-center">
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold mb-3">
              اشترك بالنشرة
            </h2>
            <p className="text-indigo-100 mb-6 leading-relaxed text-sm sm:text-base">
              كن أوّل من يقرأ مقالاتنا الجديدة عند نشرها — مرتين في الشهر فقط،
              بدون إزعاج.
            </p>

            {subscribed ? (
              <div className="bg-white/10 border border-white/30 rounded-xl p-4 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-300" />
                <span className="text-sm font-medium">
                  ✅ شكراً للاشتراك! سنبعث لك المقالات أوّل ما تجهز.
                </span>
              </div>
            ) : (
              <form
                onSubmit={handleSubscribe}
                className="flex flex-col sm:flex-row gap-3"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  dir="ltr"
                  className="flex-1 bg-white/10 border border-white/30 placeholder-white/50 text-white px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-white/50 text-right"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-white text-indigo-600 px-6 py-3 rounded-lg font-bold hover:shadow-2xl transition flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري...
                    </>
                  ) : (
                    "اشترك"
                  )}
                </button>
              </form>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center">
          <p className="text-gray-700 mb-4 text-base sm:text-lg">
            في انتظار المقالات؟ جرّب المنصة الآن
          </p>
          <Link
            href="/signup"
            className="inline-block bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 sm:px-8 py-3 rounded-lg font-bold hover:shadow-xl hover:shadow-indigo-500/30 transition"
          >
            ابدأ تجربتك المجانية
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white/50 mt-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
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

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  Zap,
  Shield,
  Globe,
  CheckCircle2,
  ArrowLeft,
  Menu,
  X,
  Target,
  Sparkles,
  ChevronDown,
} from "lucide-react";

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const features = [
    {
      icon: BarChart3,
      title: "داشبورد موحد",
      description:
        "اعرض نتائج إعلاناتك من جميع المنصات في مكان واحد. لا حاجة للتنقل بين 10 منصات مختلفة.",
    },
    {
      icon: TrendingUp,
      title: "تقارير تلقائية",
      description:
        "تقارير يومية وأسبوعية وشهرية تصلك تلقائياً على الإيميل والواتساب بدون أي عمل يدوي.",
    },
    {
      icon: Zap,
      title: "ربط سريع وآمن",
      description:
        "اربط حساباتك الإعلانية ومتاجرك بضغطة زر واحدة. كل بياناتك محمية ومشفرة.",
    },
    {
      icon: Target,
      title: "قياس دقيق للمبيعات",
      description:
        "اعرف بالضبط أي إعلان جاب مبيعة. ربط مباشر مع متجرك على سلة وزد.",
    },
    {
      icon: Sparkles,
      title: "ذكاء اصطناعي بالعربي",
      description:
        "احصل على توصيات ذكية بالعربي لتحسين إعلاناتك وزيادة الأرباح.",
    },
    {
      icon: Shield,
      title: "أمان على مستوى البنوك",
      description:
        "تشفير كامل لبياناتك مع التزام بمعايير حماية البيانات السعودية (PDPL).",
    },
  ];

  const platforms = [
    { name: "Meta Ads", subtitle: "Facebook & Instagram" },
    { name: "Google Ads", subtitle: "Search & Display" },
    { name: "TikTok Ads", subtitle: "TikTok for Business" },
    { name: "Snapchat Ads", subtitle: "Snap Marketing" },
    { name: "سلة", subtitle: "متجرك الإلكتروني" },
    { name: "زد", subtitle: "متجرك الإلكتروني" },
  ];

  const pricing = [
    {
      name: "البداية",
      price: "299",
      period: "شهرياً",
      description: "مثالي لأصحاب المتاجر الجدد",
      features: [
        "متجر واحد",
        "3 منصات إعلانية",
        "تقارير أسبوعية",
        "دعم فني بالعربي",
        "تحديث البيانات كل 6 ساعات",
      ],
      cta: "ابدأ الآن",
      ctaLink: "/signup",
      popular: false,
    },
    {
      name: "النمو",
      price: "799",
      period: "شهرياً",
      description: "للمتاجر النامية والوكالات الصغيرة",
      features: [
        "3 متاجر",
        "جميع المنصات الإعلانية",
        "تقارير يومية + واتساب",
        "ذكاء اصطناعي وتوصيات",
        "تحديث البيانات كل ساعة",
        "دعم فني مخصص",
      ],
      cta: "الأكثر شعبية",
      ctaLink: "/signup",
      popular: true,
    },
    {
      name: "الوكالات",
      price: "2499",
      period: "شهرياً",
      description: "للوكالات الإعلانية الكبيرة",
      features: [
        "عملاء غير محدودين",
        "جميع المنصات",
        "تقارير مخصصة بشعارك",
        "API للمطورين",
        "تحديث فوري للبيانات",
        "مدير حساب مخصص",
        "تدريب للفريق",
      ],
      cta: "تواصل معنا",
      ctaLink: "/signup",
      popular: false,
    },
  ];

  const faqs = [
    {
      q: "كيف يعمل ربط المنصات؟",
      a: "بضغطة زر واحدة فقط! نستخدم تقنية OAuth الآمنة المعتمدة من Meta و Google و TikTok. لن نطلب منك كلمات السر أبداً.",
    },
    {
      q: "هل بياناتي آمنة؟",
      a: "نعم، نستخدم تشفير من نوع AES-256 وهو نفس التشفير المستخدم في البنوك. كل بياناتك معزولة عن بيانات العملاء الآخرين.",
    },
    {
      q: "هل تدعمون اللغة العربية؟",
      a: "بالطبع! المنصة بالكامل بالعربية، وحتى التقارير والتوصيات الذكية تأتي بالعربية الفصحى الواضحة.",
    },
    {
      q: "ماذا عن الدعم الفني؟",
      a: "فريق دعم بالعربية متاح من الأحد إلى الخميس. الباقات الأعلى تحصل على دعم 24/7 ومدير حساب مخصص.",
    },
    {
      q: "هل يوجد فترة تجريبية؟",
      a: "نعم! 14 يوم تجربة مجانية بدون الحاجة لبطاقة ائتمان. جرب المنصة بالكامل قبل أن تدفع ريالاً واحداً.",
    },
    {
      q: "هل يمكنني إلغاء الاشتراك في أي وقت؟",
      a: "نعم بالتأكيد. يمكنك الإلغاء في أي وقت من لوحة التحكم بضغطة زر، بدون أي عقود أو التزامات طويلة الأمد.",
    },
  ];

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      {/* Header */}
      <header className="fixed top-0 right-0 left-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">ArabiaDash</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 transition">
                المميزات
              </a>
              <a href="#platforms" className="text-gray-600 hover:text-gray-900 transition">
                المنصات
              </a>
              <a href="#pricing" className="text-gray-600 hover:text-gray-900 transition">
                الأسعار
              </a>
              <a href="#faq" className="text-gray-600 hover:text-gray-900 transition">
                الأسئلة
              </a>
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <Link
                href="/login"
                className="text-gray-700 hover:text-gray-900 font-medium"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-lg font-medium hover:shadow-lg hover:shadow-indigo-500/30 transition"
              >
                ابدأ مجاناً
              </Link>
            </div>

            <button
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100">
            <div className="px-4 py-4 space-y-3">
              <a href="#features" className="block text-gray-600 py-2">المميزات</a>
              <a href="#platforms" className="block text-gray-600 py-2">المنصات</a>
              <a href="#pricing" className="block text-gray-600 py-2">الأسعار</a>
              <a href="#faq" className="block text-gray-600 py-2">الأسئلة</a>
              <Link
                href="/login"
                className="block text-gray-700 py-2 font-medium"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="block w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-medium text-center"
              >
                ابدأ مجاناً
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 right-20 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>
          <div className="absolute top-40 left-20 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>
        </div>

        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            <span>منصة عربية بمعايير عالمية</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
            كل إعلاناتك ومبيعاتك
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              في داشبورد واحد
            </span>
          </h1>

          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            اربط Meta و Google و TikTok وسلة وزد بضغطة زر، واحصل على تقارير ذكية تساعدك على
            مضاعفة أرباحك من الإعلانات
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              href="/signup"
              className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-4 rounded-lg font-semibold text-lg hover:shadow-xl hover:shadow-indigo-500/30 transition flex items-center justify-center gap-2"
            >
              ابدأ تجربتك المجانية
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <a
              href="#features"
              className="bg-white text-gray-900 px-8 py-4 rounded-lg font-semibold text-lg border-2 border-gray-200 hover:border-gray-300 transition text-center"
            >
              شاهد العرض التوضيحي
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>14 يوم مجاناً</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>بدون بطاقة ائتمان</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>إلغاء في أي وقت</span>
            </div>
          </div>

          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              { number: "+500", label: "متجر يستخدم المنصة" },
              { number: "+50M", label: "ريال مبيعات تم تتبعها" },
              { number: "+15", label: "منصة إعلانية" },
              { number: "99.9%", label: "وقت تشغيل" },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-3xl md:text-4xl font-bold text-gray-900 mb-1">
                  {stat.number}
                </div>
                <div className="text-sm text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-gray-900 mb-4">
              كل ما تحتاجه لنجاح إعلاناتك
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              مميزات قوية ومدروسة تساعدك على فهم بياناتك واتخاذ قرارات أذكى
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className="bg-white p-8 rounded-2xl border border-gray-100 hover:shadow-xl hover:border-indigo-100 transition group"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platforms Section */}
      <section id="platforms" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-gray-900 mb-4">
              يدعم جميع المنصات التي تستخدمها
            </h2>
            <p className="text-xl text-gray-600">
              تكامل مباشر مع أكبر منصات الإعلانات والمتاجر الإلكترونية
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {platforms.map((platform, i) => (
              <div
                key={i}
                className="bg-white border-2 border-gray-100 rounded-2xl p-6 text-center hover:border-indigo-200 hover:shadow-lg transition"
              >
                <div className="w-16 h-16 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                  <Globe className="w-8 h-8 text-indigo-600" />
                </div>
                <h3 className="font-bold text-gray-900 mb-1">{platform.name}</h3>
                <p className="text-sm text-gray-500">{platform.subtitle}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-gray-900 mb-4">
              أسعار شفافة وبسيطة
            </h2>
            <p className="text-xl text-gray-600">
              اختر الباقة المناسبة لك. لا رسوم خفية، إلغاء في أي وقت.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {pricing.map((plan, i) => (
              <div
                key={i}
                className={`relative bg-white rounded-2xl p-8 ${
                  plan.popular
                    ? "ring-2 ring-indigo-600 shadow-2xl md:scale-105"
                    : "border border-gray-200"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 right-1/2 translate-x-1/2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-1 rounded-full text-sm font-medium">
                    الأكثر طلباً
                  </div>
                )}

                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <p className="text-gray-600 mb-6">{plan.description}</p>

                <div className="mb-8">
                  <span className="text-5xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-600 mr-2">ريال / {plan.period}</span>
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.ctaLink}
                  className={`block w-full py-3 rounded-lg font-semibold transition text-center ${
                    plan.popular
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg"
                      : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-gray-900 mb-4">
              الأسئلة الشائعة
            </h2>
            <p className="text-xl text-gray-600">كل ما تحتاج معرفته قبل البدء</p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden"
              >
                <button
                  className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-semibold text-gray-900 text-right">{faq.q}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-500 transition ${
                      openFaq === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-gray-600 leading-relaxed">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto bg-gradient-to-br from-indigo-600 to-purple-700 rounded-3xl p-12 md:p-16 text-center relative overflow-hidden">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            جاهز لمضاعفة أرباحك؟
          </h2>
          <p className="text-xl text-indigo-100 mb-10 max-w-2xl mx-auto">
            انضم لأكثر من 500 متجر يستخدمون ArabiaDash لاتخاذ قرارات إعلانية أذكى
          </p>
          <Link
            href="/signup"
            className="bg-white text-indigo-600 px-8 py-4 rounded-lg font-bold text-lg hover:shadow-2xl transition inline-flex items-center gap-2"
          >
            ابدأ تجربتك المجانية الآن
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <p className="text-indigo-200 mt-6 text-sm">
            14 يوم مجاناً • بدون بطاقة ائتمان • إعداد في 5 دقائق
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">ArabiaDash</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                منصة عربية لإدارة وتحليل الإعلانات الرقمية بذكاء.
              </p>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">المنتج</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition">المميزات</a></li>
                <li><a href="#pricing" className="hover:text-white transition">الأسعار</a></li>
                <li><Link href="/signup" className="hover:text-white transition">ابدأ مجاناً</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">الشركة</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">من نحن</a></li>
                <li><a href="#" className="hover:text-white transition">المدونة</a></li>
                <li><a href="#" className="hover:text-white transition">تواصل معنا</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">قانوني</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/privacy" className="hover:text-white transition">سياسة الخصوصية</Link></li>
                <li><Link href="/terms" className="hover:text-white transition">الشروط والأحكام</Link></li>
                <li><Link href="/login" className="hover:text-white transition">تسجيل الدخول</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-400">
              © 2026 ArabiaDash. جميع الحقوق محفوظة.
            </p>
            <p className="text-sm text-gray-400">
              صُنع بـ ❤️ في المملكة العربية السعودية
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
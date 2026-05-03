import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  ArrowLeft,
  Target,
  Lock,
  Globe,
  Rocket,
  Eye,
  Compass,
} from "lucide-react";

export const metadata: Metadata = {
  title: "من نحن | ArabiaDash",
  description:
    "تعرّف على قصة ArabiaDash، مهمتنا، ورؤيتنا في تمكين الشركات العربية من اتخاذ قرارات إعلانية ذكية مبنية على البيانات.",
};

export default function AboutPage() {
  const values = [
    {
      icon: Target,
      title: "الشفافية",
      description: "بياناتك ملكك، نحن فقط نساعدك تفهمها وتتخذ قرارات أفضل.",
      color: "bg-indigo-100 text-indigo-600",
    },
    {
      icon: Lock,
      title: "الأمان",
      description: "نحمي بياناتك بأعلى معايير الأمان والتشفير المعمول بها عالمياً.",
      color: "bg-purple-100 text-purple-600",
    },
    {
      icon: Globe,
      title: "المحلية",
      description: "مصمَّمون للسوق العربي، بلغته وثقافته واحتياجاته الخاصة.",
      color: "bg-pink-100 text-pink-600",
    },
    {
      icon: Rocket,
      title: "الابتكار",
      description: "نطوّر باستمرار لتبقى منصّتنا في طليعة أدوات تحليل الإعلانات.",
      color: "bg-amber-100 text-amber-600",
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
        <section className="text-center mb-12 sm:mb-20">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-4 leading-tight">
            نحن{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              ArabiaDash
            </span>
          </h1>
          <p className="text-base sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            منصة عربية ذكية لتحليل وإدارة الإعلانات الرقمية، مصمَّمة لأصحاب
            الأعمال في السوق السعودي والخليجي.
          </p>
        </section>

        {/* Story */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-10 mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
            قصّتنا
          </h2>
          <div className="space-y-4 text-gray-700 leading-relaxed text-[15px] sm:text-base">
            <p>
              بدأت <strong>ArabiaDash</strong> عام 2026 من ملاحظة بسيطة: أصحاب
              المتاجر والوكالات في المنطقة العربية يهدرون ساعات يومياً يتنقّلون
              بين منصات Meta و Google و TikTok و Snapchat لمعرفة أداء إعلاناتهم،
              ثم يحاولون مطابقتها يدوياً مع مبيعات متاجرهم على سلة وزد.
            </p>
            <p>
              نحن نؤمن بأن <strong>البيانات حقّ لكلّ صاحب عمل</strong>، وأن
              الفهم الواضح لأدائك الإعلاني لا يجب أن يحتاج مهارات تقنية معقّدة
              ولا فِرَقاً ضخمة. لذلك بنينا منصّة تجمع كلّ بياناتك في مكان واحد،
              بلغة عربية واضحة، ورؤى مفهومة لأي صاحب متجر.
            </p>
            <p>
              هدفنا بسيط:{" "}
              <strong>
                نخلّيك تركّز على نموّ مشروعك بدل ما تضيع وقتك في الأرقام.
              </strong>
            </p>
          </div>
        </section>

        {/* Mission + Vision */}
        <section className="grid md:grid-cols-2 gap-6 mb-8 sm:mb-12">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 sm:p-8 text-white">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-4">
              <Compass className="w-6 h-6" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold mb-3">مهمتنا</h3>
            <p className="text-indigo-50 leading-relaxed">
              تمكين الشركات العربية من اتخاذ قرارات إعلانية ذكية مبنية على
              البيانات، بأدوات بسيطة الاستخدام وقوية الأثر.
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-6 sm:p-8 text-white">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-4">
              <Eye className="w-6 h-6" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold mb-3">رؤيتنا</h3>
            <p className="text-purple-50 leading-relaxed">
              أن نكون المنصة الأولى لتحليل الإعلانات في العالم العربي، والشريك
              الموثوق لكلّ متجر إلكتروني يطمح للنموّ.
            </p>
          </div>
        </section>

        {/* Values */}
        <section className="mb-8 sm:mb-12">
          <div className="text-center mb-8 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
              قيمنا الأساسية
            </h2>
            <p className="text-gray-600">
              المبادئ التي توجّه كلّ قرار نتّخذه في ArabiaDash
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {values.map((value, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 hover:shadow-md transition"
              >
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${value.color}`}
                >
                  <value.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {value.title}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-8 sm:p-12 text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            جاهز تبدأ معنا؟
          </h2>
          <p className="text-indigo-100 mb-8 max-w-xl mx-auto leading-relaxed">
            انضم لمئات الشركات اللي تستخدم ArabiaDash لاتخاذ قرارات إعلانية أذكى
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="bg-white text-indigo-600 px-6 sm:px-8 py-3 rounded-lg font-bold hover:shadow-2xl transition"
            >
              ابدأ تجربتك المجانية
            </Link>
            <Link
              href="/contact"
              className="bg-white/10 hover:bg-white/20 text-white border border-white/30 px-6 sm:px-8 py-3 rounded-lg font-semibold transition"
            >
              تواصل معنا
            </Link>
          </div>
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

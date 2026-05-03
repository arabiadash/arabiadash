import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ArrowLeft, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "سياسة الخصوصية | ArabiaDash",
  description:
    "سياسة الخصوصية الخاصة بمنصة ArabiaDash لتحليل وإدارة الإعلانات الرقمية، وكيف نحمي بياناتك.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
        <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-10">
          {/* Title */}
          <div className="text-center mb-6 sm:mb-10 pb-6 sm:pb-8 border-b border-gray-100">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-3 leading-snug">
              سياسة الخصوصية
            </h1>
            <p className="text-sm text-gray-500">آخر تحديث: 3 مايو 2026</p>
          </div>

          {/* Draft notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 leading-relaxed">
              <strong>تنبيه:</strong> هذه مسوّدة أوّلية لسياسة الخصوصية، وقد
              تخضع للتعديل بعد المراجعة من قِبَل محامٍ متخصّص لضمان التوافق مع
              نظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-8 text-gray-700 leading-relaxed text-[15px] sm:text-base">
            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                1. مقدمة
              </h2>
              <p>
                في ArabiaDash، نأخذ خصوصيتك على محمل الجدّ. توضّح هذه السياسة
                كيف نجمع المعلومات الخاصة بك، وكيف نستخدمها ونحميها، وما
                حقوقك المتعلقة بها. باستخدامك لمنصّتنا، فإنك توافق على ممارسات
                البيانات الموضّحة في هذه السياسة.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                2. البيانات التي نجمعها
              </h2>

              <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">
                أ) بيانات الحساب
              </h3>
              <ul className="list-disc pr-5 space-y-1 mb-4">
                <li>الاسم الكامل</li>
                <li>البريد الإلكتروني</li>
                <li>اسم الشركة أو المتجر</li>
                <li>كلمة السر (مُشفّرة، نحن لا نستطيع رؤيتها)</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">
                ب) بيانات الاستخدام
              </h3>
              <ul className="list-disc pr-5 space-y-1 mb-4">
                <li>عنوان IP الخاصّ بك</li>
                <li>نوع المتصفح ونظام التشغيل</li>
                <li>صفحات الموقع التي تزورها وأوقات الزيارة</li>
                <li>سجلّات الأخطاء (logs) الفنية لتحسين الخدمة</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">
                ج) بيانات الإعلانات والمبيعات
              </h3>
              <p className="mb-2">
                عند ربط حساباتك على المنصات التالية، نقوم بسحب بيانات الأداء
                الإعلاني والمبيعات منها لعرضها وتحليلها داخل لوحة التحكّم:
              </p>
              <ul className="list-disc pr-5 space-y-1">
                <li>Meta Ads (Facebook & Instagram)</li>
                <li>Google Ads</li>
                <li>TikTok Ads</li>
                <li>Snapchat Ads</li>
                <li>متجر سلة</li>
                <li>متجر زد</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                3. كيف نستخدم بياناتك
              </h2>
              <p className="mb-3">نستخدم بياناتك للأغراض التالية فقط:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>تقديم الخدمة الأساسية (التحليلات، التقارير، التوصيات).</li>
                <li>تحسين أداء المنصة وإصلاح المشاكل التقنية.</li>
                <li>
                  إرسال إشعارات مهمّة متعلّقة بحسابك (مثل التقارير الأسبوعية).
                </li>
                <li>التواصل معك للدعم الفني عند الحاجة.</li>
                <li>التحليلات الداخلية لتطوير ميزات جديدة.</li>
              </ul>
              <p className="mt-3 font-semibold">
                نحن لا نستخدم بياناتك أبداً لأغراض إعلانية موجَّهة.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                4. مشاركة البيانات
              </h2>
              <p className="mb-3 font-semibold text-gray-900">
                نحن لا نبيع بياناتك أبداً.
              </p>
              <p className="mb-3">
                نشارك البيانات فقط مع الأطراف التالية، وبالحدّ الأدنى الضروري
                لتشغيل الخدمة:
              </p>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  <strong>مزوّدو البنية التحتية التقنية:</strong> مثل Supabase
                  (لقاعدة البيانات والمصادقة) و Vercel (لاستضافة الموقع).
                  هؤلاء الشركاء ملتزمون بمعايير حماية بيانات صارمة.
                </li>
                <li>
                  <strong>مزوّدو خدمات الدفع:</strong> لمعالجة الاشتراكات بشكل
                  آمن ومتوافق مع معايير PCI DSS.
                </li>
                <li>
                  <strong>الجهات الحكومية:</strong> فقط عند طلب رسمي من جهة
                  قضائية مختصّة في المملكة العربية السعودية.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                5. تخزين البيانات
              </h2>
              <ul className="list-disc pr-5 space-y-2">
                <li>تُخزَّن بياناتك على خوادم آمنة في مراكز بيانات معتمدة.</li>
                <li>
                  نحتفظ ببياناتك طوال فترة نشاط حسابك، وحتى 90 يوماً بعد
                  إغلاقه (لأغراض النسخ الاحتياطي والتدقيق).
                </li>
                <li>
                  بيانات الفواتير قد تُحفظ لمدّة أطول وفقاً لمتطلبات الأنظمة
                  الضريبية في المملكة العربية السعودية.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                6. أمان البيانات
              </h2>
              <p className="mb-3">نتّبع ممارسات أمنية متقدّمة لحماية بياناتك:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>تشفير البيانات أثناء النقل (HTTPS / TLS).</li>
                <li>
                  تشفير كلمات السر باستخدام خوارزميات معتمدة (مثل bcrypt).
                </li>
                <li>
                  مصادقة آمنة بناءً على بروتوكولات حديثة (OAuth 2.0، PKCE).
                </li>
                <li>مراقبة دورية للنظام ومراجعة سجلّات الوصول.</li>
                <li>نسخ احتياطية مشفّرة بشكل منتظم.</li>
              </ul>
              <p className="mt-3 text-sm text-gray-600">
                رغم اتّخاذنا لأعلى المعايير، فإن أيّ وسيلة لنقل البيانات عبر
                الإنترنت ليست آمنة بنسبة 100%، ولا يمكننا ضمان الأمان المطلق.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                7. حقوقك
              </h2>
              <p className="mb-3">يحقّ لك في أيّ وقت:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  <strong>الوصول:</strong> طلب نسخة من البيانات التي نحتفظ بها
                  عنك.
                </li>
                <li>
                  <strong>التعديل:</strong> تصحيح أيّ معلومات غير دقيقة من
                  إعدادات حسابك.
                </li>
                <li>
                  <strong>الحذف:</strong> طلب حذف حسابك وكلّ بياناتك بشكل
                  نهائي من إعدادات الحساب.
                </li>
                <li>
                  <strong>النقل:</strong> تصدير بياناتك بصيغة قياسية (CSV /
                  JSON) لاستخدامها في خدمة أخرى.
                </li>
                <li>
                  <strong>الاعتراض:</strong> رفض استخدام بياناتك لأغراض معيّنة
                  (مثل التحليلات الإحصائية الداخلية).
                </li>
              </ul>
              <p className="mt-3">
                لممارسة أيٍّ من هذه الحقوق، تواصل معنا على{" "}
                <a
                  href="mailto:privacy@arabiadash.com"
                  className="text-indigo-600 hover:text-indigo-700 font-semibold underline"
                  dir="ltr"
                >
                  privacy@arabiadash.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                8. ملفات تعريف الارتباط (Cookies)
              </h2>
              <p className="mb-3">نستخدم ملفات تعريف الارتباط من أجل:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>الحفاظ على جلسة تسجيل الدخول.</li>
                <li>تذكُّر تفضيلاتك (مثل اللغة).</li>
                <li>قياس أداء الموقع وتحسين تجربة المستخدم.</li>
              </ul>
              <p className="mt-3 text-sm text-gray-600">
                يمكنك تعطيل ملفات تعريف الارتباط من إعدادات متصفّحك، لكن قد
                يؤثّر ذلك على بعض الميزات الأساسية للمنصة.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                9. الأدوات الخارجية و Google Analytics
              </h2>
              <p className="mb-3">قد نستخدم أدوات تحليلية خارجية مثل:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  <strong>Google Analytics:</strong> لفهم كيفية استخدام الموقع
                  بشكل مجمّع وغير معرَّف بهويّة المستخدم.
                </li>
                <li>
                  <strong>أدوات قياس الأداء:</strong> لمراقبة سرعة المنصة
                  واستقرارها التقني.
                </li>
              </ul>
              <p className="mt-3 text-sm text-gray-600">
                هذه الأدوات قد تجمع بيانات مجهولة الهوية. تتمّ معالجتها وفقاً
                لسياسات الخصوصية الخاصة بمزوّديها.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                10. تحديثات السياسة
              </h2>
              <p>
                قد نُحدِّث هذه السياسة من حين لآخر لتعكس تغييرات في الخدمة أو
                في القانون. سنُشعرك بأيّ تغييرات جوهرية عبر البريد الإلكتروني
                أو إشعار داخل المنصة قبل 30 يوماً من تطبيقها. استمرارك في
                استخدام الخدمة بعد تاريخ سريان التحديث يُعدّ موافقة على
                النسخة الجديدة.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                11. التواصل
              </h2>
              <p>
                لأيّ استفسارات حول هذه السياسة، أو لممارسة حقوقك المتعلّقة
                ببياناتك:
              </p>
              <a
                href="mailto:privacy@arabiadash.com"
                className="inline-block mt-2 text-indigo-600 hover:text-indigo-700 font-semibold underline"
                dir="ltr"
              >
                privacy@arabiadash.com
              </a>
            </section>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white/50 mt-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
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

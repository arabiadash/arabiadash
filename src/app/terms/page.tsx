import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ArrowLeft, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "الشروط والأحكام | ArabiaDash",
  description:
    "الشروط والأحكام الخاصة باستخدام منصة ArabiaDash لتحليل وإدارة الإعلانات الرقمية.",
};

export default function TermsPage() {
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
              الشروط والأحكام
            </h1>
            <p className="text-sm text-gray-500">آخر تحديث: 3 مايو 2026</p>
          </div>

          {/* Draft notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 leading-relaxed">
              <strong>تنبيه:</strong> هذه مسوّدة أوّلية للشروط والأحكام، وقد تخضع
              للتعديل بعد المراجعة من قِبَل محامٍ متخصّص قبل الإطلاق الرسمي للمنصة.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-8 text-gray-700 leading-relaxed text-[15px] sm:text-base">
            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                1. مقدمة وقبول الشروط
              </h2>
              <p>
                مرحباً بك في ArabiaDash. تنطبق هذه الشروط والأحكام (يُشار إليها
                فيما بعد بـ "الشروط") على استخدامك لمنصة ArabiaDash وخدماتها
                (يُشار إليها فيما بعد بـ "الخدمة"). باستخدامك للخدمة أو إنشاء
                حساب فيها، فإنك تُقرّ بأنك قرأت هذه الشروط وفهمتها ووافقت على
                الالتزام بها. إذا كنت لا توافق على أيٍّ من هذه الشروط، فلا
                يحقّ لك استخدام الخدمة.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                2. التعريفات
              </h2>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  <strong>"المنصة" أو "ArabiaDash":</strong> الموقع الإلكتروني
                  والتطبيقات المرتبطة به التي تُشغّلها شركة ArabiaDash.
                </li>
                <li>
                  <strong>"المستخدم" أو "أنت":</strong> أيّ شخص طبيعي أو
                  اعتباري يقوم بالتسجيل في الخدمة أو استخدامها.
                </li>
                <li>
                  <strong>"الخدمة":</strong> مجموعة الأدوات التي توفّرها المنصة
                  لتحليل وإدارة الإعلانات الرقمية وربطها بالمتاجر الإلكترونية.
                </li>
                <li>
                  <strong>"البيانات":</strong> أيّ معلومات أو محتوى تقوم برفعه
                  أو إدخاله أو الوصول إليه عبر الخدمة، بما في ذلك بيانات
                  الإعلانات والمبيعات.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                3. التسجيل والحساب
              </h2>
              <ul className="list-disc pr-5 space-y-2">
                <li>يجب أن تكون قد بلغت 18 عاماً على الأقل لإنشاء حساب.</li>
                <li>
                  يجب أن تقدّم معلومات صحيحة وكاملة عند التسجيل، وأن تُحدّثها
                  عند الحاجة.
                </li>
                <li>
                  أنت المسؤول الوحيد عن الحفاظ على سرّية كلمة السر الخاصة
                  بحسابك، وعن جميع الأنشطة التي تتمّ من خلاله.
                </li>
                <li>
                  يحقّ لنا تعليق أو إنهاء حسابك في حال انتهاكك لهذه الشروط أو
                  استخدامك للخدمة بطريقة تضرّ بالمنصة أو بالمستخدمين الآخرين.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                4. الاشتراكات والدفع
              </h2>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  تتوفّر تجربة مجانية لمدة <strong>14 يوماً</strong> للمستخدمين
                  الجدد دون الحاجة لإدخال بطاقة ائتمان.
                </li>
                <li>
                  بعد انتهاء التجربة، يلزم الاشتراك في إحدى الباقات المدفوعة
                  (البداية، النمو، الوكالات) لمواصلة استخدام الخدمة.
                </li>
                <li>
                  تُحتسب الفواتير شهرياً وتُجدَّد تلقائياً ما لم تقم بإلغاء
                  الاشتراك قبل تاريخ التجديد.
                </li>
                <li>
                  يمكنك إلغاء اشتراكك في أيّ وقت من لوحة التحكم، وسيظلّ حسابك
                  نشطاً حتى نهاية الفترة المدفوعة.
                </li>
                <li>
                  جميع الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة
                  المُطبَّقة في المملكة العربية السعودية.
                </li>
                <li>
                  لا تُسترَدّ المبالغ المدفوعة عن الفترات المنقضية، باستثناء
                  ما يقتضيه القانون.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                5. حقوق الملكية الفكرية
              </h2>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  جميع حقوق الملكية الفكرية المتعلقة بالمنصة، بما في ذلك الكود
                  البرمجي والتصاميم والشعارات والنصوص، هي ملك حصري لـ
                  ArabiaDash.
                </li>
                <li>
                  يحتفظ المستخدم بجميع حقوقه على البيانات التي يقوم برفعها،
                  ويمنحنا ترخيصاً محدوداً لاستخدامها فقط بقدر ما يلزم لتقديم
                  الخدمة.
                </li>
                <li>
                  يُحظر نسخ أو تعديل أو إعادة توزيع أيّ جزء من المنصة دون إذن
                  خطّي مسبق منّا.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                6. الاستخدام المقبول
              </h2>
              <p className="mb-3">يلتزم المستخدم بعدم القيام بأيٍّ ممّا يلي:</p>
              <ul className="list-disc pr-5 space-y-2">
                <li>
                  استخدام الخدمة لأغراض غير قانونية أو مخالفة للأخلاق العامة.
                </li>
                <li>
                  محاولة اختراق المنصة أو الوصول غير المُصرَّح به لحسابات
                  المستخدمين الآخرين.
                </li>
                <li>
                  استخدام أدوات آلية لاستخراج البيانات (scraping) أو إغراق
                  المنصة بطلبات مكثّفة.
                </li>
                <li>
                  مشاركة بيانات الدخول مع أطراف ثالثة دون إذن منّا.
                </li>
                <li>
                  استخدام الخدمة في أنشطة تنتهك حقوق الملكية الفكرية للغير.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                7. الخصوصية وحماية البيانات
              </h2>
              <p>
                نأخذ خصوصيتك على محمل الجدّ. للاطّلاع على كيفية جمعنا
                واستخدامنا وحمايتنا لبياناتك، يُرجى مراجعة{" "}
                <Link
                  href="/privacy"
                  className="text-indigo-600 hover:text-indigo-700 font-semibold underline"
                >
                  سياسة الخصوصية
                </Link>{" "}
                الخاصة بنا، والتي تُعدّ جزءاً لا يتجزّأ من هذه الشروط.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                8. إخلاء المسؤولية
              </h2>
              <p className="mb-3">
                تُقدَّم الخدمة "كما هي" و"حسب توفّرها" دون أيّ ضمانات صريحة أو
                ضمنية. لا نضمن:
              </p>
              <ul className="list-disc pr-5 space-y-2">
                <li>أن الخدمة ستكون خالية من الأخطاء أو الانقطاعات.</li>
                <li>
                  دقّة أو اكتمال البيانات المستخرَجة من المنصات الإعلانية
                  الخارجية (Meta، Google، TikTok، Snapchat، سلة، زد).
                </li>
                <li>تحقيق نتائج أعمال محدّدة من استخدام التحليلات والتوصيات.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                9. تحديد المسؤولية
              </h2>
              <p>
                في الحدود التي يسمح بها القانون، لا تتحمّل ArabiaDash المسؤولية
                عن أيّ أضرار غير مباشرة أو عرضية أو تبعية، بما في ذلك على سبيل
                المثال لا الحصر: فقدان الأرباح، أو فقدان البيانات، أو تعطّل
                الأعمال، الناجمة عن استخدام أو عدم القدرة على استخدام الخدمة.
                الحدّ الأقصى لمسؤوليتنا الإجمالية لا يتجاوز المبلغ الذي دفعته
                للخدمة خلال الاثني عشر شهراً السابقة للحدث.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                10. القانون الحاكم
              </h2>
              <p>
                تخضع هذه الشروط لقوانين المملكة العربية السعودية وتُفسَّر
                وفقاً لها. أيّ نزاع ينشأ عن هذه الشروط يُحَلّ ودّياً بين
                الطرفين، فإن تعذّر، يكون الاختصاص للمحاكم المختصّة في مدينة
                الرياض.
              </p>
            </section>

            <section>
              <h2 className="text-xl sm:text-2xl font-bold text-indigo-700 mb-3">
                11. التواصل
              </h2>
              <p>
                لأيّ استفسارات حول هذه الشروط، يمكنك التواصل معنا على البريد
                الإلكتروني:
              </p>
              <a
                href="mailto:support@arabiadash.com"
                className="inline-block mt-2 text-indigo-600 hover:text-indigo-700 font-semibold underline"
                dir="ltr"
              >
                support@arabiadash.com
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

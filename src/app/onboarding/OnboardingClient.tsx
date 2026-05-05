"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  User,
  Users,
  Building2,
  Target,
  Check,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface OnboardingClientProps {
  fullName: string;
  email: string;
  existingBusinessName: string;
}

type UsageType = "personal" | "agency" | "business" | "";
type TeamSize = "solo" | "small" | "medium" | "large" | "";

interface OnboardingData {
  business_name: string;
  usage_type: UsageType;
  team_size: TeamSize;
  goals: string[];
}

const USAGE_OPTIONS: {
  value: Exclude<UsageType, "">;
  title: string;
  description: string;
  icon: typeof User;
  popular?: boolean;
}[] = [
  {
    value: "personal",
    title: "شخصي",
    description: "للفريلانسرز والمسوقين المستقلين",
    icon: User,
    popular: true,
  },
  {
    value: "agency",
    title: "وكالة",
    description: "إدارة عملاء متعددين في مكان واحد",
    icon: Users,
  },
  {
    value: "business",
    title: "شركة / متجر",
    description: "نشاطي التجاري الخاص",
    icon: Building2,
  },
];

const TEAM_OPTIONS: { value: Exclude<TeamSize, "">; label: string }[] = [
  { value: "solo", label: "أنا فقط" },
  { value: "small", label: "2-10 أعضاء" },
  { value: "medium", label: "11-50 عضو" },
  { value: "large", label: "50+ عضو" },
];

const GOAL_OPTIONS: { value: string; label: string }[] = [
  { value: "increase_sales", label: "زيادة المبيعات" },
  { value: "reduce_costs", label: "تخفيض تكلفة الإعلانات" },
  { value: "unify_data", label: "توحيد بيانات منصات متعددة" },
  { value: "campaign_analysis", label: "تحليل أداء الحملات" },
  { value: "agency_reports", label: "إعداد تقارير للعملاء" },
  { value: "brand_awareness", label: "زيادة الوعي بالعلامة التجارية" },
];

export default function OnboardingClient({
  fullName,
  email,
  existingBusinessName,
}: OnboardingClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<OnboardingData>({
    business_name: existingBusinessName,
    usage_type: "",
    team_size: "",
    goals: [],
  });

  // Smart default: personal users default to "solo" team size
  useEffect(() => {
    if (formData.usage_type === "personal" && !formData.team_size) {
      setFormData((prev) => ({ ...prev, team_size: "solo" }));
    }
  }, [formData.usage_type, formData.team_size]);

  const firstName = useMemo(() => {
    const trimmed = fullName.trim();
    if (!trimmed) return "";
    return trimmed.split(/\s+/)[0];
  }, [fullName]);

  const canProceed = (): boolean => {
    if (step === 1) return formData.business_name.trim().length >= 2;
    if (step === 2) return formData.usage_type !== "";
    if (step === 3) return formData.team_size !== "";
    if (step === 4) return formData.goals.length >= 1;
    return false;
  };

  const handleNext = () => {
    if (!canProceed()) return;
    setError(null);
    if (step < 4) {
      setStep((s) => s + 1);
    } else {
      handleFinish();
    }
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const toggleGoal = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      goals: prev.goals.includes(value)
        ? prev.goals.filter((g) => g !== value)
        : [...prev.goals, value],
    }));
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);

    const trimmedBusinessName = formData.business_name.trim();

    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        business_name: trimmedBusinessName,
        company_name: trimmedBusinessName,
        usage_type: formData.usage_type,
        team_size: formData.team_size,
        goals: formData.goals,
        onboarding_completed: true,
        onboarded_at: new Date().toISOString(),
      },
    });

    if (updateError) {
      setError("حدث خطأ، يرجى المحاولة مرة أخرى");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  const progressPercent = Math.round((step / 4) * 100);

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50"
      dir="rtl"
    >
      {/* Sticky Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">ArabiaDash</span>
          </div>
          {firstName && (
            <p className="text-sm text-gray-600 hidden sm:block truncate max-w-[200px]">
              مرحباً، <span className="font-semibold text-gray-900">{firstName}</span> 👋
            </p>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              خطوة {step} من 4
            </span>
            <span className="text-sm text-gray-500">{progressPercent}%</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all duration-500 ease-out ${
                  i <= step
                    ? "bg-gradient-to-r from-indigo-500 to-purple-500"
                    : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 sm:p-10">
          <div key={step} className="animate-fade-slide">
            {step === 1 && (
              <Step1
                value={formData.business_name}
                onChange={(v) =>
                  setFormData((prev) => ({ ...prev, business_name: v }))
                }
              />
            )}

            {step === 2 && (
              <Step2
                value={formData.usage_type}
                onChange={(v) =>
                  setFormData((prev) => ({ ...prev, usage_type: v }))
                }
              />
            )}

            {step === 3 && (
              <Step3
                value={formData.team_size}
                onChange={(v) =>
                  setFormData((prev) => ({ ...prev, team_size: v }))
                }
              />
            )}

            {step === 4 && (
              <Step4 selected={formData.goals} onToggle={toggleGoal} />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between gap-3 pt-6 mt-8 border-t border-gray-100">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-lg text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition disabled:opacity-50"
              >
                <ArrowRight className="w-4 h-4" />
                السابق
              </button>
            ) : (
              <span />
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceed() || loading}
              className="inline-flex items-center gap-1.5 px-5 sm:px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-lg hover:shadow-indigo-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : step < 4 ? (
                <>
                  التالي
                  <ArrowLeft className="w-4 h-4" />
                </>
              ) : (
                <>
                  إنهاء وابدأ
                  <Sparkles className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-xs text-gray-500 mt-6">
          {email && <span dir="ltr">{email}</span>}
        </p>
      </main>
    </div>
  );
}

// ───────────────────────── Step 1 ─────────────────────────

function Step1({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="w-14 h-14 mx-auto bg-indigo-100 rounded-2xl flex items-center justify-center mb-5">
        <Briefcase className="w-7 h-7 text-indigo-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 text-center mb-2">
        ما اسم نشاطك؟
      </h2>
      <p className="text-sm sm:text-base text-gray-600 text-center mb-8 leading-relaxed">
        ساعدنا نخصّص تجربتك في ArabiaDash
      </p>

      <div>
        <label
          htmlFor="business_name"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          اسم الشركة أو النشاط
        </label>
        <input
          id="business_name"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="مثال: متجري، وكالتي، أو نشاطي الشخصي"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          autoFocus
          maxLength={100}
        />
        <p className="text-xs text-gray-500 mt-2">
          لو فريلانسر، اكتب اسمك أو اسم نشاطك
        </p>
      </div>
    </div>
  );
}

// ───────────────────────── Step 2 ─────────────────────────

function Step2({
  value,
  onChange,
}: {
  value: UsageType;
  onChange: (v: UsageType) => void;
}) {
  return (
    <div>
      <div className="w-14 h-14 mx-auto bg-purple-100 rounded-2xl flex items-center justify-center mb-5">
        <Sparkles className="w-7 h-7 text-purple-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 text-center mb-2">
        كيف تنوي استخدام ArabiaDash؟
      </h2>
      <p className="text-sm sm:text-base text-gray-600 text-center mb-8 leading-relaxed">
        نخصّص الميزات حسب احتياجاتك
      </p>

      <div className="space-y-3">
        {USAGE_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`w-full text-right border-2 rounded-xl p-4 sm:p-5 transition flex items-start gap-4 ${
                selected
                  ? "border-indigo-500 bg-indigo-50 shadow-sm"
                  : "border-gray-200 hover:border-indigo-200 hover:shadow-md bg-white"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  selected
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-bold text-gray-900">{opt.title}</h3>
                  {opt.popular && (
                    <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded">
                      الأكثر شيوعاً
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {opt.description}
                </p>
              </div>
              {selected && (
                <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── Step 3 ─────────────────────────

function Step3({
  value,
  onChange,
}: {
  value: TeamSize;
  onChange: (v: TeamSize) => void;
}) {
  return (
    <div>
      <div className="w-14 h-14 mx-auto bg-blue-100 rounded-2xl flex items-center justify-center mb-5">
        <Users className="w-7 h-7 text-blue-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 text-center mb-2">
        كم حجم فريقك؟
      </h2>
      <p className="text-sm sm:text-base text-gray-600 text-center mb-8 leading-relaxed">
        نستخدم هذا لاقتراح أفضل تجربة لك
      </p>

      <div className="space-y-2.5">
        {TEAM_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`w-full text-right border-2 rounded-xl px-4 py-3.5 transition flex items-center justify-between gap-3 ${
                selected
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50 bg-white"
              }`}
            >
              <span
                className={`font-medium ${
                  selected ? "text-indigo-900" : "text-gray-700"
                }`}
              >
                {opt.label}
              </span>
              {selected && (
                <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── Step 4 ─────────────────────────

function Step4({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="w-14 h-14 mx-auto bg-emerald-100 rounded-2xl flex items-center justify-center mb-5">
        <Target className="w-7 h-7 text-emerald-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 text-center mb-2">
        ما هي أهدافك الرئيسية؟
      </h2>
      <p className="text-sm sm:text-base text-gray-600 text-center mb-8 leading-relaxed">
        اختر كل ما ينطبق على عملك (يمكن اختيار أكثر من واحد)
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {GOAL_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={`text-right border-2 rounded-xl px-4 py-3.5 transition flex items-center gap-3 ${
                isSelected
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50 bg-white"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition ${
                  isSelected
                    ? "bg-indigo-600 border-indigo-600"
                    : "border-gray-300 bg-white"
                }`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
              <span
                className={`text-sm font-medium leading-snug ${
                  isSelected ? "text-indigo-900" : "text-gray-700"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-sm text-gray-500 mt-5">
        اخترت {selected.length} من {GOAL_OPTIONS.length}
      </p>
    </div>
  );
}

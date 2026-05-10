"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, AlertTriangle } from "lucide-react";
import type { DateRange, DateRangeValue } from "@/lib/ads/types";

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

const PRESET_LABELS: Record<DateRange, string> = {
  today: "اليوم",
  yesterday: "الأمس",
  "7d": "آخر 7 أيام",
  "14d": "آخر 14 يوم",
  this_month: "هذا الشهر",
  last_month: "الشهر الماضي",
  "30d": "آخر 30 يوم",
  "90d": "آخر 90 يوم",
  lifetime: "مدى الحياة",
};

const DISPLAYED_PRESETS: DateRange[] = [
  "today",
  "yesterday",
  "7d",
  "14d",
  "this_month",
  "last_month",
  "30d",
  "90d",
  "lifetime",
];

function formatCustomRange(since: string, until: string): string {
  const formatDate = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${formatDate(since)} - ${formatDate(until)}`;
}

function daysBetween(since: string, until: string): number {
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  return Math.ceil(
    (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function getDefaultCustomRange(): { since: string; until: string } {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const formatISO = (d: Date) => d.toISOString().split("T")[0];
  return {
    since: formatISO(thirtyDaysAgo),
    until: formatISO(today),
  };
}

export function DateRangePicker({
  value,
  onChange,
  className = "",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [tempSince, setTempSince] = useState("");
  const [tempUntil, setTempUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCustomMode(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (customMode) {
      if (value.type === "custom") {
        setTempSince(value.since);
        setTempUntil(value.until);
      } else {
        const defaults = getDefaultCustomRange();
        setTempSince(defaults.since);
        setTempUntil(defaults.until);
      }
      setError(null);
    }
  }, [customMode, value]);

  const displayLabel =
    value.type === "preset"
      ? PRESET_LABELS[value.preset]
      : formatCustomRange(value.since, value.until);

  const handlePresetClick = (preset: DateRange) => {
    onChange({ type: "preset", preset });
    setIsOpen(false);
    setCustomMode(false);
  };

  const handleCustomClick = () => {
    setCustomMode(true);
  };

  const handleApply = () => {
    if (!tempSince || !tempUntil) {
      setError("الرجاء تحديد كلا التاريخين");
      return;
    }
    if (tempSince > tempUntil) {
      setError("تاريخ البداية يجب أن يكون قبل تاريخ النهاية");
      return;
    }

    const days = daysBetween(tempSince, tempUntil);

    // Max range: 37 months ≈ 1110 days
    if (days > 1110) {
      setError("الفترة المختارة طويلة جداً (أقصى 37 شهر)");
      return;
    }

    onChange({ type: "custom", since: tempSince, until: tempUntil });
    setIsOpen(false);
    setCustomMode(false);
  };

  const handleBack = () => {
    setCustomMode(false);
    setError(null);
  };

  const showLongRangeWarning =
    customMode &&
    tempSince &&
    tempUntil &&
    !error &&
    daysBetween(tempSince, tempUntil) > 90 &&
    daysBetween(tempSince, tempUntil) <= 1110;

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
      >
        <Calendar className="w-4 h-4 text-gray-500" />
        <span>{displayLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute top-full mt-2 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-72"
          dir="rtl"
        >
          {!customMode ? (
            <div className="py-2">
              {/* Custom first, with gradient text matching brand */}
              <button
                onClick={handleCustomClick}
                className={`w-full text-right px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                  value.type === "custom" ? "bg-indigo-50 font-medium" : ""
                }`}
              >
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent font-bold">
                  مخصص
                </span>
              </button>

              <div className="border-t border-gray-100 my-1" />

              {DISPLAYED_PRESETS.map((preset) => {
                const isActive =
                  value.type === "preset" && value.preset === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => handlePresetClick(preset)}
                    className={`w-full text-right px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-700"
                    }`}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={handleBack}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← رجوع
                </button>
                <span className="text-sm font-medium">فترة مخصصة</span>
              </div>

              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs text-gray-600 mb-1 block">من</span>
                  <input
                    type="date"
                    value={tempSince}
                    onChange={(e) => setTempSince(e.target.value)}
                    max={today}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm"
                    dir="ltr"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-gray-600 mb-1 block">
                    إلى
                  </span>
                  <input
                    type="date"
                    value={tempUntil}
                    onChange={(e) => setTempUntil(e.target.value)}
                    max={today}
                    min={tempSince}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm"
                    dir="ltr"
                  />
                </label>
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 p-2 rounded flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {showLongRangeWarning && (
                <div className="text-xs text-orange-700 bg-orange-50 p-2 rounded flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>فترة طويلة، الاستجابة قد تتأخر قليلاً</span>
                </div>
              )}

              <button
                onClick={handleApply}
                className="w-full bg-blue-600 text-white py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                تطبيق
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

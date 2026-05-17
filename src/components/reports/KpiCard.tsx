"use client";

import { type LucideIcon, ArrowUp, ArrowDown } from "lucide-react";

export interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color: "indigo" | "green" | "emerald" | "purple" | "blue" | "pink";
  delta?: { value: number; isFinite: boolean } | null;
  deltaInverse?: boolean;
  unsupportedBadges?: string[];
  footnote?: string;
  previousPeriod?: unknown;
  size?: "default" | "mini";
}

const COLOR_CLASSES: Record<KpiCardProps["color"], string> = {
  indigo: "bg-indigo-50 text-indigo-600",
  green: "bg-green-50 text-green-600",
  emerald: "bg-emerald-50 text-emerald-600",
  purple: "bg-purple-50 text-purple-600",
  blue: "bg-blue-50 text-blue-600",
  pink: "bg-pink-50 text-pink-600",
};

export default function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  delta,
  deltaInverse = false,
  unsupportedBadges,
  footnote,
  previousPeriod,
  size = "default",
}: KpiCardProps) {
  const showDelta = delta && delta.isFinite;
  const deltaValue = delta?.value ?? 0;
  const isNegligible = showDelta && Math.abs(deltaValue) < 0.1;
  const deltaIsPositive = deltaInverse ? deltaValue < 0 : deltaValue > 0;
  const deltaColor = !showDelta
    ? "text-gray-400"
    : isNegligible
      ? "text-gray-500"
      : deltaIsPositive
        ? "text-green-600"
        : "text-red-600";
  const DeltaIcon =
    !showDelta || isNegligible
      ? null
      : deltaValue > 0
        ? ArrowUp
        : ArrowDown;

  const isMini = size === "mini";

  return (
    <div
      className={`bg-white border border-gray-100 rounded-xl hover:shadow-md transition ${
        isMini ? "p-3" : "p-3 sm:p-4"
      }`}
    >
      <div
        className={`flex items-center justify-between ${
          isMini ? "mb-2" : "mb-2 sm:mb-3"
        }`}
      >
        <div
          className={`rounded-lg flex items-center justify-center ${COLOR_CLASSES[color]} ${
            isMini ? "w-7 h-7" : "w-8 h-8 sm:w-9 sm:h-9"
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p
        className={`text-gray-600 mb-1 truncate ${
          isMini ? "text-[11px]" : "text-xs"
        }`}
      >
        {label}
      </p>
      <div className="flex items-baseline gap-1 flex-wrap mb-1" dir="ltr">
        <span
          className={`font-bold text-gray-900 ${
            isMini ? "text-sm" : "text-base sm:text-lg"
          }`}
        >
          {value}
        </span>
      </div>

      {unsupportedBadges && unsupportedBadges.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1" dir="ltr">
          {unsupportedBadges.map((badge, j) => (
            <span key={j} className="text-[10px] text-gray-500">
              {badge}
            </span>
          ))}
        </div>
      )}

      {showDelta ? (
        <div
          className={`flex items-center gap-0.5 ${deltaColor} ${
            isMini ? "text-[10px]" : "text-[10px] sm:text-xs"
          }`}
          dir="ltr"
        >
          {DeltaIcon && <DeltaIcon className="w-3 h-3" />}
          <span className="font-semibold">
            {Math.abs(deltaValue).toFixed(1)}%
          </span>
          <span className="text-gray-400 mr-1">vs السابقة</span>
        </div>
      ) : previousPeriod ? (
        <div
          className={`text-gray-400 ${
            isMini ? "text-[10px]" : "text-[10px] sm:text-xs"
          }`}
        >
          — vs السابقة
        </div>
      ) : null}

      {footnote && (
        <div className="text-[10px] text-gray-400 mt-1 italic">
          * {footnote}
        </div>
      )}
    </div>
  );
}

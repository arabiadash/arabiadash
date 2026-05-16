import Link from "next/link";
import { Inbox, Plus } from "lucide-react";

/**
 * Empty state shown on /dashboard when the active workspace has no active
 * connections. Replaces the inline "ابدأ بربط منصاتك" banner with a
 * dedicated component so the same shape can be reused by other surfaces
 * later (e.g. reports' empty state in Phase 4.3).
 *
 * No client state — pure presentation. Lives outside "use client" so it
 * can be rendered from Server Components too if a future page wants it.
 */
export default function DashboardEmptyState() {
  return (
    <div
      className="bg-white border border-gray-100 rounded-2xl p-8 sm:p-12 flex flex-col items-center text-center"
      dir="rtl"
    >
      <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mb-5">
        <Inbox className="w-8 h-8 text-indigo-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
        لا توجد منصات متصلة في هذا الـ workspace
      </h2>
      <p className="text-gray-600 max-w-md mb-6 leading-relaxed">
        ابدأ بربط حسابات الإعلانات لرؤية البيانات والتحليلات في هذا الـ
        workspace.
      </p>
      <Link
        href="/dashboard/connections"
        className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        <Plus className="w-5 h-5" />
        ربط منصة
      </Link>
    </div>
  );
}

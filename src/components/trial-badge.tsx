"use client";

import { Clock } from "lucide-react";

/**
 * Static trial info badge for the dashboard sidebar.
 *
 * Static text for now — Phase 10 (billing) will swap this for a dynamic
 * component that reads the user's actual trial state and adds an upgrade
 * CTA. Showing fixed text avoids misleading users until real billing
 * data is wired in.
 *
 * `mb-3` is baked in because the only consumer (DashboardSidebar's
 * bottom card) needs that spacing; revisit if reused elsewhere.
 */
export default function TrialBadge() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-indigo-50 rounded-lg border border-indigo-100">
      <Clock className="w-4 h-4 text-indigo-600 flex-shrink-0" />
      <p className="text-xs font-medium text-indigo-900 flex-1 min-w-0 truncate">
        تجربة مجانية - 14 يوم
      </p>
    </div>
  );
}

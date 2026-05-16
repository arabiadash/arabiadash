"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  X,
  Home,
  Link2,
  FileText,
  Settings,
  HelpCircle,
  Loader2,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import WorkspaceSwitcher from "./workspace-switcher";
import TrialBadge from "./trial-badge";
import type { Workspace } from "@/lib/workspaces";

interface DashboardSidebarProps {
  fullName: string;
  email: string;
  /**
   * Current route — used to compute which menu item is active. Pass the
   * pathname of the page (e.g. "/dashboard/connections" or a nested route
   * like "/dashboard/connections/google"). The component matches by prefix
   * so nested routes light up the right parent item.
   */
  activeRoute: string;
  sidebarOpen: boolean;
  onClose: () => void;
  /**
   * Workspace data, optional during the Phase 4.4b sub-B migration. When
   * absent (parent hasn't been updated yet), the switcher is hidden and
   * nav links don't carry the workspace param. Both pieces appear together.
   */
  workspaces?: Workspace[];
  activeWorkspaceId?: number;
}

const MENU_ITEMS = [
  { label: "الرئيسية", icon: Home, href: "/dashboard" },
  { label: "ربط المنصات", icon: Link2, href: "/dashboard/connections" },
  { label: "التقارير", icon: FileText, href: "/dashboard/reports" },
  { label: "الإعدادات", icon: Settings, href: "/dashboard/settings" },
  { label: "المساعدة", icon: HelpCircle, href: "#" },
];

/**
 * Shared dashboard sidebar — logo, nav links, user card, sign-out.
 * Used by every page under /dashboard. The parent retains a `sidebarOpen`
 * state and a header-mounted menu button that toggles it; this component
 * receives the state via props and calls `onClose` on the overlay or
 * close button.
 */
export default function DashboardSidebar({
  fullName,
  email,
  activeRoute,
  sidebarOpen,
  onClose,
  workspaces,
  activeWorkspaceId,
}: DashboardSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);

  const initial = fullName.charAt(0).toUpperCase();

  // The dashboard home is the only item that should match exactly; every
  // other route lights up its parent on nested paths too (e.g.
  // /dashboard/connections/google → "ربط المنصات" is active).
  const isActive = (itemHref: string) =>
    itemHref === "/dashboard"
      ? activeRoute === "/dashboard"
      : activeRoute.startsWith(itemHref);

  // Preserve the active workspace across navigations. Non-route hrefs
  // (e.g. "#" placeholder for "المساعدة") pass through unchanged so we
  // don't end up with "#?workspace=5".
  const workspaceParam = searchParams.get("workspace");
  const buildHref = (path: string) =>
    workspaceParam && path.startsWith("/")
      ? `${path}?workspace=${workspaceParam}`
      : path;

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 right-0 h-full w-64 bg-white border-l border-gray-200 z-50 transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100">
          <Link href={buildHref("/dashboard")} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">ArabiaDash</span>
          </Link>
          <button onClick={onClose} className="lg:hidden text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {workspaces && workspaces.length > 0 && activeWorkspaceId !== undefined && (
          <div className="border-b border-gray-100">
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
            />
          </div>
        )}

        <nav className="p-4 space-y-1">
          {MENU_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 right-0 left-0 p-4 border-t border-gray-100">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {fullName}
              </p>
              <p className="text-xs text-gray-500 truncate">{email}</p>
            </div>
          </div>
          <TrialBadge />
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
            {signingOut ? "جاري الخروج..." : "تسجيل الخروج"}
          </button>
        </div>
      </aside>
    </>
  );
}

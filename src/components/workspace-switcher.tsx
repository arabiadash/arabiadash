"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import type { Workspace } from "@/lib/workspaces";
import NewWorkspaceModal from "./new-workspace-modal";

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspaceId: number;
}

/**
 * Workspace selector rendered at the top of the dashboard sidebar.
 *
 * Switching writes to the URL — the default workspace gets a clean path,
 * any other workspace gets `?workspace=<id>`. Page-level resolution
 * (resolveActiveWorkspace) reads the param back on every navigation.
 */
export default function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  const handleNewWorkspaceClick = () => {
    setOpen(false);
    setNewWorkspaceOpen(true);
  };

  // Close when the user clicks anything outside the switcher. mousedown
  // (not click) so the dropdown closes before a downstream click handler
  // — useful if the user clicks a nav link while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!active) return null;

  const handleSelect = (workspace: Workspace) => {
    setOpen(false);
    if (workspace.id === activeWorkspaceId) return;
    const target = workspace.is_default
      ? pathname
      : `${pathname}?workspace=${workspace.id}`;
    router.push(target);
  };

  return (
    <div ref={containerRef} className="relative px-4 pt-4 pb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition text-sm"
      >
        <span className="truncate font-medium text-gray-900 text-right flex-1">
          {active.name}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 max-h-72 overflow-y-auto"
        >
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId;
            return (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handleSelect(w)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-right transition ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="truncate flex-1">{w.name}</span>
                {isActive && (
                  <Check className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                )}
              </button>
            );
          })}

          <div
            role="separator"
            className="border-t border-gray-100 my-1"
          />

          <button
            type="button"
            role="menuitem"
            onClick={handleNewWorkspaceClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-right text-gray-700 hover:bg-gray-50 transition"
          >
            <Plus className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="flex-1">workspace جديد</span>
          </button>

          <Link
            role="menuitem"
            href="/dashboard/settings#workspaces"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-right text-gray-700 hover:bg-gray-50 transition"
          >
            <Settings className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="flex-1">إدارة workspaces</span>
          </Link>
        </div>
      )}

      <NewWorkspaceModal
        key={newWorkspaceOpen ? "open" : "closed"}
        open={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
      />
    </div>
  );
}

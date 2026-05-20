"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { createWorkspace } from "@/app/dashboard/settings/workspaces/actions";

interface NewWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal for creating a new workspace. Uses the React 19 useActionState
 * pattern: the form action runs server-side, returns either
 * `{ ok: true, data: { id } }` or `{ error }`, and we react to whichever
 * shape comes back.
 *
 * State persists across opens (useActionState state lives with the
 * component instance), so the `handledSuccessRef` guard prevents a stale
 * "ok" from immediately re-triggering onClose when the user reopens after
 * a successful create.
 */
export default function NewWorkspaceModal({
  open,
  onClose,
}: NewWorkspaceModalProps) {
  const [state, formAction, isPending] = useActionState(createWorkspace, null);
  const [template, setTemplate] = useState<"ecommerce" | "reports">(
    "ecommerce"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const handledSuccessRef = useRef(false);

  // Each open: reset the success guard and focus the input.
  useEffect(() => {
    if (!open) return;
    handledSuccessRef.current = false;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Esc closes — honored even mid-pending (explicit user intent; the
  // server action will still complete in the background, it just can't
  // be canceled mid-RPC).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Auto-close + reset form when a fresh success comes back.
  useEffect(() => {
    if (
      state &&
      "ok" in state &&
      state.ok &&
      !handledSuccessRef.current
    ) {
      handledSuccessRef.current = true;
      formRef.current?.reset();
      onClose();
    }
  }, [state, onClose]);

  if (!open) return null;

  // Outside click respects pending — keeps a partial submission from being
  // accidentally dismissed while the user thinks the action is still alive.
  const handleBackdropClick = () => {
    if (!isPending) onClose();
  };

  const errorMessage = state && "error" in state ? state.error : null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
      dir="rtl"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-workspace-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2
            id="new-workspace-title"
            className="text-lg font-bold text-gray-900"
          >
            workspace جديد
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="إغلاق"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={formAction} className="p-6 space-y-4">
          <div>
            <label
              htmlFor="workspace-name"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              اسم الـ workspace
            </label>
            <input
              ref={inputRef}
              id="workspace-name"
              name="name"
              type="text"
              required
              maxLength={50}
              autoComplete="off"
              disabled={isPending}
              placeholder="مثلاً: العميل ABC أو العلامة التجارية X"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
            />
          </div>

          {/* Template selector (Phase 4.8 M3) */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              قالب الـ workspace
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTemplate("ecommerce")}
                disabled={isPending}
                className={`p-3 rounded-lg border-2 text-right transition disabled:opacity-50 ${
                  template === "ecommerce"
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="text-2xl mb-1">🛒</div>
                <div className="text-sm font-semibold text-gray-900">
                  متاجر إلكترونية
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  إيرادات + ROAS + مبيعات
                </div>
              </button>
              <button
                type="button"
                onClick={() => setTemplate("reports")}
                disabled={isPending}
                className={`p-3 rounded-lg border-2 text-right transition disabled:opacity-50 ${
                  template === "reports"
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="text-2xl mb-1">📊</div>
                <div className="text-sm font-semibold text-gray-900">
                  تقارير إعلانية
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ظهور + نقرات + CTR
                </div>
              </button>
            </div>
            {/* Hidden input so the selected value reaches the form action */}
            <input type="hidden" name="template" value={template} />
          </div>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg disabled:opacity-50 transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              إنشاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

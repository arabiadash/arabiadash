"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { archiveWorkspace } from "@/app/dashboard/settings/workspaces/actions";
import { formatActiveCount } from "@/lib/format-arabic";

interface ArchiveWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  workspace: { id: number; name: string } | null;
  /**
   * Live count fed by the parent — when the parent re-renders after
   * revalidation, this prop refreshes even though `workspace` state was
   * captured at open time. Prevents stale "0 accounts" UI from showing
   * after a race-condition update.
   */
  activeConnectionsCount: number;
}

/**
 * Destructive confirmation for soft-deleting a workspace.
 *
 * Renders one of two states depending on `activeConnectionsCount`:
 *   - 0 active connections → "are you sure?" with a red "تأكيد" button
 *   - >0 active connections → "can't archive yet" with one "حسناً" button
 *
 * The server action enforces both rules independently — these UI branches
 * are guidance, not security. Focus lands on the safe button (إلغاء or حسناً)
 * so a stray Enter doesn't fire the destructive action.
 */
export default function ArchiveWorkspaceDialog({
  open,
  onClose,
  workspace,
  activeConnectionsCount,
}: ArchiveWorkspaceDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the safe button on open. State (error) doesn't need an explicit
  // reset here — the parent passes `key={workspaceToArchive?.id ?? "closed"}`
  // so each new "open" remounts the component with fresh state.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => cancelButtonRef.current?.focus());
  }, [open]);

  // Esc always closes — destructive dialogs need an easy escape hatch even
  // mid-pending (the action can't be canceled but the user gets their UI back).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !workspace) return null;

  const canArchive = activeConnectionsCount === 0;

  // Outside click only closes when idle — protects against accidental
  // dismissal while a destructive request is in flight.
  const handleBackdropClick = () => {
    if (!isPending) onClose();
  };

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await archiveWorkspace(workspace.id);
      if ("error" in result) {
        setError(result.error);
      } else {
        onClose();
      }
    });
  };

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
        aria-labelledby="archive-dialog-title"
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h2
              id="archive-dialog-title"
              className="text-lg font-bold text-gray-900 truncate"
            >
              {canArchive
                ? `أرشفة "${workspace.name}"؟`
                : `ما تقدر تأرشف "${workspace.name}"`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="إغلاق"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {canArchive ? (
            <p className="text-sm text-gray-700 leading-relaxed">
              ستتم أرشفة هذا الـ workspace. تقدر تستعيده لاحقاً من الـ
              archived workspaces.
            </p>
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed">
              هذا الـ workspace يحتوي {formatActiveCount(activeConnectionsCount)}.
              انقل أو احذف الحسابات أولاً.
            </p>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {canArchive ? (
              <>
                <button
                  ref={cancelButtonRef}
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg disabled:opacity-50 transition"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isPending}
                  className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  تأكيد الأرشفة
                </button>
              </>
            ) : (
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
              >
                حسناً
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

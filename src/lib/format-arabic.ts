/**
 * Arabic-aware formatters shared across UI surfaces.
 *
 * Arabic has distinct grammar for 0, 1, 2 (dual), 3-10 (plural), and 11+
 * (accusative singular). Off-by-one mistakes here read as broken Arabic
 * to native speakers, so each call site uses one of these helpers rather
 * than inlining its own version.
 */

/**
 * "N active accounts" — used by the workspaces management section and the
 * archive confirmation dialog. Add new pluralizations here when other
 * surfaces (alerts, AI insights) need them.
 */
export function formatActiveCount(n: number): string {
  if (n === 0) return "لا حسابات نشطة";
  if (n === 1) return "حساب نشط واحد";
  if (n === 2) return "حسابان نشطان";
  if (n >= 3 && n <= 10) return `${n} حسابات نشطة`;
  return `${n} حساباً نشطاً`;
}

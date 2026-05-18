# ArabiaDash — Project Context for Claude Code

This file is read automatically by Claude Code at the start of every session.
It encodes locked decisions and environmental constraints so they don't need
to be re-explained each time.

---

## 1. Stack (exact versions, do not assume from training)

| Layer | Tech | Notes |
|-------|------|-------|
| Framework | Next.js 16.2.4 | Turbopack, App Router (NOT Pages Router) |
| Runtime | React 19.2.4 | React Compiler enabled |
| Language | TypeScript 5 | Strict mode |
| Styling | Tailwind CSS 3.4.1 | DO NOT upgrade to v4 — incompatible |
| Auth/DB | Supabase | @supabase/ssr 0.10, PKCE flow |
| Charts | Recharts 3.8, Framer Motion 12, Lucide React | — |
| Deployment | Vercel | CLI linked locally |

**Critical version-specific notes:**
- Next.js 16 **removed** the `eslint` property from `NextConfig` type. ESLint is no longer part of `next build`. Do not add `eslint: { ignoreDuringBuilds: true }`.
- React 19's React Compiler is strict about `set-state-in-effect`. Many flagged effects are false positives (query param reads, hydration-safe code, data fetching). Audit before refactoring.
- Tailwind 3.4.1 is locked. Do not run `npm install tailwindcss@latest`.

---

## 2. Environment

| Setting | Value |
|---------|-------|
| OS | Windows 11 |
| Shell | **Command Prompt ONLY** — PowerShell causes execution policy errors |
| Project path | `C:\Users\LENOVO\Desktop\adlytics` |
| Node global packages | vercel, supabase, gh |
| Git for Windows | Installed, but bash-style hooks don't spawn — skip Husky for now |

**Commit message convention on Windows:**
Multi-line messages don't work in CMD with a single `-m`. Use multiple `-m` flags:
```cmd
git commit -m "title line" -m "body paragraph"
```

---

## 3. Mandatory pre-commit checks

Run **both** before any commit. No exceptions.

```cmd
npx tsc --noEmit
npm run build
```

If either fails, fix before committing. Local Turbopack build is more lenient
than Vercel's TypeScript check, so `tsc --noEmit` is the ground truth.

For config file changes (`next.config.ts`, `tsconfig.json`, `package.json`):
also test the build path that uses the change.

---

## 4. Verification workflow (no browser needed)

Both Vercel CLI and GitHub CLI are installed and authenticated.

```cmd
# Check recent deployments
vercel ls

# Inspect a specific deployment's build logs
vercel inspect <deployment-url> --logs

# Check repo status
gh repo view
gh pr list
gh pr create

# Check last commit on origin/main
git log origin/main --oneline -1
```

Use these instead of asking the user to open dashboards or take screenshots.

---

## 5. Architecture (locked decisions)

### Pages
- All dashboard pages use **Server Component (`page.tsx`) + Client Component** pattern.
- RTL is set globally in `src/app/layout.tsx` with `lang="ar" dir="rtl"`. No per-page RTL handling needed.
- `searchParams` in Next.js 16 is a `Promise` — `const params = await searchParams`.

### Sidebar
- Unified `<DashboardSidebar />` at `src/components/dashboard-sidebar.tsx` (since commit `3c6f898`).
- Props: `fullName`, `email`, `activeRoute` (prefix-matched), `sidebarOpen`, `onClose`.
- Mobile drawer state stays in parents via `sidebarOpen` + `onClose` props (Option 2 — props-based, not Context).

### Workspaces
- Every user has an auto-created default workspace (`is_default=true`).
- Active workspace tracked via URL param `workspace`:
  - Clean URL for default (no param)
  - `?workspace=<id>` for non-default
- Switching = `router.push` on same pathname, update query param only.
- One workspace can hold multiple ad accounts from different platforms (Meta, Google, etc).
- Ad accounts from different workspaces NEVER blend in dashboard/reports.

### Connections (Approach C)
- OAuth callbacks save only the refresh token to `platform_credentials` (token isolation).
- New accounts are inserted via `/api/{platform}/select-accounts` after user selection in the selector UI (`/dashboard/connections/{platform}/select`).
- Plan limit: **cross-platform total** (Meta + Google + future TikTok/Snap/Salla/Zid combined).
- Trial = 3 accounts, Growth = 10, Agency = unlimited (see `src/lib/plans.ts` `canAddMoreAccounts`).
- `getUserTier()` stubbed to `"trial"` until Phase 10 billing.
- Deactivate flow (PATCH `/api/ads/connections/[id]`) flips `active` → `pending`.

### API
- Unified endpoints `/api/ads/insights` and `/api/ads/creatives` accept `?provider=meta|google`.
- Adapter pattern: `src/lib/ads/providers/<platform>.ts`.
- Factory: `getAdapterForProvider(userId, provider, accountId?)` in `src/lib/ads/factory.ts`.
- SWR cache tables: `insights_cache`, `creatives_cache`.

---

## 6. Critical technical traps

### gRPC + Turbopack
`google-ads-api` and any package using `@grpc/grpc-js` native bindings MUST be in
`serverExternalPackages` in `next.config.ts`. Turbopack bundling silently breaks
gRPC auth metadata. Symptom: `undefined undefined: undefined` errors.

Currently externalized:
```
google-ads-api, google-ads-node, google-gax,
@grpc/grpc-js, @grpc/proto-loader, long
```

### SSR-safe state for browser storage
`localStorage` reads cannot use lazy-init `useState` in SSR'd Client Components —
causes hydration mismatch (React Error #418).

```typescript
// CORRECT pattern
const [x, setX] = useState(default_value);
useEffect(() => {
  if (typeof window === 'undefined') return;
  const saved = localStorage.getItem(key);
  if (saved) setX(saved);
}, []);
```

### Generated types
Single source of truth for Supabase types is `src/lib/supabase/database.types.ts`.
Regenerate after schema changes:
```cmd
npx supabase gen types typescript --project-id fkljjwfhmmletytvevbp --schema public > src\lib\supabase\database.types.ts
```
Requires `SUPABASE_ACCESS_TOKEN` env var.

### Force-dynamic for fresh data
Server components reading connection/workspace state from Supabase use:
```typescript
export const dynamic = 'force-dynamic';
```

---

## 7. Workflow rules for recommendations

### Before recommending architectural changes
- **Web-search** Next.js 16 / React 19 / Tailwind 4 docs first. Training data is
  outdated on these edge versions.
- Present options with sources. Let the user review before passing to Claude Code.
- Quick fixes (typos, renames, imports) skip this gate.

### Before applying changes
- If a recommendation conflicts with actual code patterns (e.g. SSR-safe state,
  externalized packages, RLS policies), **stop and ask**.
- For unrelated changes found in `git diff`, ask the user if they should be
  separate commits.

### Never do
- Force-push to `main`
- Rewrite history on shared branches
- Add new top-level dependencies without confirmation
- Modify schema (Supabase) without confirmation
- Disable RLS policies
- Bypass plan limits

### Branching workflow (from Phase 4.4b sub-phase B onward)

Feature code goes on dedicated branches, NOT direct push to main:

```cmd
git checkout -b phase-X.X-description    # at start
# ... commits, push to branch
gh pr create                              # optional but recommended
# After verification on Vercel preview:
git checkout main
git merge phase-X.X-description
git push origin main
```

Direct push to main is allowed only for:
- Documentation (`CLAUDE.md`, README)
- Tooling configuration (`.gitignore`, `package.json` scripts)
- Hotfixes when main is broken

Feature commits MUST use branches.

---

## 8. Key project resources

| Resource | URL/Path |
|----------|----------|
| Production | https://arabiadash.com |
| Vercel preview | https://arabiadash.vercel.app |
| GitHub | https://github.com/arabiadash/arabiadash |
| Supabase | https://fkljjwfhmmletytvevbp.supabase.co (Seoul region) |
| Local | `C:\Users\LENOVO\Desktop\adlytics` |

---

## 9. Communication preferences

- User is a **non-technical builder**.
- Respond in **Arabic** with technical terms in plain language.
- User has strong product intuition. Trust their architectural preferences when stated.
- User prefers to control session length. Do not ask about fatigue.
- User wants **unified patterns** to avoid double-work across platforms.
- User defers billing/subscription architecture; product features come first.

---

## 10. Current state (update after major milestones)

- **Latest commit on origin/main**: see `git log origin/main --oneline -1`
- **Completed**: Phase 1-3 (backend), 4.1 through 4.5, 4.7 M1 + M2 (Google), 4.8 M1 (per-platform tabs), account selection pivot (PR #21, #22)
- **In progress**: Phase 4.8 M2 (expanded metrics + tech-debt #15 fix)
- **Next**: 4.8 M3 (conditional Revenue/ROAS), 4.8 M4 (Dashboard mirror), 4.9 (universal FX live rates)
- **Future**: Phase 5 (alerts), 6 (AI), 7 (TikTok), 8 (Snap), 9 (Salla/Zid), 10 (billing), 11 (public launch)